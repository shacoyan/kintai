-- 074_daily_reports.sql
-- Loop B — 日報「手入力データ」テーブル（店舗×営業日 1 レコード）。
-- 設計書: .company/engineering/docs/2026-06-10-kintai-daily-monthly-reports-loopB.md §2
--
-- 方針:
--  - 粒度 = (tenant_id, store_id, business_date) で 1 行。UNIQUE で UPSERT 可能。
--  - 手入力のみを持つ（Square 売上/客数/tender・人件費は列に持たず、集計 RPC が合成）。
--  - オーナー裁定1: インセンティブ＝バック金額は同一物 → incentive 1列に統合（staff_back_total は作らない）。
--  - 金種は 9 列 + cash_total を GENERATED ALWAYS（Σ 金種×額面）STORED。
--  - 違算 discrepancy_amount は手動上書き用の任意列（NULL=自動算出を RPC が使う）。
--  - RLS（裁定2）: 自店所属の全スタッフ（parttime 含む）が自店行を SELECT/INSERT/UPDATE 可。DELETE は managerial のみ。
--
-- 流用ヘルパ（既存・新規作成しない）:
--  - public.get_my_tenant_ids()        → SETOF uuid（031 / 037, SECURITY DEFINER）
--  - public.is_tenant_managerial(uuid) → bool（058）
--  - public.is_my_store(uuid)          → bool（058）
--  - public.touch_updated_at()         → trigger（057）

CREATE TABLE IF NOT EXISTS public.daily_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id      UUID NOT NULL REFERENCES public.stores(id)  ON DELETE CASCADE,
  business_date DATE NOT NULL,

  -- ── 支出（手入力・円・integer）。人件費は除外（Loop C 自動算出）。
  -- ⚠️ オーナー裁定1: インセンティブ＝バック金額は同一物。staff_back_total は新設しない。
  --    インセンティブ（個人歩合バック含む）は incentive 1列に統合。
  incentive            INTEGER NOT NULL DEFAULT 0 CHECK (incentive            >= 0),  -- インセンティブ（＝スタッフへのバック金額。同一物）
  expense_drink        INTEGER NOT NULL DEFAULT 0 CHECK (expense_drink        >= 0),  -- 酒代(ドリンク)
  expense_food         INTEGER NOT NULL DEFAULT 0 CHECK (expense_food         >= 0),  -- フード
  expense_flavor       INTEGER NOT NULL DEFAULT 0 CHECK (expense_flavor       >= 0),  -- フレーバー(シーシャ)
  expense_supplies     INTEGER NOT NULL DEFAULT 0 CHECK (expense_supplies     >= 0),  -- 消耗品
  expense_other        INTEGER NOT NULL DEFAULT 0 CHECK (expense_other        >= 0),  -- その他

  -- ── シーシャ提供本数（手入力）
  shisha_count         INTEGER NOT NULL DEFAULT 0 CHECK (shisha_count         >= 0),

  -- ── レジ金集計：金種別「枚数」9 種（9 列 + cash_total GENERATED）
  cash_count_10000     INTEGER NOT NULL DEFAULT 0 CHECK (cash_count_10000     >= 0),
  cash_count_5000      INTEGER NOT NULL DEFAULT 0 CHECK (cash_count_5000      >= 0),
  cash_count_1000      INTEGER NOT NULL DEFAULT 0 CHECK (cash_count_1000      >= 0),
  cash_count_500       INTEGER NOT NULL DEFAULT 0 CHECK (cash_count_500       >= 0),
  cash_count_100       INTEGER NOT NULL DEFAULT 0 CHECK (cash_count_100       >= 0),
  cash_count_50        INTEGER NOT NULL DEFAULT 0 CHECK (cash_count_50        >= 0),
  cash_count_10        INTEGER NOT NULL DEFAULT 0 CHECK (cash_count_10        >= 0),
  cash_count_5         INTEGER NOT NULL DEFAULT 0 CHECK (cash_count_5         >= 0),
  cash_count_1         INTEGER NOT NULL DEFAULT 0 CHECK (cash_count_1         >= 0),
  -- 現金合計（= Σ 金種×額面）は GENERATED 列で自動算出。手入力させない。
  cash_total           BIGINT GENERATED ALWAYS AS (
      cash_count_10000::bigint * 10000 + cash_count_5000::bigint * 5000 + cash_count_1000::bigint * 1000
    + cash_count_500::bigint   * 500   + cash_count_100::bigint  * 100  + cash_count_50::bigint   * 50
    + cash_count_10::bigint    * 10    + cash_count_5::bigint    * 5    + cash_count_1::bigint    * 1
  ) STORED,

  -- ── 違算・プール
  -- discrepancy_amount: 手動上書き用の任意列（NULL=RPC 自動算出 cash_total − Square cash_amount を使う）。
  --   実態の例外（釣銭準備金の持ち出し等）を注記したい時のみ手入力。符号許容のため CHECK 無し。
  discrepancy_amount   INTEGER,
  -- pool_amount: プール金額（手入力・自動算出不可）。持ち出しマイナス許容のため CHECK 無し・DEFAULT 0。
  pool_amount          INTEGER NOT NULL DEFAULT 0,

  -- ── 備考
  note                 TEXT,

  -- ── 監査
  created_by           UUID NOT NULL REFERENCES auth.users(id),
  updated_by           UUID REFERENCES auth.users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, store_id, business_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_reports_tenant_store_date
  ON public.daily_reports (tenant_id, store_id, business_date);
