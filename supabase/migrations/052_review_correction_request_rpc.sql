-- ============================================================================
-- 052_review_correction_request_rpc.sql
--
-- P1 構造的整合性: correction_requests レビュー (approved / rejected) を
-- 単一 PL/pgSQL トランザクションで実行する SECURITY DEFINER RPC を新設。
--
-- 背景:
--   Loop A (migration 051) で `.select('id')` ガードによる silent failure 顕在化を
--   完了。Loop D では autocommit 境界に起因する整合不一致 (status と
--   attendance_records の片方だけ進む) を構造的に排除する。
--
-- 動作:
--   1. p_review_status を 'approved' | 'rejected' のみ許可
--   2. auth.uid() の認証必須
--   3. SELECT ... FOR UPDATE で対象 request を排他取得 (二重承認 race を遮断)
--   4. status = 'pending' でない場合は 40001 で reject
--   5. tenant_members で role IN ('owner','manager') を明示検証 (RLS bypass の
--      代わりに関数内で権限再投影)
--   6. approved パス:
--        - request_type='delete' → attendance_records DELETE
--        - それ以外 → 既存 record 補完 + 夜勤跨ぎ + 24h バリデーション +
--          breaks 込み total_work_minutes 計算 + UPDATE or INSERT
--   7. correction_requests.status を approved/rejected に更新
--   8. notifications INSERT は内側 BEGIN..EXCEPTION で best-effort (案 N2)
--   9. jsonb で { request_id, status, request_type, attendance_record_id, action } を返却
--
-- セキュリティ:
--   - SECURITY DEFINER + SET search_path = public, pg_temp (4 行テンプレ)
--   - PUBLIC / anon EXECUTE を REVOKE、authenticated のみ GRANT
--   - caller は p_request_id 経由で tenant_id を推論し、関数内で権限再投影
--   - INSERT/UPDATE/DELETE の tenant_id / user_id は必ず v_target から引く
--     (caller 直接指定不可 → 偽装不可)
--
-- エラーコード (SQLSTATE):
--   22023 invalid_parameter_value: p_review_status 不正 / 24h 超過
--   28000 invalid_authorization_specification: 未認証
--   P0002 no_data_found: target 不存在
--   40001 serialization_failure: 既に review 済 (二重承認)
--   42501 insufficient_privilege: manager/owner 以外
--   その他: attendance_records 不存在等 (デフォルト P0001)
--
-- 設計書: .company/engineering/docs/2026-05-15-kintai-correction-rpc-loop-d-techdesign.md
-- ============================================================================

