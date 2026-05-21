-- migration: 056_tenant_members_parttime
-- purpose : tenant_members に is_parttime (バイト判定) を追加。Phase 1 タスク管理で staff 権限を厳密化。
-- depends : 017_multi_store_role_and_manager (tenant_members.role CHECK = 'owner'/'manager'/'staff')
-- rollback: ALTER TABLE public.tenant_members DROP COLUMN IF EXISTS is_parttime;
--           DROP INDEX IF EXISTS public.idx_tenant_members_parttime;

ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS is_parttime BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tenant_members_parttime
  ON public.tenant_members(tenant_id, user_id)
  WHERE is_parttime = true;

COMMENT ON COLUMN public.tenant_members.is_parttime IS
  'true=バイト判定。Phase 1 タスク管理で staff の権限を厳密化 (RLS 経由)。owner/manager は常時 false 想定';
