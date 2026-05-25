-- 065_member_store_payrolls.sql
-- Phase 1a: 店舗別人件費テーブル新設
-- データ破壊なし。既存 tenant_members.hourly_rate / monthly_salary はフォールバックとして温存。
-- 金額型は既存 tenant_members に揃え integer(円) を採用。

CREATE TABLE IF NOT EXISTS public.member_store_payrolls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  pay_type text NOT NULL CHECK (pay_type IN ('hourly', 'monthly')),
  hourly_rate integer CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  monthly_salary integer CHECK (monthly_salary IS NULL OR monthly_salary >= 0),
  night_shift_rate_multiplier numeric(4,2) NOT NULL DEFAULT 1.25 CHECK (night_shift_rate_multiplier >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, store_id)
);

CREATE INDEX IF NOT EXISTS member_store_payrolls_tenant_user_idx
  ON public.member_store_payrolls (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS member_store_payrolls_tenant_store_idx
  ON public.member_store_payrolls (tenant_id, store_id);

ALTER TABLE public.member_store_payrolls ENABLE ROW LEVEL SECURITY;

-- SELECT: tenant 内の active メンバーは閲覧可
CREATE POLICY "member_store_payrolls_select" ON public.member_store_payrolls
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (SELECT auth.uid())
    )
  );

-- INSERT/UPDATE/DELETE: owner / manager のみ
CREATE POLICY "member_store_payrolls_insert" ON public.member_store_payrolls
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "member_store_payrolls_update" ON public.member_store_payrolls
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "member_store_payrolls_delete" ON public.member_store_payrolls
  FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'manager')
    )
  );

-- updated_at trigger function (テーブル固有名で衝突回避)
CREATE OR REPLACE FUNCTION public.set_member_store_payrolls_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_member_store_payrolls_updated_at() FROM PUBLIC;

DROP TRIGGER IF EXISTS member_store_payrolls_set_updated_at ON public.member_store_payrolls;
CREATE TRIGGER member_store_payrolls_set_updated_at
  BEFORE UPDATE ON public.member_store_payrolls
  FOR EACH ROW EXECUTE FUNCTION public.set_member_store_payrolls_updated_at();

COMMENT ON TABLE public.member_store_payrolls IS
  '店舗別の人件費設定 (Phase 1a). 該当 (user,store) 行が無い場合は tenant_members.hourly_rate/monthly_salary をフォールバックとして使用する.';
