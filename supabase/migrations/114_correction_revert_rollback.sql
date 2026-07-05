-- ============================================================================
-- 114_correction_revert_rollback.sql
--
-- FG6: 勤怠修正の差し戻し(revert)による給与二重計上を根治
--
-- 背景（脆弱点）:
--   revertRequest は correction_requests を status='pending' に戻すだけで、
--   承認時に反映済みの attendance_records を巻き戻さなかった。
--     - inserted の再承認 → attendance_record_id が NULL のまま再 INSERT →
--       同日 2 行 → 078 が両方合算し二重計上。
--     - updated → 巻き戻し不能で誤った上書きが残る（過払い残存）。
--     - deleted → 再承認は attendance_record_id NULL で
--       'delete request without record_id' RAISE（フロー破綻）。
--
-- 採用案 = A: 真の巻き戻し / applied_snapshot による原子的リバース
--   (a) correction_requests に applied_snapshot jsonb（反映の逆操作情報）を追加。
--   (b) review_correction_request(052) を CREATE OR REPLACE。承認 3 系統で
--       snapshot を捕捉し、inserted は attendance_record_id を backfill。
--       既存の計算式・権限・24h/夜勤補正・notifications は 052 逐語維持。
--   (c) revert_correction_request(uuid) を新設。FOR UPDATE ロック→権限再投影→
--       applied_snapshot に基づき逆操作→status リセット→snapshot クリア。
--
-- セキュリティ:
--   - SECURITY DEFINER + SET search_path = public, pg_temp (4 行テンプレ)
--   - PUBLIC / anon EXECUTE を REVOKE、authenticated のみ GRANT
--
-- apply 順序: 109→110→111→112→113→114（番号順厳守・DB apply 先行→コード push）
--
-- 設計書: .company/engineering/docs/2026-07-03-kintai-emergency-money-authz-batch.md §FG6
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- (a) applied_snapshot 列（反映の逆操作情報・未反映/導入前承認は NULL）
-- ----------------------------------------------------------------------------
ALTER TABLE public.correction_requests
  ADD COLUMN IF NOT EXISTS applied_snapshot jsonb;

-- ----------------------------------------------------------------------------
-- (b) review_correction_request 再定義（052 本体 + snapshot 捕捉）
--     差分は snapshot 捕捉と applied_snapshot / attendance_record_id backfill のみ。
--     権限/入力検証/24h/夜勤/breaks 計算/notifications は 052 と逐語一致。
-- ----------------------------------------------------------------------------
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
  -- FG6: snapshot 捕捉用
  v_snapshot      jsonb;
  v_pre_date      date;
  v_pre_store     uuid;
  v_pre_in        timestamptz;
  v_pre_out       timestamptz;
  v_pre_min       int;
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
      -- FG6: DELETE 前に pre-image を捕捉（全列・revert で同 id 再 INSERT 用）
      SELECT date, store_id, clock_in, clock_out, total_work_minutes
      INTO v_pre_date, v_pre_store, v_pre_in, v_pre_out, v_pre_min
      FROM public.attendance_records
      WHERE id = v_target.attendance_record_id AND tenant_id = v_target.tenant_id AND user_id = v_target.user_id;

      DELETE FROM public.attendance_records
      WHERE id = v_target.attendance_record_id AND tenant_id = v_target.tenant_id AND user_id = v_target.user_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'attendance_record not found for delete: %', v_target.attendance_record_id;
      END IF;
      v_action := 'deleted';
      v_snapshot := jsonb_build_object(
        'action', 'deleted',
        'record_id', v_target.attendance_record_id,
        'prev', jsonb_build_object(
          'date', v_pre_date,
          'store_id', v_pre_store,
          'clock_in', v_pre_in,
          'clock_out', v_pre_out,
          'total_work_minutes', v_pre_min
        )
      );

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
        -- FG6: UPDATE 前に pre-image を捕捉（revert で復元用）
        SELECT clock_in, clock_out, total_work_minutes
        INTO v_pre_in, v_pre_out, v_pre_min
        FROM public.attendance_records
        WHERE id = v_target.attendance_record_id AND tenant_id = v_target.tenant_id AND user_id = v_target.user_id;

        UPDATE public.attendance_records
        SET clock_in           = COALESCE(v_clock_in,  clock_in),
            clock_out          = COALESCE(v_clock_out, clock_out),
            total_work_minutes = COALESCE(v_total_min, total_work_minutes)
        WHERE id = v_target.attendance_record_id AND tenant_id = v_target.tenant_id AND user_id = v_target.user_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'attendance_record not found for update: %', v_target.attendance_record_id;
        END IF;
        v_action := 'updated';
        v_snapshot := jsonb_build_object(
          'action', 'updated',
          'record_id', v_target.attendance_record_id,
          'prev', jsonb_build_object(
            'clock_in', v_pre_in,
            'clock_out', v_pre_out,
            'total_work_minutes', v_pre_min
          )
        );

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
        v_snapshot := jsonb_build_object(
          'action', 'inserted',
          'record_id', v_new_record_id
        );

      ELSE
        v_action := 'noop'; -- clock 両欠け = 何もしない (現状実装と同じ)
        v_snapshot := NULL;
      END IF;

    ELSE
      v_action := 'noop';
      v_snapshot := NULL;
    END IF;

    -- correction_requests を approved に更新
    -- FG6: applied_snapshot を保存し、inserted は attendance_record_id を backfill
    UPDATE public.correction_requests
    SET status               = 'approved',
        reviewed_by          = v_user,
        reviewed_at          = now(),
        applied_snapshot     = v_snapshot,
        attendance_record_id = COALESCE(v_new_record_id, attendance_record_id)
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

  -- g. rejected パス（applied_snapshot は触らない = NULL のまま）
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

