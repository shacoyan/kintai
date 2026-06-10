-- 075_store_monthly_settings.sql
-- Loop B — 月次固定マスタ（店舗×年×月 1 レコード）。固定費6 ＋ 売上目標のみ。
-- 設計書: .company/engineering/docs/2026-06-10-kintai-daily-monthly-reports-loopB.md §3
--
-- 方針:
--  - 粒度 = (tenant_id, store_id, year, month) で 1 行。UNIQUE で UPSERT 可能。
--  - 固定費6（社員人件費/賃借料/水道光熱費/通信費/広告費/その他販管費）＋ 売上目標 のみを持つ。
--  - 社員人件費は店舗合算手入力 fixed_payroll_employee を正本（凍結値）とする（§3.2）。
--  - ⚠️ オーナー裁定3: 料率・税率（card/external/tax の bps）は本テーブルに持たない。
--      全店一律固定 → 集計 RPC（076）内の定数で扱う。
--  - RLS（裁定2の帰結・§3.4-3.5）: 経営数値のため SELECT/INSERT/UPDATE/DELETE すべて
--      is_tenant_managerial（owner/manager）限定。staff には直 SELECT も許さない。
--      staff が月報の派生指標を見る経路は集計 RPC（SECURITY DEFINER）経由で別途用意（§4.6）。
--
-- 流用ヘルパ（既存・新規作成しない）:
--  - public.get_my_tenant_ids()        → SETOF uuid（031 / 037）
--  - public.is_tenant_managerial(uuid) → bool（058）
--  - public.touch_updated_at()         → trigger（057）

CREATE TABLE IF NOT EXISTS public.store_monthly_settings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id      UUID NOT NULL REFERENCES public.stores(id)  ON DELETE CASCADE,
  year          SMALLINT NOT NULL CHECK (year  BETWEEN 2000 AND 2100),
  month         SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),

  -- ── 月次固定費（円・integer）。社員人件費は §3.2 の判断で「店舗合算手入力」を採用（凍結値）。
  fixed_payroll_employee   INTEGER NOT NULL DEFAULT 0 CHECK (fixed_payroll_employee >= 0),  -- 社員人件費(固定)
  rent                     INTEGER NOT NULL DEFAULT 0 CHECK (rent            >= 0),  -- 賃借料
  utilities                INTEGER NOT NULL DEFAULT 0 CHECK (utilities       >= 0),  -- 水道光熱費
  communication            INTEGER NOT NULL DEFAULT 0 CHECK (communication   >= 0),  -- 通信費
  advertising              INTEGER NOT NULL DEFAULT 0 CHECK (advertising     >= 0),  -- 広告宣伝費
  other_sga_fixed          INTEGER NOT NULL DEFAULT 0 CHECK (other_sga_fixed >= 0),  -- その他販管費(固定)

  -- ── 売上目標（円・integer）
  sales_target             INTEGER NOT NULL DEFAULT 0 CHECK (sales_target    >= 0),  -- 売上目標【月間】

  -- ⚠️ オーナー裁定3により料率・税率3列（fee_rate_card_bps / fee_rate_external_bps / tax_rate_bps）は持たない。
  --    全店一律固定 → 集計 RPC（076）内の定数で扱う（消費税=×10/110, カード=3.25%, Paypay=1.98%）。

  -- ── 監査
  created_by    UUID NOT NULL REFERENCES auth.users(id),
  updated_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, store_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_store_monthly_settings_tenant_store_period
  ON public.store_monthly_settings (tenant_id, store_id, year, month);
CREATE INDEX IF NOT EXISTS idx_store_monthly_settings_tenant_period
  ON public.store_monthly_settings (tenant_id, year, month);

-- ── updated_at 自動更新トリガ（既存 touch_updated_at 流用）
DROP TRIGGER IF EXISTS trg_store_monthly_settings_touch_updated_at ON public.store_monthly_settings;
CREATE TRIGGER trg_store_monthly_settings_touch_updated_at
  BEFORE UPDATE ON public.store_monthly_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── cross-tenant 検証トリガ（058 projects_validate_refs と同型・FK 偽装防止）
CREATE OR REPLACE FUNCTION public.store_monthly_settings_validate_refs()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_store_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_store_tenant FROM public.stores WHERE id = NEW.store_id;
  IF v_store_tenant IS NULL THEN
    RAISE EXCEPTION 'store not found: %', NEW.store_id USING ERRCODE='23503';
  END IF;
  IF v_store_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'store.tenant_id mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_store_monthly_settings_validate_refs ON public.store_monthly_settings;
CREATE TRIGGER trg_store_monthly_settings_validate_refs
  BEFORE INSERT OR UPDATE OF tenant_id, store_id ON public.store_monthly_settings
  FOR EACH ROW EXECUTE FUNCTION public.store_monthly_settings_validate_refs();

-- ── RLS（経営数値 → 4 操作すべて managerial 限定。§3.4-3.5）
ALTER TABLE public.store_monthly_settings ENABLE ROW LEVEL SECURITY;

-- SELECT = owner/manager のみ（経営数値を staff から隠す）
DROP POLICY IF EXISTS store_monthly_settings_select ON public.store_monthly_settings;
CREATE POLICY store_monthly_settings_select ON public.store_monthly_settings
  FOR SELECT USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND is_tenant_managerial(tenant_id)
  );

-- INSERT = owner/manager のみ。created_by = auth.uid() 強制。
DROP POLICY IF EXISTS store_monthly_settings_insert ON public.store_monthly_settings;
CREATE POLICY store_monthly_settings_insert ON public.store_monthly_settings
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND created_by = auth.uid()
    AND is_tenant_managerial(tenant_id)
  );

-- UPDATE = owner/manager のみ
DROP POLICY IF EXISTS store_monthly_settings_update ON public.store_monthly_settings;
CREATE POLICY store_monthly_settings_update ON public.store_monthly_settings
  FOR UPDATE
  USING      (tenant_id IN (SELECT get_my_tenant_ids()) AND is_tenant_managerial(tenant_id))
  WITH CHECK (tenant_id IN (SELECT get_my_tenant_ids()) AND is_tenant_managerial(tenant_id));

-- DELETE = owner/manager のみ
DROP POLICY IF EXISTS store_monthly_settings_delete ON public.store_monthly_settings;
CREATE POLICY store_monthly_settings_delete ON public.store_monthly_settings
  FOR DELETE USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND is_tenant_managerial(tenant_id)
  );
