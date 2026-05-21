-- ============================================================================
-- 060_task_rpc.sql
--
-- Phase 1 Loop 2: タスク管理 SECURITY DEFINER RPC 3 個
--   1. complete_task(p_task_id uuid)        -> public.tasks
--   2. reopen_task(p_task_id uuid)          -> public.tasks
--   3. bulk_assign_tasks(p_task_ids uuid[], p_assignee uuid) -> SETOF public.tasks
--
-- 背景:
--   RLS だけでは UPDATE 0 件 (権限なし) を silent success として返してしまう。
--   重要なステータス遷移と一括 assignee 変更は SECURITY DEFINER RPC 経由で
--   silent failure を排除し、明示的な例外を上げる。
--
-- 共通方針 (052_review_correction_request_rpc.sql テンプレ踏襲):
--   - SECURITY DEFINER + SET search_path = public, pg_temp
--   - REVOKE EXECUTE FROM PUBLIC / anon, GRANT EXECUTE TO authenticated
--   - auth.uid() で認証必須 (NULL なら 28000)
--   - 関数内で権限再投影 (RLS bypass の代わりに明示検証)
--   - SELECT ... FOR UPDATE で対象行を排他取得 (race 遮断)
--   - completed_at は trigger trg_tasks_completed_at (057) が status 変更時に自動制御
--
-- エラーコード対応 (タスク指示書のメッセージ → SQLSTATE):
--   TASK_NOT_FOUND_OR_FORBIDDEN -> P0002 (no_data_found / 該当行なし or 権限なし)
--   TASK_ALREADY_DONE           -> 40001 (serialization_failure / 二重完了)
--   TASK_CANCELLED              -> 22023 (invalid_parameter_value / 操作不可状態)
--   TASK_NOT_DONE               -> 22023 (invalid_parameter_value / 状態前提違反)
--   permission denied (reopen / bulk_assign)         -> 42501 (insufficient_privilege)
--   not authenticated                                -> 28000
--   bulk_assign: assignee が同 tenant の member でない -> 22023
--
-- Depends: 056 (is_parttime) / 057 (tasks) / 058 (is_tenant_managerial)
-- Rollback:
--   DROP FUNCTION IF EXISTS public.bulk_assign_tasks(uuid[], uuid);
--   DROP FUNCTION IF EXISTS public.reopen_task(uuid);
--   DROP FUNCTION IF EXISTS public.complete_task(uuid);
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. complete_task(p_task_id uuid) -> public.tasks
--    権限: 自分が assignee_user_id, または is_tenant_managerial(tenant_id)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_task(p_task_id uuid)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_task public.tasks%ROWTYPE;
  v_is_managerial boolean;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  -- 排他ロックして取得
  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = 'P0002';
  END IF;

  -- 権限検査: managerial OR assignee 本人
  v_is_managerial := public.is_tenant_managerial(v_task.tenant_id);
  IF NOT (v_is_managerial OR v_task.assignee_user_id = v_user) THEN
    -- 存在を漏らさないため統一メッセージ
    RAISE EXCEPTION 'TASK_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = 'P0002';
  END IF;

  -- 状態前提検査
  IF v_task.status = 'done' THEN
    RAISE EXCEPTION 'TASK_ALREADY_DONE' USING ERRCODE = '40001';
  END IF;

  IF v_task.status = 'cancelled' THEN
    RAISE EXCEPTION 'TASK_CANCELLED' USING ERRCODE = '22023';
  END IF;

  -- UPDATE (completed_at は trg_tasks_completed_at が自動セット)
  UPDATE public.tasks
  SET status = 'done'
  WHERE id = p_task_id
  RETURNING * INTO v_task;

  IF NOT FOUND THEN
    -- 理論上ここには来ないが念のため
    RAISE EXCEPTION 'TASK_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_task;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_task(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_task(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.complete_task(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. reopen_task(p_task_id uuid) -> public.tasks