-- ----------------------------------------------------------------------------
-- (c) revert_correction_request 新設（承認済みの反映を原子的に逆操作）
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revert_correction_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user   uuid;
  v_t      public.correction_requests%ROWTYPE;
  v_action text;
  v_rid    uuid;
  v_prev   jsonb;
BEGIN
  -- 認証
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  -- 対象を排他取得（並行 revert / review を直列化）
  SELECT * INTO v_t
  FROM public.correction_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'correction_request not found: %', p_request_id USING ERRCODE = 'P0002';
  END IF;

  -- 権限再投影（SECURITY DEFINER で RLS bypass するため明示検証）
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = v_t.tenant_id AND user_id = v_user AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'permission denied (manager/owner required)' USING ERRCODE = '42501';
  END IF;

  -- 二重 revert ガード: 既に pending は巻き戻し不能
  IF v_t.status = 'pending' THEN
    RAISE EXCEPTION 'この申請は保留中のため巻き戻せません' USING ERRCODE = '22023';
  END IF;

  -- rejected は副作用なし → status リセットのみ
  IF v_t.status = 'rejected' THEN
    UPDATE public.correction_requests
      SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL
      WHERE id = p_request_id;
    RETURN jsonb_build_object('request_id', p_request_id, 'status', 'pending', 'reverted_action', 'none');
  END IF;

  -- approved だが snapshot 無し (本機能導入前の承認) → 自動巻き戻し不能を明示
  IF v_t.applied_snapshot IS NULL THEN
    RAISE EXCEPTION 'この修正は自動巻き戻し情報が無いため巻き戻せません（本機能導入前に承認された可能性）。必要な場合は管理者が手動で勤怠を調整してください' USING ERRCODE = '22023';
  END IF;

  v_action := v_t.applied_snapshot->>'action';
  v_rid    := (v_t.applied_snapshot->>'record_id')::uuid;
  v_prev   := v_t.applied_snapshot->'prev';

  IF v_action = 'inserted' THEN
    -- 承認で INSERT した行を削除し、rec_id を NULL に戻す（再承認で単一行 INSERT）
    DELETE FROM public.attendance_records
      WHERE id = v_rid AND tenant_id = v_t.tenant_id AND user_id = v_t.user_id;
    UPDATE public.correction_requests
      SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL,
          applied_snapshot = NULL, attendance_record_id = NULL
      WHERE id = p_request_id;

  ELSIF v_action = 'updated' THEN
    -- pre-image で UPDATE 復元
    UPDATE public.attendance_records
      SET clock_in           = (v_prev->>'clock_in')::timestamptz,
          clock_out          = (v_prev->>'clock_out')::timestamptz,
          total_work_minutes = (v_prev->>'total_work_minutes')::int
      WHERE id = v_rid AND tenant_id = v_t.tenant_id AND user_id = v_t.user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '巻き戻し対象の勤怠行が見つかりません（既に削除された可能性）。手動確認が必要です' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.correction_requests
      SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, applied_snapshot = NULL
      WHERE id = p_request_id;

  ELSIF v_action = 'deleted' THEN
    -- 同一 id で再 INSERT（全列 pre-image）。open-session UNIQUE 衝突は
    -- unique_violation で revert 全体が fail-safe（誤復元しない）。
    INSERT INTO public.attendance_records (
      id, tenant_id, user_id, date, store_id, clock_in, clock_out, total_work_minutes
    ) VALUES (
      v_rid, v_t.tenant_id, v_t.user_id,
      (v_prev->>'date')::date, (v_prev->>'store_id')::uuid,
      (v_prev->>'clock_in')::timestamptz, (v_prev->>'clock_out')::timestamptz,
      (v_prev->>'total_work_minutes')::int
    )
    ON CONFLICT (id) DO NOTHING;
    UPDATE public.correction_requests
      SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL,
          applied_snapshot = NULL, attendance_record_id = v_rid
      WHERE id = p_request_id;

  ELSE
    -- noop 等: 副作用なし → status リセットのみ
    UPDATE public.correction_requests
      SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, applied_snapshot = NULL
      WHERE id = p_request_id;
  END IF;

  RETURN jsonb_build_object('request_id', p_request_id, 'status', 'pending', 'reverted_action', v_action);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revert_correction_request(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_correction_request(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.revert_correction_request(uuid) TO authenticated;

COMMIT;
