-- Migration: 057_tasks_projects_schema.sql
-- Purpose: tasks / projects テーブル新設 + 共通トリガ関数 touch_updated_at + tasks_set_completed_at
-- Depends: 056 (tenant_members.is_parttime)、tenants / stores / store_members は既存
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_tasks_completed_at ON public.tasks;
--   DROP TRIGGER IF EXISTS trg_tasks_touch_updated_at ON public.tasks;
--   DROP TRIGGER IF EXISTS trg_projects_touch_updated_at ON public.projects;
--   DROP TABLE IF EXISTS public.tasks;
--   DROP TABLE IF EXISTS public.projects;
--   DROP FUNCTION IF EXISTS public.tasks_set_completed_at();
--   DROP FUNCTION IF EXISTS public.touch_updated_at();

-- 共通トリガ関数: updated_at 自動更新 (search_path 固定で hardening)
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- projects テーブル新設
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- tasks テーブル新設
CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assignee_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_projects_tenant_status ON public.projects (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_tenant_store  ON public.projects (tenant_id, store_id);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status     ON public.tasks (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_store      ON public.tasks (tenant_id, store_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee          ON public.tasks (assignee_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date_active   ON public.tasks (due_date) WHERE status NOT IN ('done','cancelled');
CREATE INDEX IF NOT EXISTS idx_tasks_project           ON public.tasks (project_id);

-- updated_at 自動更新トリガ
DROP TRIGGER IF EXISTS trg_projects_touch_updated_at ON public.projects;
CREATE TRIGGER trg_projects_touch_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_tasks_touch_updated_at ON public.tasks;
CREATE TRIGGER trg_tasks_touch_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- completed_at 自動制御
CREATE OR REPLACE FUNCTION public.tasks_set_completed_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('done','cancelled') AND OLD.status NOT IN ('done','cancelled') THEN
    NEW.completed_at = now();
  ELSIF NEW.status NOT IN ('done','cancelled') THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_completed_at ON public.tasks;
CREATE TRIGGER trg_tasks_completed_at
  BEFORE UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_set_completed_at();
