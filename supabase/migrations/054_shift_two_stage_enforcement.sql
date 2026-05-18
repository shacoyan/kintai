-- ============================================================
-- 054_shift_two_stage_enforcement.sql
-- シフト 2 段階承認の DB 強制レイヤー (Loop H)
-- 設計書: .company/engineering/docs/2026-05-18-kintai-shift-two-stage-approval-techdesign.md
-- 作成日: 2026-05-18
--
-- 概要:
--   - DB trigger で pending → approved の直接遷移を禁止
--   - 既存 053 RPC に escape hatch (set_config) を 1 行注入
--   - reject_shift RPC 新規作成 (4 行テンプレ準拠)
--   - 既存 approved 62 件をバックフィル (tentative_approved_at/by を埋める)
--
-- 注意:
--   - notifications.type CHECK 拡張は実施しない (Q4=b 通知不要)
--   - tentative_approved_by = reviewed_by 同一性検査は入れない (Q2=a 同一人物許可)
--   - 既存 053 RPC 本体ロジックは PERFORM set_config 1 行追加のみで他は不変
--   - migration 053 二重 apply 履歴クリーンアップは末尾コメント「手動実行 SQL」参照
--     (schema_migrations テーブルへの DELETE は migration 本体の tx 内では実行しない)
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Trigger 関数: shifts_enforce_approval_order
--    BEFORE UPDATE で status 遷移を検査。RPC 経由 (set_config セット済) のみ通す。
-- ============================================================
CREATE OR REPLACE FUNCTION public.shifts_enforce_approval_order()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- status 変化が無い UPDATE (時刻編集, バックフィル等) は素通し
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- ============================================================
  -- 行データ条件 (depth-in-defense, GUC より優先):
  -- GUC escape hatch があっても、以下のヤバい遷移は完全ブロック。
  -- 将来別 RPC が GUC を誤ってセットした状態で複数 UPDATE を流す設計に
  -- 入っても、行データ条件で二重防御する。
  -- ============================================================
  -- pending → approved の直接遷移は GUC によらず完全禁止
  IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
    RAISE EXCEPTION 'direct pending -> approved transition forbidden'
      USING ERRCODE = '42501';
  END IF;
  -- approved への遷移は tentative_approved (= ''tentative'' / 内部表現) からのみ
  IF NEW.status = 'approved' AND OLD.status NOT IN ('tentative', 'approved') THEN
    RAISE EXCEPTION 'approved only allowed from tentative_approved (got %)', OLD.status
      USING ERRCODE = '42501';
  END IF;

  -- ============================================================
  -- GUC escape hatch (本承認 RPC が立てる) チェック:
  -- 行データ条件をパスした遷移について、RPC 経由でない直接 UPDATE をブロック。
  -- ============================================================
  -- pending → approved 等の直接遷移を禁止 (escape hatch なしの場合)
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    IF current_setting('app.allow_direct_approve', true) IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'direct transition to approved is forbidden; use approve_shift_final RPC';
    END IF;
  END IF;

  -- tentative への遷移は approve_shift_tentative RPC のみ許可
  IF NEW.status = 'tentative' AND OLD.status <> 'tentative' THEN
    IF current_setting('app.allow_direct_tentative', true) IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'direct transition to tentative is forbidden; use approve_shift_tentative RPC';
    END IF;
  END IF;

  -- rejected への遷移は reject_shift RPC のみ許可
  IF NEW.status = 'rejected' AND OLD.status <> 'rejected' THEN
    IF current_setting('app.allow_direct_reject', true) IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'direct transition to rejected is forbidden; use reject_shift RPC';
    END IF;
  END IF;

  -- それ以外の遷移 (pending, modified, cancelled へ) は既存 RPC / 通常 UPDATE 許可
  RETURN NEW;
END;
$$;

-- ============================================================
-- 2. Trigger 作成
-- ============================================================
DROP TRIGGER IF EXISTS trg_shifts_enforce_approval_order ON public.shifts;
CREATE TRIGGER trg_shifts_enforce_approval_order
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.shifts_enforce_approval_order();

-- ============================================================
-- 3. RPC: approve_shift_tentative (053 から escape hatch 1 行追加で再定義)
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_shift_tentative(
  p_shift_id uuid
)
RETURNS public.shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift  public.shifts%ROWTYPE;
  v_result public.shifts%ROWTYPE;
