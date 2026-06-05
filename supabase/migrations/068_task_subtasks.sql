-- ==============================================================================
-- Migration: 068_task_subtasks.sql
-- Purpose: タスクに子タスク(サブタスク)対応。tasks.parent_task_id 列追加(親→子の1段のみ・孫禁止)
--         + 部分index + tasks_validate_refs を拡張して整合/循環防止を担保。
-- Depends: 057(tasks) / 058(tasks_validate_refs, RLS) / 059 / 067(task_assignees)
-- 既存データ影響ゼロ: 全タスクが parent_task_id NULL = トップレベル化。
--   ADD COLUMN ... NULL は Postgres 11+ で metadata-only(全行書き換えなし)。
-- Rollback 手順:
--   1) UPDATE public.tasks SET parent_task_id = NULL WHERE parent_task_id IS NOT NULL;
--   2) tasks_validate_refs を 058 版に復元(parent ブロック除去 + 発火列から parent_task_id 除去 = 058 を再 apply);
--   3) DROP INDEX IF EXISTS public.idx_tasks_parent;
--   4) ALTER TABLE public.tasks DROP COLUMN IF EXISTS parent_task_id;
-- ==============================================================================

-- 1) Add parent_task_id column (self-referencing FK, ON DELETE CASCADE)
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE;

-- 2) Partial index for parent lookups
CREATE INDEX IF NOT EXISTS idx_tasks_parent
  ON public.tasks (parent_task_id)
  WHERE parent_task_id IS NOT NULL;

-- 3) Extend tasks_validate_refs() with parent_task_id validation block
CREATE OR REPLACE FUNCTION public.tasks_validate_refs()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_project_tenant uuid;
  v_store_tenant   uuid;
  v_parent_tenant  uuid;
  v_parent_parent  uuid;
  v_parent_store   uuid;
  v_parent_project uuid;
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    SELECT tenant_id INTO v_project_tenant FROM public.projects WHERE id = NEW.project_id;
    IF v_project_tenant IS NULL THEN
      RAISE EXCEPTION 'project not found: %', NEW.project_id USING ERRCODE='23503';
    END IF;
    IF v_project_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'project.tenant_id mismatch' USING ERRCODE='23514';
    END IF;
  END IF;

  IF NEW.store_id IS NOT NULL THEN
    SELECT tenant_id INTO v_store_tenant FROM public.stores WHERE id = NEW.store_id;
    IF v_store_tenant IS NULL THEN
      RAISE EXCEPTION 'store not found: %', NEW.store_id USING ERRCODE='23503';
    END IF;
    IF v_store_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'store.tenant_id mismatch' USING ERRCODE='23514';
    END IF;
  END IF;

  IF NEW.assignee_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_id = NEW.tenant_id AND user_id = NEW.assignee_user_id
    ) THEN
      RAISE EXCEPTION 'assignee not a member of tenant' USING ERRCODE='23514';
    END IF;
  END IF;

  -- ▼ 追加 (068): parent_task_id 検証 (1段制限 + 循環防止 + tenant 整合)
  IF NEW.parent_task_id IS NOT NULL THEN
    -- 1. 自己参照禁止
    IF NEW.parent_task_id = NEW.id THEN
      RAISE EXCEPTION 'task cannot be its own parent' USING ERRCODE='23514';
    END IF;

    -- 2. 親行の存在確認 (+ tenant / 親の親 / store / project を取得)
    SELECT tenant_id, parent_task_id, store_id, project_id
      INTO v_parent_tenant, v_parent_parent, v_parent_store, v_parent_project
      FROM public.tasks
     WHERE id = NEW.parent_task_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'parent task not found: %', NEW.parent_task_id USING ERRCODE='23503';
    END IF;

    -- 3. 1段制限: 親が既に子 (parent を持つ) なら孫になるため拒否
    IF v_parent_parent IS NOT NULL THEN
      RAISE EXCEPTION 'subtask depth limit: parent is already a subtask' USING ERRCODE='23514';
    END IF;

    -- 4. tenant 整合 (cross-tenant 偽装防止)
    IF v_parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'parent.tenant_id mismatch' USING ERRCODE='23514';
    END IF;

    -- 5. 逆経路封鎖: 既に子を持つタスクは他タスクの子になれない (親→子降格禁止)
    IF EXISTS (SELECT 1 FROM public.tasks WHERE parent_task_id = NEW.id) THEN
      RAISE EXCEPTION 'task with children cannot become a subtask' USING ERRCODE='23514';
    END IF;
  END IF;
  -- ▲ 追加 (068) ここまで

  RETURN NEW;
END;
$$;

-- 4) Recreate trigger with parent_task_id in the UPDATE OF column list
DROP TRIGGER IF EXISTS trg_tasks_validate_refs ON public.tasks;

CREATE TRIGGER trg_tasks_validate_refs
  BEFORE INSERT OR UPDATE OF tenant_id, project_id, store_id, assignee_user_id, parent_task_id
  ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.tasks_validate_refs();

-- ==============================================================================
-- Rollback (commented out — execute manually if needed)
-- ==============================================================================
-- UPDATE public.tasks SET parent_task_id = NULL WHERE parent_task_id IS NOT NULL;
-- -- Then re-apply 058 to restore the original tasks_validate_refs (without parent block)
-- -- and recreate trigger without parent_task_id in UPDATE OF column list.
-- DROP INDEX IF EXISTS public.idx_tasks_parent;
-- ALTER TABLE public.tasks DROP COLUMN IF EXISTS parent_task_id;
