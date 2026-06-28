// =============================================================================
// lib/reports/types.ts — 日報・月報の共通型・定数（Loop D/E）
// -----------------------------------------------------------------------------
// 設計書: 2026-06-10-kintai-daily-monthly-reports-loopDE.md §1.8 / §6。
//
// RPC（get_daily_report / get_monthly_report / get_monthly_report_all）が返す
// jsonb 契約に 1:1 対応する TS 型と、フォーム型・共通定数を定義する。
//
//   - 本ファイルは **D-1 単独所有**。E-1 は import のみ（編集しない＝競合ゼロ化、§7/R9）。
//   - supabase-js の rpc<T> は型推論されないため、adapter 側で防御的 normalize した
//     上でこれらの型に確定させる（§6）。
//   - 月報側の null 許容フィールド（staff には null で返る経営数値）は型で明示する
//     （§5.4 fail-safe）。
// =============================================================================

// ---------------------------------------------------------------------------
// 共通定数
// ---------------------------------------------------------------------------

/** 営業日区切り（全7店共通・11時始まり）。日報日付セレクタ既定値に使う（§1.7）。 */
export const STORE_START_HOUR = 11;

/**
 * 金種の額面（大きい順）。cashCount.ts と共有。
 * daily_reports の cash_count_10000..cash_count_1（9列）と 1:1 対応。
 */
export const DENOMINATIONS = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1] as const;

export type Denomination = (typeof DENOMINATIONS)[number];

/**
 * 金種ごとの枚数マップ。キーは額面の文字列（RPC の cash_counts と同形式）。
 * 例: { "10000": 3, "5000": 0, ... "1": 12 }
 */
export type CashCounts = Record<string, number>;

// ===========================================================================
// 日報（get_daily_report）型
// ===========================================================================

/** get_daily_report の square ブロック（Square 売上/客数・読み取り専用）。 */
export interface DailyReportSquare {
  total_amount: number;
  open_total_amount: number;
  cash_amount: number;
  card_amount: number;
  external_amount: number;
  other_amount: number;
  transaction_count: number;
  shisha_count: number;
  new_customer_count: number;
  repeat_customer_count: number;
  regular_customer_count: number;
  staff_customer_count: number;
  customer_total: number;
}

/** get_daily_report の manual ブロック（入力値・既存値の復元元）。 */
export interface DailyReportManual {
  incentive: number;
  expense_drink: number;
  expense_food: number;
  expense_flavor: number;
  expense_supplies: number;
  expense_other: number;
  /** DB GENERATED（送らない）。表示・参照用。 */
  cash_total: number;
  cash_counts: CashCounts;
  pool_amount: number;
  /** 手動上書き値。null=自動（derived.discrepancy_amount を使用）。 */
  discrepancy_amount_manual: number | null;
  note: string | null;
  /** 当該 (store, date) の行が存在するか（未入力/入力済バッジ用）。 */
  report_exists: boolean;
}

/** get_daily_report の labor ブロック（Loop C 未実装時は unavailable）。 */
export interface DailyReportLabor {
  parttime_labor: number;
  source: 'unavailable' | 'aggregated' | string;
}

/** get_daily_report の derived ブロック（RPC 算出の違算）。 */
export interface DailyReportDerived {
  /**
   * 現金合計 − Square 現金（手動上書きがあればその値）。
   * 未入力（金種未入力等で算出不能）は null（0 と区別＝「—」表示）。
   */
  discrepancy_amount: number | null;
}

/** get_daily_report(p_store_id, p_business_date) の戻り型。 */
export interface DailyReport {
  store_id: string;
  store_name: string;
  business_date: string;
  scope_ok: boolean;
  square: DailyReportSquare;
  manual: DailyReportManual;
  labor: DailyReportLabor;
  derived: DailyReportDerived;
}

/**
 * 日報入力フォームの値（DailyReportForm コンポーネントのローカル state）。
 * 数値は全て非負整数（プール金・手動違算のみ符号許容）。
 * cash_total は送らない（GENERATED）ため含めない。
 */
export interface DailyReportForm {
  incentive: number;
  expense_drink: number;
  expense_food: number;
  expense_flavor: number;
  expense_supplies: number;
  expense_other: number;
  /** 金種9の枚数（額面文字列キー）。 */
  cash_counts: CashCounts;
  /** プール金（符号許容）。 */
  pool_amount: number;
  /** 違算手動上書き。null=自動算出を使う。 */
  discrepancy_amount: number | null;
  note: string;
}