CREATE INDEX IF NOT EXISTS idx_daily_reports_tenant_date
  ON public.daily_reports (tenant_id, business_date);

-- ── updated_at 自動更新トリガ（既存 touch_updated_at 流用）
DROP TRIGGER IF EXISTS trg_daily_reports_touch_updated_at ON public.daily_reports;
CREATE TRIGGER trg_daily_reports_touch_updated_at
  BEFORE UPDATE ON public.daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── cross-tenant 検証トリガ（058 projects_validate_refs と同型・FK 偽装防止）
CREATE OR REPLACE FUNCTION public.daily_reports_validate_refs()
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

DROP TRIGGER IF EXISTS trg_daily_reports_validate_refs ON public.daily_reports;
CREATE TRIGGER trg_daily_reports_validate_refs
  BEFORE INSERT OR UPDATE OF tenant_id, store_id ON public.daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.daily_reports_validate_refs();

-- ── RLS（裁定2: 自店の全スタッフ書き込み可・4 操作横串）
ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;

-- SELECT = tenant 内かつ（managerial or 自店）
DROP POLICY IF EXISTS daily_reports_select ON public.daily_reports;
CREATE POLICY daily_reports_select ON public.daily_reports
  FOR SELECT USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (is_tenant_managerial(tenant_id) OR is_my_store(store_id))
  );

-- INSERT = managerial or 自店（parttime 含む全スタッフ）。created_by = auth.uid() 強制。
DROP POLICY IF EXISTS daily_reports_insert ON public.daily_reports;
CREATE POLICY daily_reports_insert ON public.daily_reports
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND created_by = auth.uid()
    AND (
      is_tenant_managerial(tenant_id)
      OR is_my_store(store_id)
    )
  );

-- UPDATE = managerial or 自店
DROP POLICY IF EXISTS daily_reports_update ON public.daily_reports;
CREATE POLICY daily_reports_update ON public.daily_reports
  FOR UPDATE
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      is_tenant_managerial(tenant_id)
      OR is_my_store(store_id)
    )
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      is_tenant_managerial(tenant_id)
      OR is_my_store(store_id)
    )
  );

-- DELETE = managerial のみ（誤削除防止）
DROP POLICY IF EXISTS daily_reports_delete ON public.daily_reports;
CREATE POLICY daily_reports_delete ON public.daily_reports
  FOR DELETE USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND is_tenant_managerial(tenant_id)
  );
