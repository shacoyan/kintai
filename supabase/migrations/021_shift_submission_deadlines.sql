-- 021_shift_submission_deadlines.sql
-- 目的: 月次シフト希望提出締切を tenant×store×target_month 単位で管理
-- 前段: Loop B/D の (tenant_id, store_id) 分離パターンを踏襲
-- ロールバック: DROP TABLE shift_submission_deadlines;

BEGIN;

CREATE TABLE IF NOT EXISTS public.shift_submission_deadlines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id      uuid NOT NULL REFERENCES public.stores(id)  ON DELETE CASCADE,
  target_month  date NOT NULL,
  deadline_at   timestamptz NOT NULL,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, target_month)
);

CREATE INDEX IF NOT EXISTS idx_ssd_tenant_store_month
  ON public.shift_submission_deadlines (tenant_id, store_id, target_month DESC);

ALTER TABLE public.shift_submission_deadlines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ssd_select_by_store_member ON public.shift_submission_deadlines;
CREATE POLICY ssd_select_by_store_member
  ON public.shift_submission_deadlines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      JOIN public.tenant_members tm ON tm.tenant_id = s.tenant_id
      WHERE s.id = shift_submission_deadlines.store_id
        AND tm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS ssd_modify_by_owner_or_manager ON public.shift_submission_deadlines;
CREATE POLICY ssd_modify_by_owner_or_manager
  ON public.shift_submission_deadlines FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      JOIN public.tenant_members tm ON tm.tenant_id = s.tenant_id
      WHERE s.id = shift_submission_deadlines.store_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner','manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      JOIN public.tenant_members tm ON tm.tenant_id = s.tenant_id
      WHERE s.id = shift_submission_deadlines.store_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner','manager')
    )
  );

CREATE OR REPLACE FUNCTION public.touch_ssd_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ssd_touch ON public.shift_submission_deadlines;
CREATE TRIGGER trg_ssd_touch
  BEFORE UPDATE ON public.shift_submission_deadlines
  FOR EACH ROW EXECUTE FUNCTION public.touch_ssd_updated_at();

COMMIT;
