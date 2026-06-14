-- ============================================================================
-- 098_bulk_assign_tasks_multi.sql
--
-- Purpose (監査 item: bulk-assign-bypasses-task-assignees):
--   bulk_assign_tasks(uuid[], uuid) が tasks.assignee_user_id を直接 UPDATE して
--   いたため、複数担当の真実源である task_assignees (067) を迂回し二重管理に
--   なっていた。オーナー決定「複数担当 (task_assignees) に統一」に従い、
--   bulk_assign_tasks を set_task_assignees (067) と同型 = task_assignees を
--   真実源とする replace へ再定義する。
--
-- 真実源と単一列の関係 (067 で確立):
--   - task_assignees が担当者集合の真実源。
--   - tasks.assignee_user_id は「primary assignee (後方互換)」で、
--     trg_task_assignees_sync (067) が task_assignees の最古行 (created_at ASC,
--     user_id ASC) へ自動追従する。本 RPC は task_assignees のみを書き換え、
--     単一列はトリガに委ねる (二重管理を解消)。
--   - フロントの reader は全て assignee_user_ids 配列 (task_assignees 集約) を
--     参照しており、単一列を直接読む箇所は無い (grep 確認済) → reader 不破壊。
--
-- 挙動 (新):
--   p_task_ids の各 task について、担当者集合を {p_assignee} 1 名へ置換
--   (= 各 task に set_task_assignees(task, ARRAY[p_assignee]) 相当)。
--   既存の他担当は削除される (replace セマンティクス)。
--
-- authz: set_task_assignees と同条件。
--   managerial OR (非 parttime かつ自店舗 staff)。
--   ※ 従来 bulk は managerial のみだったが、複数担当統一に伴い
--     set_task_assignees と権限境界を一致させる (横串整合)。
--   cross-tenant 偽装防止: task_assignees_validate トリガ (067) が
--     各 user の tenant 所属を BEFORE INSERT で検証 (非メンバーは 23514)。
--
-- 戻り値: SETOF public.tasks (従来と同一シグネチャ / 同一戻り型) を維持し、
--   呼出側 (useTasks.bulkAssignTasks) の契約を壊さない。トリガ同期後の
--   最新 tasks 行を返す。
--
-- 共通方針: SECURITY DEFINER + SET search_path = public, pg_temp /
--   REVOKE PUBLIC,anon + GRANT authenticated / auth.uid() 必須。
--
-- Depends: 057 (tasks) / 058 (is_tenant_managerial, is_tenant_parttime,
--          is_my_store) / 060 (旧 bulk_assign_tasks) / 067 (task_assignees,
--          検証/同期トリガ, set_task_assignees)
-- Rollback:
--   060_task_rpc.sql の bulk_assign_tasks 定義を再 apply して戻す
--   (シグネチャ uuid[], uuid は不変なので CREATE OR REPLACE で復帰可能)。
-- ============================================================================

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
  v_user  uuid;
  v_count int;
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

  -- 該当タスクの存在数チェック (重複 ID 前提で DISTINCT 比較)
  SELECT count(*) INTO v_count
  FROM public.tasks
  WHERE id = ANY(p_task_ids);
  IF v_count <> (SELECT count(DISTINCT x) FROM unnest(p_task_ids) AS x) THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = 'P0002';
  END IF;

  -- 権限検査: 関係する全 task について set_task_assignees と同条件
  --   (managerial OR (非 parttime かつ自店舗 staff))。
  --   1 つでも満たさなければ拒否。
  IF EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = ANY(p_task_ids)
      AND NOT (
        public.is_tenant_managerial(t.tenant_id)
        OR ( NOT public.is_tenant_parttime(t.tenant_id)
             AND t.store_id IS NOT NULL
             AND public.is_my_store(t.store_id) )
      )
  ) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  -- task_assignees を真実源として置換 (replace セマンティクス):
  --   各 task の担当を {p_assignee} 1 名にする。
  --   1) p_assignee 以外の既存担当を削除
  DELETE FROM public.task_assignees ta
  WHERE ta.task_id = ANY(p_task_ids)
    AND ta.user_id <> p_assignee;

  --   2) p_assignee を upsert
  --      tenant_id は対象 task の tenant_id を採用。task_assignees_validate
  --      トリガ (067) が cross-tenant 所属を検証 (非メンバーは 23514)。
  INSERT INTO public.task_assignees (task_id, user_id, tenant_id)
  SELECT t.id, p_assignee, t.tenant_id
  FROM public.tasks t
  WHERE t.id = ANY(p_task_ids)
  ON CONFLICT (task_id, user_id) DO NOTHING;

  -- tasks.assignee_user_id (primary) は trg_task_assignees_sync が自動追従済。
  -- 同期後の最新 tasks 行を返す (従来と同一の SETOF tasks 契約)。
  RETURN QUERY
    SELECT t.*
    FROM public.tasks t
    WHERE t.id = ANY(p_task_ids);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bulk_assign_tasks(uuid[], uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bulk_assign_tasks(uuid[], uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.bulk_assign_tasks(uuid[], uuid) TO authenticated;

-- ============================================================================
-- 検証ヒント (apply 後に手動で確認):
--   -- 1) task_assignees が置換されること
--   SELECT public.bulk_assign_tasks(ARRAY['<task-uuid>']::uuid[], '<user-uuid>'::uuid);
--   SELECT task_id, user_id FROM public.task_assignees WHERE task_id = '<task-uuid>';
--   -- 期待: user_id が <user-uuid> の 1 行のみ
--   -- 2) primary 同期
--   SELECT id, assignee_user_id FROM public.tasks WHERE id = '<task-uuid>';
--   -- 期待: assignee_user_id = <user-uuid>
--   -- 3) 非メンバー指定で 23514
--   -- 4) 権限なし caller で 42501
-- ============================================================================
