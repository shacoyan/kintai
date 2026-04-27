-- Loop 7 Engineer A: 給与の月締め確定 (payroll_runs / payroll_run_items / tenants.payroll_close_day)

-- A-1. tenants テーブルへのカラム追加
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS payroll_close_day SMALLINT NOT NULL DEFAULT 31
  CHECK (payroll_close_day BETWEEN 1 AND 31);

-- A-2. payroll_runs（月次確定の親）
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id      uuid REFERENCES public.stores(id) ON DELETE SET NULL, -- NULL=全店舗
  target_month  date NOT NULL,  -- 月初日（YYYY-MM-01）
  close_day     smallint NOT NULL,  -- 締め日のスナップショット
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  mode          text NOT NULL CHECK (mode IN ('actual','shift')),
  total_payment integer NOT NULL DEFAULT 0,
  finalized_at  timestamptz NOT NULL DEFAULT now(),
  finalized_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note          text,
  UNIQUE (tenant_id, store_id, target_month, mode)
);

-- A-3. payroll_run_items（個人別明細スナップショット）
CREATE TABLE IF NOT EXISTS public.payroll_run_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name    text NOT NULL,
  pay_type        text NOT NULL CHECK (pay_type IN ('hourly','monthly')),
  hourly_rate     integer NOT NULL DEFAULT 0,
  monthly_salary  integer NOT NULL DEFAULT 0,
  work_days       integer NOT NULL DEFAULT 0,
  normal_minutes  integer NOT NULL DEFAULT 0,
  night_minutes   integer NOT NULL DEFAULT 0,
  payment         integer NOT NULL DEFAULT 0
);

-- A-4. RLS
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_run_items ENABLE ROW LEVEL SECURITY;

-- payroll_runs: SELECT は store_member 全員、INSERT/DELETE は owner/manager
CREATE POLICY pr_select ON public.payroll_runs FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY pr_insert ON public.payroll_runs FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.tenant_members
            WHERE tenant_id = payroll_runs.tenant_id
              AND user_id = auth.uid()
              AND role IN ('owner','manager'))
  );

CREATE POLICY pr_delete ON public.payroll_runs FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.tenant_members
            WHERE tenant_id = payroll_runs.tenant_id
              AND user_id = auth.uid()
              AND role IN ('owner','manager'))
  );

-- payroll_run_items: 親 run の RLS に追従
CREATE POLICY pri_select ON public.payroll_run_items FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.payroll_runs r
            WHERE r.id = payroll_run_items.run_id
              AND r.tenant_id IN (
                SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
              ))
  );

CREATE POLICY pri_insert ON public.payroll_run_items FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.payroll_runs r
            JOIN public.tenant_members tm ON tm.tenant_id = r.tenant_id
            WHERE r.id = payroll_run_items.run_id
              AND tm.user_id = auth.uid()
              AND tm.role IN ('owner','manager'))
  );

CREATE POLICY pri_delete ON public.payroll_run_items FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.payroll_runs r
            JOIN public.tenant_members tm ON tm.tenant_id = r.tenant_id
            WHERE r.id = payroll_run_items.run_id
              AND tm.user_id = auth.uid()
              AND tm.role IN ('owner','manager'))
  );

-- Rollback 手順:
-- DROP TABLE IF EXISTS public.payroll_run_items CASCADE;
-- DROP TABLE IF EXISTS public.payroll_runs CASCADE;
-- ALTER TABLE public.tenants DROP COLUMN IF EXISTS payroll_close_day;

-- A-5. インデックス
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_month
  ON public.payroll_runs (tenant_id, target_month DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_run_items_run
  ON public.payroll_run_items (run_id);
