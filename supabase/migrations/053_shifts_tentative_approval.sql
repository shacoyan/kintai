-- ============================================================
-- 053_shifts_tentative_approval.sql
-- シフト仮承認機能の追加 (Loop 1)
-- 設計書: .company/engineering/docs/2026-05-15-kintai-tentative-approval-loop1-techdesign.md
-- 作成日: 2026-05-16
-- ============================================================

BEGIN;

-- ============================================================
-- 1. CHECK制約の更新 (5値 → 6値)
-- ============================================================
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_status_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_status_check
  CHECK (status IN ('pending','tentative','approved','rejected','modified','cancelled'));

-- ============================================================
-- 2. 仮承認カラムの追加
-- ============================================================
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS tentative_approved_by uuid REFERENCES auth.users(id);
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS tentative_approved_at timestamptz;

-- ============================================================
-- 3. 部分インデックスの作成
-- ============================================================
CREATE INDEX IF NOT EXISTS shifts_tentative_idx
  ON public.shifts (tenant_id, store_id)
  WHERE status = 'tentative';

-- ============================================================
-- 4. 補助関数: is_store_manager
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_store_manager(
  p_tenant_id uuid,
  p_store_id  uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 0. tenant-store整合性チェック
  IF NOT EXISTS (
    SELECT 1
    FROM public.stores s
    WHERE s.id = p_store_id
      AND s.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'store % does not belong to tenant %', p_store_id, p_tenant_id;
  END IF;

  -- (a) テナントの owner または manager
  IF EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.role IN ('owner', 'manager')
  ) THEN
    RETURN true;
  END IF;

  -- (b) 店舗のマネージャー (store_members 経由)
  IF EXISTS (
    SELECT 1
    FROM public.store_members sm
    JOIN public.tenant_members tm ON tm.id = sm.member_id
    WHERE sm.store_id = p_store_id
      AND tm.user_id = auth.uid()
      AND sm.is_manager = true
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_store_manager(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_store_manager(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_store_manager(uuid, uuid) TO authenticated;

-- ============================================================
-- 5. RPC: approve_shift_tentative
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

  -- 6. 仮承認へ更新
  UPDATE public.shifts
  SET status = 'tentative',
      tentative_approved_by = auth.uid(),
      tentative_approved_at = now()
  WHERE id = p_shift_id
  RETURNING * INTO v_result;

  -- 7. 結果返却
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_shift_tentative(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_shift_tentative(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_shift_tentative(uuid) TO authenticated;

-- ============================================================
-- 6. RPC: approve_shift_final
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

  -- 6. 本承認へ更新
  UPDATE public.shifts
  SET status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = p_shift_id
  RETURNING * INTO v_result;

  -- 7. 結果返却
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_shift_final(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_shift_final(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_shift_final(uuid) TO authenticated;

-- ============================================================
-- 7. RPC: approve_store_shifts_final (一括本承認)
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

  -- 3. 一括更新: tentative → approved
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

  -- 4. 結果返却
  RETURN QUERY SELECT v_count, v_ids;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_store_shifts_final(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_store_shifts_final(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_store_shifts_final(uuid, uuid) TO authenticated;

-- ============================================================
-- 8. RPC: update_shift_time (仮承認後の時刻編集 / status は変更しない)
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_shift_time(
  p_shift_id   uuid,
  p_start_time time,
  p_end_time   time,
  p_store_id   uuid DEFAULT NULL
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

  -- 4a. 現状店舗の管理権限チェック
  IF NOT public.is_store_manager(v_shift.tenant_id, v_shift.store_id) THEN
    RAISE EXCEPTION 'permission denied: not a manager of current store %', v_shift.store_id;
  END IF;

  -- 4b. 店舗振替時は振替先店舗の管理権限もチェック
  IF p_store_id IS NOT NULL AND p_store_id <> v_shift.store_id THEN
    IF NOT public.is_store_manager(v_shift.tenant_id, p_store_id) THEN
      RAISE EXCEPTION 'permission denied: not a manager of target store %', p_store_id;
    END IF;
  END IF;

  -- 5. approvedシフトは編集不可
  IF v_shift.status = 'approved' THEN
    RAISE EXCEPTION 'cannot edit approved shift';
  END IF;

  -- 5a. 15分単位チェック
  IF EXTRACT(MINUTE FROM p_start_time)::int % 15 <> 0
     OR EXTRACT(SECOND FROM p_start_time)::int <> 0
     OR EXTRACT(MINUTE FROM p_end_time)::int % 15 <> 0
     OR EXTRACT(SECOND FROM p_end_time)::int <> 0 THEN
    RAISE EXCEPTION 'time must be aligned to 15-minute boundary: % - %', p_start_time, p_end_time;
  END IF;

  -- 6. 編集可能なステータスチェック
  IF v_shift.status NOT IN ('pending', 'tentative', 'modified') THEN
    RAISE EXCEPTION 'cannot edit shift with status: %', v_shift.status;
  END IF;

  -- 7. 時間更新 (original_*は初回変更時のみ保存 / store_idは任意更新 / statusは変更しない)
  UPDATE public.shifts
  SET start_time = p_start_time,
      end_time   = p_end_time,
      original_start_time = COALESCE(original_start_time, v_shift.start_time),
      original_end_time   = COALESCE(original_end_time, v_shift.end_time),
      store_id = COALESCE(p_store_id, store_id)
  WHERE id = p_shift_id
  RETURNING * INTO v_result;

  -- 8. 結果返却 (Q1 確定: status は維持)
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_shift_time(uuid, time, time, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_shift_time(uuid, time, time, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_shift_time(uuid, time, time, uuid) TO authenticated;

-- ============================================================
-- 9. RPC: cancel_shift_tentative (仮承認の取消 / tentative → pending)
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_shift_tentative(
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
    RAISE EXCEPTION 'permission denied: only owner/manager can cancel tentative approval';
  END IF;

  -- 4a. 店舗ガード: 当該店舗のマネージャー権限
  IF NOT public.is_store_manager(v_shift.tenant_id, v_shift.store_id) THEN
    RAISE EXCEPTION 'permission denied: not a manager of store %', v_shift.store_id;
  END IF;

  -- 5. 状態チェック: tentativeのみキャンセル可能
  IF v_shift.status != 'tentative' THEN
    RAISE EXCEPTION 'cannot cancel: not in tentative state';
  END IF;

  -- 6. 仮承認取り消し → pendingに戻す
  UPDATE public.shifts
  SET status = 'pending',
      tentative_approved_by = NULL,
      tentative_approved_at = NULL
  WHERE id = p_shift_id
  RETURNING * INTO v_result;

  -- 7. 結果返却
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_shift_tentative(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_shift_tentative(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_shift_tentative(uuid) TO authenticated;

-- ============================================================
-- 10. RPC: restore_shift (却下シフトの復元 / rejected → pending)
-- ============================================================
CREATE OR REPLACE FUNCTION public.restore_shift(
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
    RAISE EXCEPTION 'permission denied: only owner/manager can restore shifts';
  END IF;

  -- 5. 店舗ガード: 当該店舗のマネージャー権限
  IF NOT public.is_store_manager(v_shift.tenant_id, v_shift.store_id) THEN
    RAISE EXCEPTION 'permission denied: not a manager of store %', v_shift.store_id;
  END IF;

  -- 6. 状態チェック: rejectedのみ復元可能
  IF v_shift.status <> 'rejected' THEN
    RAISE EXCEPTION 'cannot restore: not in rejected state, current=%', v_shift.status;
  END IF;

  -- 7. rejected → pending に復元
  UPDATE public.shifts
  SET status = 'pending',
      reviewed_by = NULL,
      reviewed_at = NULL
  WHERE id = p_shift_id
  RETURNING * INTO v_result;

  -- 8. 結果返却
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restore_shift(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restore_shift(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.restore_shift(uuid) TO authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK 手順 (043 パターン踏襲)
-- ============================================================
-- 以下の SQL を順番に実行して、053 マイグレーションをロールバックします。
--
-- BEGIN;
--
-- -- 0. 既存の tentative データが存在する場合は、pending に戻す
-- --    (CHECK 制約を 5 値に戻す前に必須)
-- UPDATE public.shifts SET status = 'pending' WHERE status = 'tentative';
--
-- -- 1. RPC関数の削除 (6本)
-- DROP FUNCTION IF EXISTS public.restore_shift(uuid);
-- DROP FUNCTION IF EXISTS public.cancel_shift_tentative(uuid);
-- DROP FUNCTION IF EXISTS public.update_shift_time(uuid, time, time, uuid);
-- DROP FUNCTION IF EXISTS public.approve_store_shifts_final(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.approve_shift_final(uuid);
-- DROP FUNCTION IF EXISTS public.approve_shift_tentative(uuid);
--
-- -- 2. 補助関数の削除
-- DROP FUNCTION IF EXISTS public.is_store_manager(uuid, uuid);
--
-- -- 3. インデックスの削除
-- DROP INDEX IF EXISTS public.shifts_tentative_idx;
--
-- -- 4. 追加カラムの削除
-- ALTER TABLE public.shifts DROP COLUMN IF EXISTS tentative_approved_by;
-- ALTER TABLE public.shifts DROP COLUMN IF EXISTS tentative_approved_at;
--
-- -- 5. CHECK制約を5値に戻す
-- ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_status_check;
-- ALTER TABLE public.shifts ADD CONSTRAINT shifts_status_check
--   CHECK (status IN ('pending','approved','rejected','modified','cancelled'));
--
-- COMMIT;
-- ============================================================