CREATE OR REPLACE FUNCTION public.review_correction_request(
  p_request_id    uuid,
  p_review_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user          uuid;
  v_target        public.correction_requests%ROWTYPE;
  v_clock_in      timestamptz;
  v_clock_out     timestamptz;
  v_existing_in   timestamptz;
  v_existing_out  timestamptz;
  v_break_sum     int;
  v_raw_minutes   int;
  v_total_min     int;
  v_new_record_id uuid;
  v_action        text;
BEGIN
  -- a. 入力検証
  IF p_review_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid review_status: %', p_review_status
      USING ERRCODE = '22023';
  END IF;

  -- b. 認証
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated'
      USING ERRCODE = '28000';
  END IF;

  -- c. target を排他取得
  SELECT * INTO v_target
  FROM public.correction_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'correction_request not found: %', p_request_id
      USING ERRCODE = 'P0002';
  END IF;

  -- d. pending チェック (二重承認 race 遮断)
  IF v_target.status <> 'pending' THEN
    RAISE EXCEPTION 'already reviewed (status=%)', v_target.status
      USING ERRCODE = '40001';
  END IF;

  -- e. 権限検査 (SECURITY DEFINER で RLS bypass するため明示検証)
  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_members
    WHERE tenant_id = v_target.tenant_id
      AND user_id = v_user
      AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'permission denied (manager/owner required)'
      USING ERRCODE = '42501';
  END IF;

  -- f. approved パス
  IF p_review_status = 'approved' THEN

    IF v_target.request_type = 'delete' AND v_target.attendance_record_id IS NULL THEN
      RAISE EXCEPTION 'delete request without record_id: %', p_request_id USING ERRCODE='22023';
    END IF;

    IF v_target.request_type = 'delete' AND v_target.attendance_record_id IS NOT NULL THEN
      DELETE FROM public.attendance_records
      WHERE id = v_target.attendance_record_id AND tenant_id = v_target.tenant_id AND user_id = v_target.user_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'attendance_record not found for delete: %', v_target.attendance_record_id;
      END IF;
      v_action := 'deleted';

    ELSIF v_target.request_type <> 'delete' OR v_target.request_type IS NULL THEN
      v_clock_in  := v_target.requested_clock_in;
      v_clock_out := v_target.requested_clock_out;

      -- 既存 record 補完 (片欠け時、L149 P2 と同等の動作を関数内で安全に再現)
      IF v_target.attendance_record_id IS NOT NULL
         AND (v_clock_in IS NULL OR v_clock_out IS NULL) THEN
        SELECT clock_in, clock_out
        INTO v_existing_in, v_existing_out
        FROM public.attendance_records
        WHERE id = v_target.attendance_record_id AND tenant_id = v_target.tenant_id AND user_id = v_target.user_id;
        -- 行が見つからない場合 v_existing_* は NULL のまま (COALESCE が安全に動作)
        v_clock_in  := COALESCE(v_clock_in, v_existing_in);
        v_clock_out := COALESCE(v_clock_out, v_existing_out);
      END IF;

      -- 夜勤跨ぎ補正
      IF v_clock_in IS NOT NULL AND v_clock_out IS NOT NULL
         AND v_clock_out < v_clock_in THEN
        v_clock_out := v_clock_out + interval '1 day';
      END IF;

      -- 24h 超過バリデーション
      IF v_clock_in IS NOT NULL AND v_clock_out IS NOT NULL
         AND (v_clock_out - v_clock_in) > interval '24 hours' THEN
        RAISE EXCEPTION '24時間以上の修正は無効です'
          USING ERRCODE = '22023';
      END IF;

      -- total_work_minutes 計算 (breaks 減算)
      IF v_clock_in IS NOT NULL AND v_clock_out IS NOT NULL THEN
        SELECT COALESCE(
          SUM(EXTRACT(EPOCH FROM (end_time - start_time))::int / 60),
          0
        )
        INTO v_break_sum
        FROM public.breaks
        WHERE attendance_record_id = v_target.attendance_record_id
          AND start_time IS NOT NULL
          AND end_time IS NOT NULL;

        v_raw_minutes := (EXTRACT(EPOCH FROM (v_clock_out - v_clock_in))::int / 60);
        v_total_min   := GREATEST(0, v_raw_minutes - COALESCE(v_break_sum, 0));
      END IF;

      IF v_target.attendance_record_id IS NOT NULL THEN
        UPDATE public.attendance_records
        SET clock_in           = COALESCE(v_clock_in,  clock_in),
            clock_out          = COALESCE(v_clock_out, clock_out),
            total_work_minutes = COALESCE(v_total_min, total_work_minutes)
        WHERE id = v_target.attendance_record_id AND tenant_id = v_target.tenant_id AND user_id = v_target.user_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'attendance_record not found for update: %', v_target.attendance_record_id;
        END IF;
        v_action := 'updated';

      ELSIF v_clock_in IS NOT NULL THEN
        INSERT INTO public.attendance_records (
          tenant_id, user_id, date, store_id,
          clock_in, clock_out, total_work_minutes
        ) VALUES (
          v_target.tenant_id, v_target.user_id, v_target.date, v_target.store_id,
          v_clock_in, v_clock_out, v_total_min
        )
        RETURNING id INTO v_new_record_id;
        v_action := 'inserted';

      ELSE
        v_action := 'noop'; -- clock 両欠け = 何もしない (現状実装と同じ)
      END IF;

    ELSE
      v_action := 'noop';
    END IF;

    -- correction_requests を approved に更新
    UPDATE public.correction_requests
    SET status      = 'approved',
        reviewed_by = v_user,
        reviewed_at = now()
    WHERE id = p_request_id;

    -- notifications (best-effort: 案 N2)
    BEGIN
      INSERT INTO public.notifications (tenant_id, user_id, type, title, body, link)
      VALUES (
        v_target.tenant_id,
        v_target.user_id,
        'correction_approved',
        '修正申請が承認されました',
        v_target.date::text,
        '/history?date=' || v_target.date::text
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[review_correction_request] notify (approved) failed: %', SQLERRM;
    END;

  -- g. rejected パス
  ELSE
    UPDATE public.correction_requests
    SET status      = 'rejected',
        reviewed_by = v_user,
        reviewed_at = now()
    WHERE id = p_request_id;

    BEGIN
      INSERT INTO public.notifications (tenant_id, user_id, type, title, body, link)
      VALUES (
        v_target.tenant_id,
        v_target.user_id,
        'correction_rejected',
        '修正申請が却下されました',
        v_target.date::text,
        '/history?date=' || v_target.date::text
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[review_correction_request] notify (rejected) failed: %', SQLERRM;
    END;

    v_action := 'rejected';
  END IF;

  -- h. 戻り値
  RETURN jsonb_build_object(
    'request_id',           p_request_id,
    'status',               p_review_status,
    'request_type',         v_target.request_type,
    'attendance_record_id', COALESCE(v_new_record_id, v_target.attendance_record_id),
    'action',               v_action
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.review_correction_request(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.review_correction_request(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.review_correction_request(uuid, text) TO authenticated;
