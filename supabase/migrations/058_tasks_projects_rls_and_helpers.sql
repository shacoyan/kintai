-- ==============================================================================
-- Migration: 058_tasks_projects_rls_and_helpers.sql
-- Purpose  : 補助関数 3 個 (is_tenant_managerial / is_my_store / is_tenant_parttime)
--            + RLS 4 操作 × 2 テーブル (tasks / projects)
--            + cross-tenant 検証トリガ
-- Depends  : 056 (is_parttime) / 057 (tasks / projects テーブル)
-- Rollback : 各 DROP POLICY / DROP TRIGGER / DROP FUNCTION を逆順実行
-- ==============================================================================

-- -------------------------------------------------------
-- 1. 補助関数 (SECURITY DEFINER + REVOKE PUBLIC/anon + GRANT authenticated)
-- -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_tenant_managerial(p_tenant_id uuid)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = p_tenant_id
      AND user_id = auth.uid()
      AND role IN ('owner','manager')
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_tenant_managerial(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_tenant_managerial(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_tenant_managerial(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_my_store(p_store_id uuid)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.store_members sm
    JOIN public.tenant_members tm ON tm.id = sm.member_id
    WHERE sm.store_id = p_store_id
      AND tm.user_id = auth.uid()
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_my_store(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_my_store(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_my_store(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_tenant_parttime(p_tenant_id uuid)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = p_tenant_id
      AND user_id = auth.uid()
      AND role = 'staff'
      AND is_parttime = true
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_tenant_parttime(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_tenant_parttime(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_tenant_parttime(uuid) TO authenticated;

-- -------------------------------------------------------
-- 2. RLS 有効化
-- -------------------------------------------------------

ALTER TABLE public.tasks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------
-- 3. projects RLS ポリシー (4 操作横串 + idempotent)
-- -------------------------------------------------------

DROP POLICY IF EXISTS projects_select ON public.projects;
CREATE POLICY projects_select ON public.projects
  FOR SELECT USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      store_id IS NULL
      OR is_tenant_managerial(tenant_id)
      OR is_my_store(store_id)
    )
  );

DROP POLICY IF EXISTS projects_insert ON public.projects;
CREATE POLICY projects_insert ON public.projects
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND created_by = auth.uid()
    AND NOT is_tenant_parttime(tenant_id)
    AND (
      is_tenant_managerial(tenant_id)
      OR (store_id IS NOT NULL AND is_my_store(store_id))
    )
  );

DROP POLICY IF EXISTS projects_update ON public.projects;
CREATE POLICY projects_update ON public.projects
  FOR UPDATE
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND NOT is_tenant_parttime(tenant_id)
    AND (
      is_tenant_managerial(tenant_id)
      OR (store_id IS NOT NULL AND is_my_store(store_id))
    )
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND NOT is_tenant_parttime(tenant_id)
    AND (
      is_tenant_managerial(tenant_id)
      OR (store_id IS NOT NULL AND is_my_store(store_id))
    )
  );

DROP POLICY IF EXISTS projects_delete ON public.projects;
CREATE POLICY projects_delete ON public.projects
  FOR DELETE USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND is_tenant_managerial(tenant_id)
  );

-- -------------------------------------------------------
-- 4. tasks RLS ポリシー (4 操作横串 + idempotent)
-- -------------------------------------------------------

DROP POLICY IF EXISTS tasks_select ON public.tasks;
CREATE POLICY tasks_select ON public.tasks
  FOR SELECT USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      store_id IS NULL
      OR is_tenant_managerial(tenant_id)
      OR is_my_store(store_id)
      OR assignee_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tasks_insert ON public.tasks;
CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND created_by = auth.uid()
    AND NOT is_tenant_parttime(tenant_id)
    AND (
      is_tenant_managerial(tenant_id)
      OR (store_id IS NOT NULL AND is_my_store(store_id))
    )
  );

DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      is_tenant_managerial(tenant_id)
      OR (NOT is_tenant_parttime(tenant_id) AND store_id IS NOT NULL AND is_my_store(store_id))
      OR assignee_user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      is_tenant_managerial(tenant_id)
      OR (NOT is_tenant_parttime(tenant_id) AND store_id IS NOT NULL AND is_my_store(store_id))
      OR assignee_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tasks_delete ON public.tasks;
CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      is_tenant_managerial(tenant_id)
      OR (
        NOT is_tenant_parttime(tenant_id)
        AND store_id IS NOT NULL
        AND is_my_store(store_id)
        AND created_by = auth.uid()
      )
    )
  );

-- -------------------------------------------------------
-- 5. Cross-tenant 検証トリガ (FK 偽装防止)
-- -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tasks_validate_refs()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_project_tenant uuid;
  v_store_tenant   uuid;
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_validate_refs ON public.tasks;
CREATE TRIGGER trg_tasks_validate_refs
  BEFORE INSERT OR UPDATE OF tenant_id, project_id, store_id, assignee_user_id
  ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_validate_refs();

CREATE OR REPLACE FUNCTION public.projects_validate_refs()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_store_tenant uuid;
BEGIN
  IF NEW.store_id IS NOT NULL THEN
    SELECT tenant_id INTO v_store_tenant FROM public.stores WHERE id = NEW.store_id;
    IF v_store_tenant IS NULL THEN
      RAISE EXCEPTION 'store not found' USING ERRCODE='23503';
    END IF;
    IF v_store_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'store.tenant_id mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_validate_refs ON public.projects;
CREATE TRIGGER trg_projects_validate_refs
  BEFORE INSERT OR UPDATE OF tenant_id, store_id
  ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_validate_refs();
