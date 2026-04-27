-- 030_tenant_roles.sql
-- 目的:
--   A. tenant_roles テーブル新設 (役職マスタ: 名前 / デフォ時給 / デフォ月給 / 色 / sort_order)
--   B. tenant_members.role_id UUID NULL REFERENCES tenant_roles(id) ON DELETE SET NULL を追加
--   C. RLS: tenant 所属者全員 SELECT、owner/manager のみ INSERT/UPDATE/DELETE
-- 給与計算側のフォールバック (member.hourly_rate ?? role.default_hourly_rate ?? 0) は
--   フロント / payroll RPC 双方で実装する (本 migration ではビュー不要)。

BEGIN;

CREATE TABLE IF NOT EXISTS public.tenant_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  default_hourly_rate INTEGER NULL,         -- NULL ならフォールバック値なし
  default_monthly_salary INTEGER NULL,
  color TEXT NULL,                          -- 任意 (例: '#3b82f6'、UI バッジ用)
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tenant_roles_tenant
  ON public.tenant_roles(tenant_id, sort_order);

ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS role_id UUID NULL REFERENCES public.tenant_roles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_members_role_id
  ON public.tenant_members(role_id);

ALTER TABLE public.tenant_roles ENABLE ROW LEVEL SECURITY;

-- 給与情報 (default_hourly_rate / default_monthly_salary) を含むため
-- SELECT は owner / manager のみに制限する。
-- staff には役職名のみ返す VIEW を後続 loop で別途公開する想定。
CREATE POLICY "tenant_roles_select" ON public.tenant_roles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = tenant_roles.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner','manager')
    )
  );

-- owner / manager のみ INSERT / UPDATE / DELETE
CREATE POLICY "tenant_roles_modify_owner_manager" ON public.tenant_roles
  FOR ALL USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.role IN ('owner','manager')
    )
  ) WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.role IN ('owner','manager')
    )
  );

COMMIT;

-- [ROLLBACK]
-- BEGIN;
-- ALTER TABLE public.tenant_members DROP COLUMN IF EXISTS role_id;
-- DROP TABLE IF EXISTS public.tenant_roles CASCADE;
-- COMMIT;