// ===========================================================================
// 月報（get_monthly_report / get_monthly_report_all）型
// ※ E-1 が monthlyReportAdapter.ts で import して使う（types.ts は編集しない）。
// ===========================================================================

/** 月報の売上内訳。 */
export interface MonthlySales {
  cash: number;
  card: number;
  external: number;
  other: number;
  total: number;
  total_with_open: number;
}

/** 月報の客数内訳。 */
export interface MonthlyCustomers {
  new: number;
  repeat: number;
  regular: number;
  staff: number;
  total: number;
  /** 客単価。客数0等で算出不能なら null（0 と区別＝「—」表示）。 */
  avg_spend: number | null;
}

/** 月報の変動費内訳。 */
export interface MonthlyExpenses {
  incentive: number;
  drink: number;
  food: number;
  flavor: number;
  supplies: number;
  other: number;
}

/** 月報の手数料内訳。 */
export interface MonthlyFees {
  card: number;
  external: number;
}

/** 月報の労務（Loop C 未実装時は unavailable）。 */
export interface MonthlyLabor {
  parttime: number;
  source: 'unavailable' | 'aggregated' | string;
}

/** 月報の目標・達成率（staff は sales_target=null）。 */
export interface MonthlyTarget {
  /** 売上目標生値。staff は null（経営数値秘匿・§5.4）。 */
  sales_target: number | null;
  /** 達成率。staff も取得可。 */
  achievement_rate: number | null;
}

/**
 * 月次マスタの生値（store_monthly_settings）。staff は settings=null。
 * managerial のみ取得・表示・編集可。
 */
export interface MonthlyStoreSettings {
  fixed_payroll_employee: number;
  rent: number;
  utilities: number;
  communication: number;
  advertising: number;
  other_sga_fixed: number;
  sales_target: number;
}

/** get_monthly_report(p_store_id, p_year, p_month) の戻り型。 */
export interface MonthlyReport {
  store_id: string;
  store_name: string;
  year: number;
  month: number;
  scope_ok: boolean;
  settings_exists: boolean;
  sales: MonthlySales;
  customers: MonthlyCustomers;
  shisha_count: number;
  labor: MonthlyLabor;
  expenses: MonthlyExpenses;
  fees: MonthlyFees;
  cogs_variable: number;
  sga_variable: number;
  consumption_tax: number;
  discrepancy_total: number;
  target: MonthlyTarget;
  /** 暫定利益。staff は null（§5.4）。 */
  provisional_profit: number | null;
  /** 暫定利益率。staff は null（§5.4）。 */
  provisional_profit_rate: number | null;
  /** 月次マスタ生値。staff は null（§5.4）。 */
  settings: MonthlyStoreSettings | null;
}

/** get_monthly_report_all の totals（総合 P&L）。staff は利益額・率 null。 */
export interface MonthlyAllTotals {
  sales_total: number;
  cogs_variable: number;
  gross_profit: number | null;
  labor_parttime: number;
  labor_employee_fixed: number | null;
  sga_variable: number;
  sga_fixed: number | null;
  operating_profit: number | null;
  operating_profit_rate: number | null;
  customers_total: number;
  /** 平均客単価。客数0等で算出不能なら null（0 と区別＝「—」表示）。 */
  avg_spend: number | null;
}

/** get_monthly_report_all(p_year, p_month) の戻り型。 */
export interface MonthlyReportAll {
  year: number;
  month: number;
  scope_ok: boolean;
  /** 権限内店舗の月報サマリ（MonthlyReport と同型）。 */
  stores: MonthlyReport[];
  totals: MonthlyAllTotals;
  labor_source: 'unavailable' | 'aggregated' | string;
}

/**
 * 月次マスタ編集フォーム（store_monthly_settings の入力値）。
 * 全て非負整数。E-1 の useStoreMonthlySettings / E-2 の編集 UI で使う。
 */
export interface StoreMonthlySettingsForm {
  fixed_payroll_employee: number;
  rent: number;
  utilities: number;
  communication: number;
  advertising: number;
  other_sga_fixed: number;
  sales_target: number;
}
