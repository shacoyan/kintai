-- ============================================================================
-- 081_monthly_report_tenant_scope.sql
-- ----------------------------------------------------------------------------
-- 目的:
--   月報「総合タブ」に同名「吸暮」が 2 つ並ぶテナント混在バグの修正。
--   根本原因（DB 実査 2026-06-10）は 076 の get_monthly_report_all(int,int) が
--   店舗列挙を `s.tenant_id IN (SELECT public.get_my_tenant_ids())`＝呼び出し
--   ユーザーの「全所属テナント横断」で行っていたこと。オーナーが旧「吸暮」
--   テナント（cacac6b2）と「株式会社SABABA」テナント（6650e979）の双方に
--   owner として所属しているため、両テナントの全 store が総合タブに混入する。
--
--   本 migration は「現在選択中のテナント」を RPC に伝える新シグネチャを追加し、
--   単一テナント限定 + fail-closed で混在を止める。
--
-- 対象 project: kintai = zjjbfffhbobwwxyvdszl
--   （apply 直前に list_projects で name 必ず確認。
--     receipt-scanner = zzopayofegpmdkwckstq への誤投入厳禁）
--
-- 依存: 076_report_aggregation_rpc.sql 適用済み（本体ロジックを複製・拡張）。
--       ヘルパ public.get_my_tenant_ids / is_tenant_managerial / is_my_store
--       （037 / 058）。SEC-1(072)/SEC-2(079)/SEC-3(080) には一切触れない。
--
-- 変更点（設計書 2026-06-10-kintai-monthly-report-tenant-scope.md §3.2）:
--   A-1. 新 get_monthly_report_all(int, int, uuid) を CREATE（旧 (int,int) は残置）。
--        - 冒頭で fail-closed ガード（p_tenant_id NULL / 非所属 → scope_ok:false）。
--        - 店舗列挙を `s.tenant_id = p_tenant_id` の単一テナント限定に。
--        - per-store 集計は新 4 引数版 get_monthly_report(.., p_tenant_id) を呼ぶ。
--        - それ以外（totals 集約・利益 null 秘匿・labor_source・戻り jsonb）は
--          076 と完全に同一。
--   A-2. get_monthly_report を DROP（旧 3 引数）→ DEFAULT NULL 付き 4 引数で再作成。
--        - スコープ判定に `AND (p_tenant_id IS NULL OR v_tenant_id = p_tenant_id)`。
--        - p_tenant_id IS NULL なら完全に従来挙動（後方互換）。
--   A-3. get_daily_report を DROP（旧 2 引数）→ DEFAULT NULL 付き 3 引数で再作成。
--        - 同上の任意 tenant 一致検証（深層防御）。
--
-- 新旧共存の理由（順序規律 DB apply 先行 → コード push）:
--   旧フロントは get_monthly_report_all(p_year, p_month) を 2 引数で呼ぶ。
--   デプロイ反映ラグ中に旧フロントが居る窓があるため、旧 _all(int,int) は
--   DROP せず残置（後日 Loop で 082 として DROP）。
--   単店 2 本（get_monthly_report / get_daily_report）は DROP 旧 → DEFAULT 付き
--   再作成にすることで、3 引数（2 引数）呼び出しが DEFAULT 版で解決され続け、
--   42883 / 42725（ambiguous）窓を作らない。
--
-- 冪等性: DROP IF EXISTS + CREATE で再実行安全。
-- 可逆性: §6 ロールバック手順（新 _all DROP / 単店 2 本を 076 の旧本体で再作成）。
-- データ破壊: なし（関数のみ）。
--
-- ⚠️ staff fail-safe（利益 null・settings null）/ 固定費込み P&L / 利益率表示 /
--    客数 4 セグ / 違算 Σ ロジックは 076 と 1 文字も変えていない。
--    差分は「引数追加・スコープ WHERE・per-store 呼び出しの第 4 引数」のみ。
-- ============================================================================


-- ============================================================================
-- (A-3) public.get_daily_report(p_store_id uuid, p_business_date date,
--                               p_tenant_id uuid DEFAULT NULL)
--     — 日報（Square 素値 + 手入力 + 違算）。深層防御で任意 tenant 一致検証。
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_daily_report(uuid, date);