--    権限: managerial のみ (staff / parttime は不可)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reopen_task(p_task_id uuid)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_task public.tasks%ROWTYPE;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = 'P0002';
  END IF;

  -- 権限検査: managerial のみ
  IF NOT public.is_tenant_managerial(v_task.tenant_id) THEN
    RAISE EXCEPTION 'permission denied (manager/owner required)' USING ERRCODE = '42501';
  END IF;

  -- 状態前提検査
  IF v_task.status <> 'done' THEN
    RAISE EXCEPTION 'TASK_NOT_DONE' USING ERRCODE = '22023';
  END IF;

  -- UPDATE: status='in_progress' に戻す
  -- completed_at は trg_tasks_completed_at が status not in ('done','cancelled') 時に
  -- 自動で NULL クリアするため、明示的に書く必要はないが、念のため NULL を指定して
  -- 明示的に意図を表現する (trigger 動作とも一致)。
  UPDATE public.tasks
  SET status = 'in_progress',
      completed_at = NULL
  WHERE id = p_task_id
  RETURNING * INTO v_task;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_task;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reopen_task(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reopen_task(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.reopen_task(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. bulk_assign_tasks(p_task_ids uuid[], p_assignee uuid) -> SETOF public.tasks
--    権限: managerial のみ
--    cross-tenant 偽装防止: 全タスクの tenant_id を取得し、p_assignee が
--      全 tenant_id に対して tenant_members に存在することを検証
--    実装方針: 一括 UPDATE を SETOF tasks で RETURNING して返す
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_assign_tasks(
  p_task_ids uuid[],
  p_assignee uuid
)
RETURNS SETOF public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_count int;
  v_tenant_count int;
  v_missing_count int;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  -- 引数チェック
  IF p_task_ids IS NULL OR array_length(p_task_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_task_ids must be a non-empty array' USING ERRCODE = '22023';
  END IF;
  IF p_assignee IS NULL THEN
    RAISE EXCEPTION 'p_assignee must not be null' USING ERRCODE = '22023';
  END IF;

  -- 対象タスクを排他ロック (race 遮断)
  PERFORM 1
  FROM public.tasks
  WHERE id = ANY(p_task_ids)
  FOR UPDATE;

  -- 該当タスクの存在数チェック
  SELECT count(*) INTO v_count
  FROM public.tasks
  WHERE id = ANY(p_task_ids);
  IF v_count <> array_length(p_task_ids, 1) THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = 'P0002';
  END IF;

  -- 関係する tenant 全てに対して、caller が managerial であることを検証
  IF EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = ANY(p_task_ids)
      AND NOT public.is_tenant_managerial(t.tenant_id)
  ) THEN
    RAISE EXCEPTION 'permission denied (manager/owner required)' USING ERRCODE = '42501';
  END IF;

  -- cross-tenant 偽装防止:
  --   関係する tenant_id 集合の各 tenant について、p_assignee が tenant_members に
  --   存在することを確認。1 つでも欠ければ拒否。
  SELECT count(DISTINCT t.tenant_id) INTO v_tenant_count
  FROM public.tasks t
  WHERE t.id = ANY(p_task_ids);

  SELECT count(DISTINCT t.tenant_id) INTO v_missing_count
  FROM public.tasks t
  WHERE t.id = ANY(p_task_ids)
    AND NOT EXISTS (
      SELECT 1
      FROM public.tenant_members tm
      WHERE tm.tenant_id = t.tenant_id
        AND tm.user_id   = p_assignee
    );

  IF v_missing_count > 0 THEN
    RAISE EXCEPTION 'assignee not a member of all target tenants'
      USING ERRCODE = '22023';
  END IF;

  -- 一括 UPDATE + RETURNING SETOF
  RETURN QUERY
    UPDATE public.tasks
    SET assignee_user_id = p_assignee
    WHERE id = ANY(p_task_ids)
    RETURNING *;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bulk_assign_tasks(uuid[], uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bulk_assign_tasks(uuid[], uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.bulk_assign_tasks(uuid[], uuid) TO authenticated;

-- ============================================================================
-- 検証ヒント (apply 後に手動で確認):
--   SELECT routine_name, security_type FROM information_schema.routines
--   WHERE routine_schema='public'
--     AND routine_name IN ('complete_task','reopen_task','bulk_assign_tasks');
--   -- 期待: 3 行、security_type='DEFINER'
-- ============================================================================