BEGIN
  -- 1. auth.uid() NULLチェック
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth.uid is null';
  END IF;

  -- 2. 対象シフトを行ロック付きで取得
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  -- 3. 存在チェック
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift not found: %', p_shift_id;
  END IF;

  -- 4. 権限チェック: owner/managerのみ
  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_members
    WHERE tenant_id = v_shift.tenant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'permission denied: only owner/manager can approve shifts';
  END IF;

  -- 4a. 店舗ガード: 当該店舗のマネージャー権限
  IF NOT public.is_store_manager(v_shift.tenant_id, v_shift.store_id) THEN
    RAISE EXCEPTION 'permission denied: not a manager of store %', v_shift.store_id;
  END IF;

  -- 5. 状態遷移チェック
  IF v_shift.status NOT IN ('pending', 'modified') THEN
    RAISE EXCEPTION 'invalid status transition: % -> tentative', v_shift.status;
  END IF;

  -- 6. escape hatch: trigger 経由 RPC として通過させる
  PERFORM set_config('app.allow_direct_tentative', '1', true);

  -- 7. 仮承認へ更新
  UPDATE public.shifts
  SET status = 'tentative',
      tentative_approved_by = auth.uid(),
      tentative_approved_at = now()
  WHERE id = p_shift_id
  RETURNING * INTO v_result;

  -- 8. 結果返却
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_shift_tentative(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_shift_tentative(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.approve_shift_tentative(uuid) TO authenticated;

-- ============================================================
-- 4. RPC: approve_shift_final (053 から escape hatch 1 行追加で再定義)
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_shift_final(
  p_shift_id uuid
)
RETURNS public.shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift  public.shifts%ROWTYPE;
  v_result public.shifts%ROWTYPE;
BEGIN
  -- 1. auth.uid() NULLチェック
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth.uid is null';
  END IF;

  -- 2. 対象シフトを行ロック付きで取得
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  -- 3. 存在チェック
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift not found: %', p_shift_id;
  END IF;

  -- 4. 権限チェック: owner/managerのみ
  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_members
    WHERE tenant_id = v_shift.tenant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'permission denied: only owner/manager can approve shifts';
  END IF;

  -- 4a. 店舗ガード: 当該店舗のマネージャー権限
  IF NOT public.is_store_manager(v_shift.tenant_id, v_shift.store_id) THEN
    RAISE EXCEPTION 'permission denied: not a manager of store %', v_shift.store_id;
  END IF;

  -- 5. 状態遷移チェック: tentativeのみ許可
  IF v_shift.status != 'tentative' THEN
    RAISE EXCEPTION 'must be tentative-approved first';
  END IF;

  -- 6. escape hatch: trigger 経由 RPC として通過させる
  PERFORM set_config('app.allow_direct_approve', '1', true);

  -- 7. 本承認へ更新
  UPDATE public.shifts
  SET status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = p_shift_id
  RETURNING * INTO v_result;

  -- 8. 結果返却
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_shift_final(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_shift_final(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.approve_shift_final(uuid) TO authenticated;

-- ============================================================
-- 5. RPC: approve_store_shifts_final (053 から escape hatch 1 行追加で再定義)
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_store_shifts_final(
  p_tenant_id uuid,
  p_store_id  uuid
)
RETURNS TABLE(approved_count integer, approved_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
  v_ids   uuid[];
BEGIN
  -- 1. auth.uid() NULLチェック
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth.uid is null';
  END IF;

  -- 2. 権限チェック: 当該店舗のマネージャー権限
  IF NOT public.is_store_manager(p_tenant_id, p_store_id) THEN
    RAISE EXCEPTION 'permission denied: not a manager of store %', p_store_id;
  END IF;

  -- 3. escape hatch: trigger 経由 RPC として通過させる
  PERFORM set_config('app.allow_direct_approve', '1', true);

  -- 4. 一括更新: tentative → approved
  --    他店舗を絶対に巻き込まないため WHERE 句に tenant_id/store_id 両方を必須
  WITH updated AS (
    UPDATE public.shifts
    SET status = 'approved',
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE tenant_id = p_tenant_id
      AND store_id = p_store_id
      AND status = 'tentative'
    RETURNING id
  )
  SELECT count(*)::integer,
         COALESCE(array_agg(id), ARRAY[]::uuid[])
  INTO v_count, v_ids
  FROM updated;

  -- 5. 結果返却
  RETURN QUERY SELECT v_count, v_ids;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_store_shifts_final(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_store_shifts_final(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.approve_store_shifts_final(uuid, uuid) TO authenticated;

-- ============================================================
-- 6. RPC: reject_shift (新規)
--    pending / tentative / modified からの却下を 1 本化。
--    note には p_reason があれば上書き、無ければ既存値を維持。
-- ============================================================
CREATE OR REPLACE FUNCTION public.reject_shift(
  p_shift_id uuid,
  p_reason   text DEFAULT NULL
)
RETURNS public.shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift  public.shifts%ROWTYPE;
  v_result public.shifts%ROWTYPE;
BEGIN
  -- 1. auth.uid() NULLチェック
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth.uid is null';
  END IF;

  -- 2. 対象シフトを行ロック付きで取得
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  -- 3. 存在チェック
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift not found: %', p_shift_id;
  END IF;

  -- 4. 権限チェック (案 Y / 053 系本承認 RPC と統一):
  --    tenant_members.role IN ('owner','manager') AND store_members.is_manager = true
  --    既存ヘルパー (内包 OR 条件) ではスタッフ店舗マネージャー (tenant.role='staff' AND
  --    store.is_manager=true) まで却下権限を持ってしまうため、明示的 JOIN/EXISTS で
  --    AND 二段ゲートに引き締める。
  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    JOIN public.store_members sm ON sm.member_id = tm.id
    WHERE tm.user_id = auth.uid()
      AND tm.tenant_id = v_shift.tenant_id
      AND tm.role IN ('owner', 'manager')
      AND sm.store_id = v_shift.store_id
      AND sm.is_manager = true
  ) THEN
    RAISE EXCEPTION 'permission denied (store manager required)'
      USING ERRCODE = '42501';
  END IF;

  -- 5. 状態遷移チェック: pending / tentative / modified のみ却下可能
  IF v_shift.status NOT IN ('pending', 'tentative', 'modified') THEN
    RAISE EXCEPTION 'cannot reject shift with status: %', v_shift.status;
  END IF;

  -- 6. escape hatch: trigger 経由 RPC として通過させる
  PERFORM set_config('app.allow_direct_reject', '1', true);

  -- 7. 却下へ更新 (note は p_reason があれば上書き)
  UPDATE public.shifts
  SET status      = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      note        = COALESCE(p_reason, note)
  WHERE id = p_shift_id
  RETURNING * INTO v_result;

  -- 8. 結果返却
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_shift(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_shift(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.reject_shift(uuid, text) TO authenticated;

-- ============================================================
-- 7. 既存 approved 62 件のバックフィル
--    status は維持 (approved → approved) のため trigger ガード対象外。
--    tentative_approved_at/by を reviewed_at/by から複写。
-- ============================================================
UPDATE public.shifts
SET tentative_approved_at = reviewed_at,
    tentative_approved_by = reviewed_by
WHERE status = 'approved'
  AND (tentative_approved_at IS NULL OR tentative_approved_by IS NULL);

COMMIT;

-- ============================================================
-- ROLLBACK 手順
-- ============================================================
-- 以下の SQL を順番に実行して、054 マイグレーションをロールバックします。
--
-- BEGIN;
--
-- -- 1. Trigger と Trigger 関数の削除
-- DROP TRIGGER  IF EXISTS trg_shifts_enforce_approval_order ON public.shifts;
-- DROP FUNCTION IF EXISTS public.shifts_enforce_approval_order();
--
-- -- 2. 新規 RPC の削除
-- DROP FUNCTION IF EXISTS public.reject_shift(uuid, text);
--
-- -- 3. 既存 RPC は 053 を再 apply するか、053 ファイルの該当ブロックを CREATE OR REPLACE で復元
-- --    (escape hatch の PERFORM set_config 1 行を取り除くのみ)
--
-- -- 4. バックフィルの巻き戻し (必要な場合のみ)
-- -- UPDATE public.shifts
-- --   SET tentative_approved_at = NULL,
-- --       tentative_approved_by = NULL
-- -- WHERE status = 'approved';
--
-- COMMIT;
-- ============================================================

-- ============================================================
-- 手動実行 SQL (秘書が migration apply 完了後に execute_sql で実行)
--
-- 背景: supabase_migrations.schema_migrations に 053 が二重 apply 履歴で
--       2 行登録されている (確認済):
--         - 20260515153619 / 053_shifts_tentative_approval (古い)
--         - 20260515161714 / 053_shifts_tentative_approval (新しい)
--       schema_migrations は migration apply 自身のログテーブルなので、本
--       migration の tx 内では DELETE せず、apply 完了後に別 tx で手動実行する。
--
-- DELETE FROM supabase_migrations.schema_migrations
--   WHERE version = '20260515153619'
--     AND name    = '053_shifts_tentative_approval';
--
-- 期待: 実行後 SELECT version, name FROM supabase_migrations.schema_migrations
--       WHERE name LIKE '%053%' は 1 行 (20260515161714) のみ返ること。
-- ============================================================