CREATE OR REPLACE FUNCTION public.get_daily_report(
  p_store_id      uuid,
  p_business_date date,
  p_tenant_id     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- 日報は Square 素値 + 手入力 + 違算（cash_total − square cash）のみを返す。
  -- 税・手数料の定数計算は月報（get_monthly_report）側で行う（裁定3）。
  v_tenant_id     uuid;
  v_store_name    text;
  v_loc_name      text;
  v_scope_ok      boolean;

  v_square        jsonb;
  v_day           jsonb;       -- byDate[p_business_date]
  v_dr            public.daily_reports%ROWTYPE;
  v_report_exists boolean := false;

  v_cash_square   bigint := 0; -- Square tender 現金
  v_disc          bigint;      -- derived 違算（月報 v_disc_total bigint と整合）

  v_labor         integer := 0;
  v_labor_source  text := 'unavailable';
BEGIN
  -- 1. store の tenant_id / name を取得（存在しなければ scope_ok=false）。
  SELECT s.tenant_id, s.name
    INTO v_tenant_id, v_store_name
  FROM public.stores s
  WHERE s.id = p_store_id;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object(
      'store_id', p_store_id,
      'store_name', NULL,
      'business_date', p_business_date,
      'scope_ok', false
    );
  END IF;

  -- 2. 権限判定（自前スコープ・RLS バイパス対策）。
  --    p_tenant_id 指定時は store の実テナントと一致必須（深層防御）。
  --    p_tenant_id IS NULL なら従来挙動（後方互換）。
  v_scope_ok := (
    v_tenant_id IN (SELECT public.get_my_tenant_ids())
    AND (public.is_tenant_managerial(v_tenant_id) OR public.is_my_store(p_store_id))
    AND (p_tenant_id IS NULL OR v_tenant_id = p_tenant_id)
  );

  IF NOT v_scope_ok THEN
    RETURN jsonb_build_object(
      'store_id', p_store_id,
      'store_name', v_store_name,
      'business_date', p_business_date,
      'scope_ok', false
    );
  END IF;

  -- 3. Square 値（Loop A RPC を修飾名で内部呼び出し・二重 fail-closed）。
  --    store.name → CASE 変換 → location_name の 1 要素配列。
  v_loc_name := CASE WHEN v_store_name = 'こまいぬ' THEN '狛犬' ELSE v_store_name END;
  v_square := square_dashboard.get_sales_range_scoped(
                p_business_date, p_business_date, ARRAY[v_loc_name]
              );
  v_day := v_square -> 'byDate' -> (p_business_date::text);

  IF v_day IS NULL THEN
    v_day := '{}'::jsonb;
  END IF;
  v_cash_square := COALESCE((v_day ->> 'cash_amount')::bigint, 0);

  -- 4. daily_reports 手入力（自前スコープ WHERE を再適用）。
  SELECT dr.* INTO v_dr
  FROM public.daily_reports dr
  WHERE dr.store_id = p_store_id
    AND dr.business_date = p_business_date
    AND dr.tenant_id = v_tenant_id
    AND dr.tenant_id IN (SELECT public.get_my_tenant_ids())
    AND (public.is_tenant_managerial(dr.tenant_id) OR public.is_my_store(dr.store_id));
  v_report_exists := FOUND;

  -- 5. 違算（derived.discrepancy）。
  --    手動上書き（discrepancy_amount IS NOT NULL）があればそれを優先。
  --    無ければ RPC 算出 = cash_total − Square tender cash。
  IF v_report_exists AND v_dr.discrepancy_amount IS NOT NULL THEN
    v_disc := v_dr.discrepancy_amount;
  ELSIF v_report_exists THEN
    v_disc := COALESCE(v_dr.cash_total, 0)::bigint - v_cash_square;
  ELSE
    v_disc := NULL;
  END IF;

  -- 6. 人件費（Loop C 後結合・to_regprocedure 動的判定）。
  IF to_regprocedure('public.parttime_labor_for_store(uuid,date,date)') IS NOT NULL THEN
    EXECUTE 'SELECT public.parttime_labor_for_store($1,$2,$3)'
      INTO v_labor USING p_store_id, p_business_date, p_business_date;
    v_labor := COALESCE(v_labor, 0);
    v_labor_source := 'loop_c';
  ELSE
    v_labor := 0;
    v_labor_source := 'unavailable';
  END IF;

  -- 7. 契約 jsonb を組み立て。
  RETURN jsonb_build_object(
    'store_id', p_store_id,
    'store_name', v_store_name,
    'business_date', p_business_date,
    'scope_ok', true,
    'square', jsonb_build_object(
      'total_amount',          COALESCE((v_day ->> 'total_amount')::bigint, 0),
      'open_total_amount',     COALESCE((v_day ->> 'open_total_amount')::bigint, 0),
      'cash_amount',           COALESCE((v_day ->> 'cash_amount')::bigint, 0),
      'card_amount',           COALESCE((v_day ->> 'card_amount')::bigint, 0),
      'external_amount',       COALESCE((v_day ->> 'external_amount')::bigint, 0),
      'other_amount',          COALESCE((v_day ->> 'other_amount')::bigint, 0),
      'transaction_count',     COALESCE((v_day ->> 'transaction_count')::bigint, 0),
      'new_customer_count',    COALESCE((v_day ->> 'new_customer_count')::bigint, 0),
      'repeat_customer_count', COALESCE((v_day ->> 'repeat_customer_count')::bigint, 0),
      'regular_customer_count',COALESCE((v_day ->> 'regular_customer_count')::bigint, 0),
      'staff_customer_count',  COALESCE((v_day ->> 'staff_customer_count')::bigint, 0),
      -- 客数【総】= 4 セグ（unlisted 除外）。§4.5。
      'customer_total',        (
          COALESCE((v_day ->> 'new_customer_count')::bigint, 0)
        + COALESCE((v_day ->> 'repeat_customer_count')::bigint, 0)
        + COALESCE((v_day ->> 'regular_customer_count')::bigint, 0)
        + COALESCE((v_day ->> 'staff_customer_count')::bigint, 0)
      )
    ),
    'manual', CASE WHEN v_report_exists THEN jsonb_build_object(
      'incentive',        v_dr.incentive,        -- ＝バック金額（裁定1）
      'expense_drink',    v_dr.expense_drink,
      'expense_food',     v_dr.expense_food,
      'expense_flavor',   v_dr.expense_flavor,
      'expense_supplies', v_dr.expense_supplies,
      'expense_other',    v_dr.expense_other,
      'shisha_count',     v_dr.shisha_count,
      'cash_total',       v_dr.cash_total,        -- GENERATED
      'cash_counts', jsonb_build_object(
        '10000', v_dr.cash_count_10000, '5000', v_dr.cash_count_5000,
        '1000',  v_dr.cash_count_1000,  '500',  v_dr.cash_count_500,
        '100',   v_dr.cash_count_100,   '50',   v_dr.cash_count_50,
        '10',    v_dr.cash_count_10,    '5',    v_dr.cash_count_5,
        '1',     v_dr.cash_count_1
      ),
      'pool_amount',               v_dr.pool_amount,
      'discrepancy_amount_manual', v_dr.discrepancy_amount,  -- NULL=自動算出を使う
      'note',                      v_dr.note,
      'report_exists',             true
    ) ELSE jsonb_build_object(
      'incentive', 0,
      'expense_drink', 0, 'expense_food', 0, 'expense_flavor', 0,
      'expense_supplies', 0, 'expense_other', 0,
      'shisha_count', 0,
      'cash_total', 0,
      'cash_counts', jsonb_build_object(
        '10000',0,'5000',0,'1000',0,'500',0,'100',0,'50',0,'10',0,'5',0,'1',0
      ),
      'pool_amount', 0,
      'discrepancy_amount_manual', NULL,
      'note', NULL,
      'report_exists', false
    ) END,
    'labor', jsonb_build_object(
      'parttime_labor', v_labor,
      'source', v_labor_source
    ),
    'derived', jsonb_build_object(
      'discrepancy_amount', v_disc   -- = cash_total − square.cash_amount（手動上書き優先）
    )
  );
END;
$$;


-- ============================================================================
-- (A-2) public.get_monthly_report(p_store_id uuid, p_year int, p_month int,
--                                 p_tenant_id uuid DEFAULT NULL)
--     — 店舗別 月次 P&L。深層防御で任意 tenant 一致検証。
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_monthly_report(uuid, int, int);

CREATE OR REPLACE FUNCTION public.get_monthly_report(
  p_store_id  uuid,
  p_year      int,
  p_month     int,
  p_tenant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- ── 全店一律の料率・税率（裁定3）。変更はこの 3 定数のみ。──
  c_tax_num          CONSTANT integer := 10;
  c_tax_den          CONSTANT integer := 110;
  c_fee_card_bps     CONSTANT integer := 325;
  c_fee_external_bps CONSTANT integer := 198;

  v_tenant_id   uuid;
  v_store_name  text;
  v_loc_name    text;
  v_managerial  boolean;
  v_scope_ok    boolean;

  v_from        date;
  v_to          date;

  v_square      jsonb;
  v_by_date     jsonb;
  v_k           text;
  v_d           jsonb;

  -- Square 月集約（決済済みベース）
  v_sales_cash     bigint := 0;
  v_sales_card     bigint := 0;
  v_sales_external bigint := 0;
  v_sales_other    bigint := 0;
  v_sales_total    bigint := 0;   -- 決済済み total Σ
  v_open_total     bigint := 0;   -- open Σ（total_with_open 用）
  v_cust_new       bigint := 0;
  v_cust_repeat    bigint := 0;
  v_cust_regular   bigint := 0;
  v_cust_staff     bigint := 0;
  v_cust_total     bigint := 0;

  -- daily_reports 月集約（手入力）
  v_shisha        bigint := 0;
  v_incentive     bigint := 0;
  v_exp_drink     bigint := 0;
  v_exp_food      bigint := 0;
  v_exp_flavor    bigint := 0;
  v_exp_supplies  bigint := 0;
  v_exp_other     bigint := 0;
  v_disc_total    bigint := 0;   -- Σ(derived discrepancy)

  -- 派生
  v_avg_spend       numeric;
  v_fee_card        bigint := 0;
  v_fee_external    bigint := 0;
  v_cogs_variable   bigint := 0;
  v_sga_variable    bigint := 0;
  v_consumption_tax bigint := 0;
  v_achievement     numeric;
  v_prov_profit     bigint := 0;
  v_prov_rate       numeric;

  -- settings（固定費生値・売上目標）
  v_st            public.store_monthly_settings%ROWTYPE;
  v_settings_exists boolean := false;
  v_fixed_payroll integer := 0;
  v_rent          integer := 0;
  v_utilities     integer := 0;
  v_comm          integer := 0;
  v_adv           integer := 0;
  v_other_fixed   integer := 0;
  v_sales_target  integer := 0;

  -- 人件費（Loop C）
  v_labor        integer := 0;
  v_labor_source text := 'unavailable';

  v_settings_json jsonb;
  v_target_json   jsonb;
BEGIN
  -- 1. store 解決・権限判定。
  SELECT s.tenant_id, s.name INTO v_tenant_id, v_store_name
  FROM public.stores s WHERE s.id = p_store_id;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object(
      'store_id', p_store_id, 'store_name', NULL,
      'year', p_year, 'month', p_month, 'scope_ok', false
    );
  END IF;

  v_managerial := public.is_tenant_managerial(v_tenant_id);
  -- p_tenant_id 指定時は store の実テナントと一致必須（深層防御）。
  -- p_tenant_id IS NULL なら従来挙動（後方互換）。
  v_scope_ok := (
    v_tenant_id IN (SELECT public.get_my_tenant_ids())
    AND (v_managerial OR public.is_my_store(p_store_id))
    AND (p_tenant_id IS NULL OR v_tenant_id = p_tenant_id)
  );

  IF NOT v_scope_ok THEN
    RETURN jsonb_build_object(
      'store_id', p_store_id, 'store_name', v_store_name,
      'year', p_year, 'month', p_month, 'scope_ok', false
    );
  END IF;

  -- 2. 期間 = その月の初日〜末日。
  v_from := make_date(p_year, p_month, 1);
  v_to   := (v_from + INTERVAL '1 month - 1 day')::date;

  -- 3. Square 月集約（Loop A RPC を修飾名で・byDate を月内 SUM）。
  v_loc_name := CASE WHEN v_store_name = 'こまいぬ' THEN '狛犬' ELSE v_store_name END;
  v_square := square_dashboard.get_sales_range_scoped(v_from, v_to, ARRAY[v_loc_name]);
  v_by_date := COALESCE(v_square -> 'byDate', '{}'::jsonb);

  FOR v_k IN SELECT jsonb_object_keys(v_by_date) LOOP
    v_d := v_by_date -> v_k;
    v_sales_cash     := v_sales_cash     + COALESCE((v_d ->> 'cash_amount')::bigint, 0);
    v_sales_card     := v_sales_card     + COALESCE((v_d ->> 'card_amount')::bigint, 0);
    v_sales_external := v_sales_external + COALESCE((v_d ->> 'external_amount')::bigint, 0);
    v_sales_other    := v_sales_other    + COALESCE((v_d ->> 'other_amount')::bigint, 0);
    v_sales_total    := v_sales_total    + COALESCE((v_d ->> 'total_amount')::bigint, 0);
    v_open_total     := v_open_total     + COALESCE((v_d ->> 'open_total_amount')::bigint, 0);
    v_cust_new       := v_cust_new       + COALESCE((v_d ->> 'new_customer_count')::bigint, 0);
    v_cust_repeat    := v_cust_repeat    + COALESCE((v_d ->> 'repeat_customer_count')::bigint, 0);
    v_cust_regular   := v_cust_regular   + COALESCE((v_d ->> 'regular_customer_count')::bigint, 0);
    v_cust_staff     := v_cust_staff     + COALESCE((v_d ->> 'staff_customer_count')::bigint, 0);
  END LOOP;

  -- 客数【総】= 4 セグ（unlisted 除外）。§4.5。
  v_cust_total := v_cust_new + v_cust_repeat + v_cust_regular + v_cust_staff;

  -- 4. daily_reports 月集約（自前スコープ WHERE 再適用）。
  --    違算 Σ（設計 §4.3「過不足 = Σ_日次（手動上書き or cash_total − その日の square cash）」）:
  --      ・手動上書き行（discrepancy_amount IS NOT NULL）= その確定値をそのまま加算。
  --      ・自動算出行（discrepancy_amount IS NULL）= その日の cash_total − 同日 Square 現金。
  --        同日 Square 現金は v_by_date（byDate）から business_date キーで突合（無ければ 0）。
  --        日報のない日は加算対象外（過大控除しない）。
  SELECT
    COALESCE(sum(dr.shisha_count), 0),
    COALESCE(sum(dr.incentive), 0),
    COALESCE(sum(dr.expense_drink), 0),
    COALESCE(sum(dr.expense_food), 0),
    COALESCE(sum(dr.expense_flavor), 0),
    COALESCE(sum(dr.expense_supplies), 0),
    COALESCE(sum(dr.expense_other), 0),
    -- 違算 Σ_日次: 手動上書き優先、無ければ cash_total − 同日 Square 現金。
    COALESCE(sum(
      CASE WHEN dr.discrepancy_amount IS NOT NULL
           THEN dr.discrepancy_amount::bigint
           ELSE COALESCE(dr.cash_total, 0)::bigint
                - COALESCE((v_by_date -> dr.business_date::text ->> 'cash_amount')::bigint, 0)
      END
    ), 0)
  INTO
    v_shisha, v_incentive, v_exp_drink, v_exp_food, v_exp_flavor,
    v_exp_supplies, v_exp_other, v_disc_total
  FROM public.daily_reports dr
  WHERE dr.store_id = p_store_id
    AND dr.tenant_id = v_tenant_id
    AND dr.business_date BETWEEN v_from AND v_to
    AND dr.tenant_id IN (SELECT public.get_my_tenant_ids())
    AND (public.is_tenant_managerial(dr.tenant_id) OR public.is_my_store(dr.store_id));

  -- 5. store_monthly_settings（固定費生値・売上目標）。
  SELECT * INTO v_st
  FROM public.store_monthly_settings sms
  WHERE sms.store_id = p_store_id
    AND sms.tenant_id = v_tenant_id
    AND sms.year = p_year
    AND sms.month = p_month
    AND sms.tenant_id IN (SELECT public.get_my_tenant_ids());
  v_settings_exists := FOUND;

  IF v_settings_exists THEN
    v_fixed_payroll := v_st.fixed_payroll_employee;
    v_rent          := v_st.rent;
    v_utilities     := v_st.utilities;
    v_comm          := v_st.communication;
    v_adv           := v_st.advertising;
    v_other_fixed   := v_st.other_sga_fixed;
    v_sales_target  := v_st.sales_target;
  END IF;

  -- 6. 人件費（Loop C 後結合）。
  IF to_regprocedure('public.parttime_labor_for_store(uuid,date,date)') IS NOT NULL THEN
    EXECUTE 'SELECT public.parttime_labor_for_store($1,$2,$3)'
      INTO v_labor USING p_store_id, v_from, v_to;
    v_labor := COALESCE(v_labor, 0);
    v_labor_source := 'loop_c';
  ELSE
    v_labor := 0;
    v_labor_source := 'unavailable';
  END IF;

  -- 7. 派生指標（全店定数で税・手数料を計算）。
  v_fee_card     := round(v_sales_card::numeric     * c_fee_card_bps     / 10000);
  v_fee_external := round(v_sales_external::numeric * c_fee_external_bps / 10000);
  v_consumption_tax := round(v_sales_total::numeric * c_tax_num / c_tax_den);

  -- 売上原価【変動費】= 酒代 + フード + フレーバー
  v_cogs_variable := v_exp_drink + v_exp_food + v_exp_flavor;
  -- 販管費【変動費】= 消耗品 + その他 + インセンティブ + 決済手数料(クレジット+Paypay)
  -- ⚠️ インセンティブはここで 1 回だけ加算（独立科目 expenses.incentive とは別に二重加算しない）。
  v_sga_variable := v_exp_supplies + v_exp_other + v_incentive + v_fee_card + v_fee_external;

  -- 客単価 = 売上【総】÷ 客数【総】（客数 0 なら null）
  IF v_cust_total > 0 THEN
    v_avg_spend := round(v_sales_total::numeric / v_cust_total, 1);
  ELSE
    v_avg_spend := NULL;
  END IF;

  -- 目標達成率 = 売上【総】÷ sales_target（target 0 なら null）
  IF v_sales_target > 0 THEN
    v_achievement := round(v_sales_total::numeric / v_sales_target, 4);
  ELSE
    v_achievement := NULL;
  END IF;

  -- 暫定利益 = 売上【総】 − 原価 − 人件費 − 販管費
  v_prov_profit := v_sales_total - v_cogs_variable - v_labor - v_sga_variable;
  IF v_sales_total > 0 THEN
    v_prov_rate := round(v_prov_profit::numeric / v_sales_total, 4);
  ELSE
    v_prov_rate := NULL;
  END IF;

  -- 8. settings / target の staff 非露出（裁定2帰結・§4.6）。
  --    managerial のみ固定費生値・売上目標生値を返す。staff は null（派生は返す）。
  IF v_managerial THEN
    v_settings_json := jsonb_build_object(
      'fixed_payroll_employee', v_fixed_payroll,
      'rent',                   v_rent,
      'utilities',              v_utilities,
      'communication',          v_comm,
      'advertising',            v_adv,
      'other_sga_fixed',        v_other_fixed
    );
    v_target_json := jsonb_build_object(
      'sales_target',     v_sales_target,
      'achievement_rate', v_achievement
    );
  ELSE
    v_settings_json := NULL;
    v_target_json := jsonb_build_object(
      'sales_target',     NULL,   -- 生値秘匿
      'achievement_rate', v_achievement  -- 派生は返す
    );
  END IF;

  -- 9. 契約 jsonb。
  RETURN jsonb_build_object(
    'store_id', p_store_id,
    'store_name', v_store_name,
    'year', p_year, 'month', p_month,
    'scope_ok', true,
    'settings_exists', v_settings_exists,
    'sales', jsonb_build_object(
      'cash',            v_sales_cash,
      'card',            v_sales_card,
      'external',        v_sales_external,
      'other',           v_sales_other,
      'total',           v_sales_total,             -- 決済済み（内訳と整合）
      'total_with_open', v_sales_total + v_open_total -- open 込み併記（§4.5）
    ),
    'customers', jsonb_build_object(
      'new',       v_cust_new,
      'repeat',    v_cust_repeat,
      'regular',   v_cust_regular,
      'staff',     v_cust_staff,
      'total',     v_cust_total,    -- 4 セグ（unlisted 除外）
      'avg_spend', v_avg_spend
    ),
    'shisha_count', v_shisha,
    'labor', jsonb_build_object(
      'parttime', v_labor,
      'source',   v_labor_source
    ),
    'expenses', jsonb_build_object(
      'incentive', v_incentive,   -- ＝バック統合（裁定1）
      'drink',     v_exp_drink,
      'food',      v_exp_food,
      'flavor',    v_exp_flavor,
      'supplies',  v_exp_supplies,
      'other',     v_exp_other
    ),
    'fees', jsonb_build_object(
      'card',     v_fee_card,      -- 売上クレジット×3.25%
      'external', v_fee_external   -- 売上Paypay×1.98%
    ),
    'cogs_variable',   v_cogs_variable,
    'sga_variable',    v_sga_variable,
    'consumption_tax', v_consumption_tax,
    'discrepancy_total', v_disc_total,
    'target', v_target_json,
    -- 利益額・利益率は managerial のみ生値、staff は null（裁定・案1）。
    -- 達成率・売上・客数・客単価・粗利は staff も返す。
    'provisional_profit',      CASE WHEN v_managerial THEN to_jsonb(v_prov_profit) ELSE 'null'::jsonb END,
    'provisional_profit_rate', CASE WHEN v_managerial THEN to_jsonb(v_prov_rate)   ELSE 'null'::jsonb END,
    'settings', v_settings_json   -- managerial のみ生値・staff は null
  );
END;
$$;


-- ============================================================================
-- (A-1) public.get_monthly_report_all(p_year int, p_month int, p_tenant_id uuid)
--     — 単一テナント限定 総合 P&L（新シグネチャ・旧 (int,int) は残置）。
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_monthly_report_all(
  p_year      int,
  p_month     int,
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stores      jsonb := '[]'::jsonb;
  v_one         jsonb;
  v_store_rec   record;
  v_any_scope   boolean := false;

  -- totals 集約
  v_t_sales      bigint := 0;
  v_t_cogs       bigint := 0;
  v_t_gross      bigint := 0;
  v_t_labor_pt   bigint := 0;
  v_t_labor_emp  bigint := 0;
  v_t_sga_var    bigint := 0;
  v_t_sga_fix    bigint := 0;
  v_t_op_profit  bigint := 0;
  v_t_cust       bigint := 0;
  v_op_rate      numeric;
  v_avg_spend    numeric;

  v_labor_any_unavailable boolean := false;
  -- 固定費非露出（settings null = staff）の店が混ざるか。混ざると固定費 0 扱いの
  -- 過大な営業利益になるため、totals の利益額・利益率を null 秘匿する（裁定・案1）。
  v_fixed_any_hidden boolean := false;
BEGIN
  -- fail-closed ガード（設計 §2.2）。
  --   p_tenant_id IS NULL: NULL を全テナント横断のフォールバックにしない（旧バグ再来防止）。
  --   非所属テナント: 呼び出しユーザーが所属しないテナント ID を渡しても scope_ok:false。
  IF p_tenant_id IS NULL
     OR p_tenant_id NOT IN (SELECT public.get_my_tenant_ids()) THEN
    RETURN jsonb_build_object(
      'year', p_year, 'month', p_month, 'scope_ok', false,
      'stores', '[]'::jsonb
    );
  END IF;

  -- 単一テナント限定で store を列挙（managerial=全店 / staff=自店）。
  -- 各 store について get_monthly_report を新 4 引数版で呼び（第 4 引数に
  -- p_tenant_id を渡して per-store も同一テナント検証を二重にかける）、
  -- 店舗別サマリを stores[] に積み、totals を加算する。
  FOR v_store_rec IN
    SELECT s.id AS store_id, s.tenant_id
    FROM public.stores s
    WHERE s.tenant_id = p_tenant_id
      AND (public.is_tenant_managerial(s.tenant_id) OR public.is_my_store(s.id))
    ORDER BY s.name
  LOOP
    v_one := public.get_monthly_report(v_store_rec.store_id, p_year, p_month, p_tenant_id);

    -- scope_ok でない店は積まない（二重 fail-closed の保険）。
    IF (v_one ->> 'scope_ok')::boolean IS NOT TRUE THEN
      CONTINUE;
    END IF;
    v_any_scope := true;

    v_stores := v_stores || jsonb_build_array(v_one);

    -- totals 加算（決済済み total ベース）。
    v_t_sales := v_t_sales + COALESCE((v_one -> 'sales' ->> 'total')::bigint, 0);
    v_t_cogs  := v_t_cogs  + COALESCE((v_one ->> 'cogs_variable')::bigint, 0);
    v_t_sga_var := v_t_sga_var + COALESCE((v_one ->> 'sga_variable')::bigint, 0);
    v_t_labor_pt := v_t_labor_pt + COALESCE((v_one -> 'labor' ->> 'parttime')::bigint, 0);
    v_t_cust  := v_t_cust  + COALESCE((v_one -> 'customers' ->> 'total')::bigint, 0);

    -- 人件費(固定=社員) / 販管費(固定) は settings から。
    -- staff には settings が null で返るため、その場合は固定費を 0 とみなす
    -- （staff は固定費生値を見られない＝総合 P&L の固定費行も非露出になる）。
    IF (v_one -> 'settings') IS NOT NULL AND jsonb_typeof(v_one -> 'settings') = 'object' THEN
      v_t_labor_emp := v_t_labor_emp + COALESCE((v_one -> 'settings' ->> 'fixed_payroll_employee')::bigint, 0);
      v_t_sga_fix := v_t_sga_fix
        + COALESCE((v_one -> 'settings' ->> 'rent')::bigint, 0)
        + COALESCE((v_one -> 'settings' ->> 'utilities')::bigint, 0)
        + COALESCE((v_one -> 'settings' ->> 'communication')::bigint, 0)
        + COALESCE((v_one -> 'settings' ->> 'advertising')::bigint, 0)
        + COALESCE((v_one -> 'settings' ->> 'other_sga_fixed')::bigint, 0);
    ELSE
      -- settings が null = この店は staff 視点で固定費非露出。
      v_fixed_any_hidden := true;
    END IF;

    IF (v_one -> 'labor' ->> 'source') = 'unavailable' THEN
      v_labor_any_unavailable := true;
    END IF;
  END LOOP;

  IF NOT v_any_scope THEN
    RETURN jsonb_build_object(
      'year', p_year, 'month', p_month, 'scope_ok', false,
      'stores', '[]'::jsonb
    );
  END IF;

  -- 総合 P&L（設計 §4.4）。
  v_t_gross := v_t_sales - v_t_cogs;
  v_t_op_profit := v_t_gross - (v_t_labor_pt + v_t_labor_emp) - (v_t_sga_var + v_t_sga_fix);

  IF v_t_sales > 0 THEN
    v_op_rate   := round(v_t_op_profit::numeric / v_t_sales, 4);
    v_avg_spend := CASE WHEN v_t_cust > 0
                        THEN round(v_t_sales::numeric / v_t_cust, 1)
                        ELSE NULL END;
  ELSE
    v_op_rate := NULL;
    v_avg_spend := CASE WHEN v_t_cust > 0
                        THEN round(v_t_sales::numeric / v_t_cust, 1)
                        ELSE NULL END;
  END IF;

  RETURN jsonb_build_object(
    'year', p_year, 'month', p_month,
    'scope_ok', true,
    'stores', v_stores,
    'totals', jsonb_build_object(
      'sales_total',           v_t_sales,
      'cogs_variable',         v_t_cogs,
      'gross_profit',          v_t_gross,
      'labor_parttime',        v_t_labor_pt,
      'labor_employee_fixed',  v_t_labor_emp,
      'sga_variable',          v_t_sga_var,
      'sga_fixed',             v_t_sga_fix,
      -- 固定費非露出店が混ざる場合（staff）は過大値を出さず null 秘匿（裁定・案1）。
      'operating_profit',      CASE WHEN v_fixed_any_hidden THEN 'null'::jsonb ELSE to_jsonb(v_t_op_profit) END,
      'operating_profit_rate', CASE WHEN v_fixed_any_hidden THEN 'null'::jsonb ELSE to_jsonb(v_op_rate) END,
      'customers_total',       v_t_cust,
      'avg_spend',             v_avg_spend
    ),
    'labor_source', CASE WHEN v_labor_any_unavailable THEN 'unavailable' ELSE 'loop_c' END
  );
END;
$$;


-- ----------------------------------------------------------------------------
-- 権限テンプレ（MEMORY RLS 4 行・新シグネチャすべて）。
--   REVOKE PUBLIC / REVOKE anon / GRANT authenticated。
--   旧 get_monthly_report_all(int, int) の権限は 076 のものを残置（DROP しない）。
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_daily_report(uuid, date, uuid)          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_daily_report(uuid, date, uuid)          FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_daily_report(uuid, date, uuid)          TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_monthly_report(uuid, int, int, uuid)    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_monthly_report(uuid, int, int, uuid)    FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_monthly_report(uuid, int, int, uuid)    TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_monthly_report_all(int, int, uuid)      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_monthly_report_all(int, int, uuid)      FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_monthly_report_all(int, int, uuid)      TO authenticated;
