// =============================================================================
// monthlyReportAdapter — get_monthly_report(_all) jsonb → 型に正規化する純関数群
// -----------------------------------------------------------------------------
// 設計書 §1.8・§5.4・§5.6・§6（Loop D/E）。
//
//   - public スキーマ RPC `get_monthly_report` / `get_monthly_report_all` の
//     返り jsonb（§1.8）を `MonthlyReport` / `MonthlyReportAll`（types.ts・D-1 所有）
//     に 1:1 正規化する。
//   - 防御的 normalize: RPC が想定キーを欠いても落ちない。全数値は `num()`
//     （Number(x) || 0）、staff に対し null で返る経営数値（settings /
//     target.sales_target / provisional_profit(_rate) / totals.operating_profit
//     (_rate)）は **null を保持**（0 に潰さない＝§5.4 fail-safe ロック表示の判定に使う）。
//   - 型は D-1 が `src/lib/reports/types.ts` に定義。本ファイルは import のみ。
// =============================================================================

import type {
  MonthlyReport,
  MonthlyReportAll,
  MonthlyAllTotals,
  MonthlyStoreSettings,
} from './types';

/** 数値正規化（欠落・非数は 0）。 */
function num(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * null 許容数値の正規化。
 * null / undefined は **null 保持**（staff 秘匿フィールドのロック判定に使うため
 * 0 に潰さない）。それ以外は数値化（非数は null）。
 */
function numOrNull(x: unknown): number | null {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function str(x: unknown, fallback = ''): string {
  return typeof x === 'string' ? x : fallback;
}

function bool(x: unknown): boolean {
  return x === true;
}

/**
 * settings（固定費生値）の正規化。
 * staff には RPC が `settings=null` を返す → null 保持（ロック表示の判定）。
 */
function normalizeSettings(raw: unknown): MonthlyStoreSettings | null {
  if (raw === null || raw === undefined) return null;
  const s = raw as Record<string, unknown>;
  return {
    fixed_payroll_employee: num(s.fixed_payroll_employee),
    rent: num(s.rent),
    utilities: num(s.utilities),
    communication: num(s.communication),
    advertising: num(s.advertising),
    other_sga_fixed: num(s.other_sga_fixed),
    sales_target: num(s.sales_target),
  };
}

/**
 * get_monthly_report jsonb（および get_monthly_report_all の stores[] 要素）を
 * `MonthlyReport` に正規化する。
 */
export function normalizeMonthlyReport(raw: unknown): MonthlyReport {
  const r = (raw ?? {}) as Record<string, unknown>;
  const sales = (r.sales ?? {}) as Record<string, unknown>;
  const customers = (r.customers ?? {}) as Record<string, unknown>;
  const labor = (r.labor ?? {}) as Record<string, unknown>;
  const expenses = (r.expenses ?? {}) as Record<string, unknown>;
  const fees = (r.fees ?? {}) as Record<string, unknown>;
  const target = (r.target ?? {}) as Record<string, unknown>;

  return {
    store_id: str(r.store_id),
    store_name: str(r.store_name),
    year: num(r.year),
    month: num(r.month),
    scope_ok: bool(r.scope_ok),
    settings_exists: bool(r.settings_exists),
    sales: {
      cash: num(sales.cash),
      card: num(sales.card),
      external: num(sales.external),
      other: num(sales.other),
      total: num(sales.total),
      total_with_open: num(sales.total_with_open),
    },
    customers: {
      new: num(customers.new),
      repeat: num(customers.repeat),
      regular: num(customers.regular),
      staff: num(customers.staff),
      total: num(customers.total),
      // 客単価は客数0等で算出不能なら null 保持（0 に潰さず「—」表示・dead branch 解消）。
      avg_spend: numOrNull(customers.avg_spend),
    },
    shisha_count: num(r.shisha_count),
    labor: {
      parttime: num(labor.parttime),
      source: str(labor.source, 'unavailable'),
    },
    expenses: {
      incentive: num(expenses.incentive),
      drink: num(expenses.drink),
      food: num(expenses.food),
      flavor: num(expenses.flavor),
      supplies: num(expenses.supplies),
      other: num(expenses.other),
    },
    fees: {
      card: num(fees.card),
      external: num(fees.external),
    },
    cogs_variable: num(r.cogs_variable),
    sga_variable: num(r.sga_variable),
    consumption_tax: num(r.consumption_tax),
    discrepancy_total: num(r.discrepancy_total),
    target: {
      // 売上目標生値は staff に null（秘匿） → null 保持。
      sales_target: numOrNull(target.sales_target),
      // 達成率は staff も返る。
      achievement_rate: numOrNull(target.achievement_rate),
    },
    // 暫定利益・利益率は staff に null → null 保持（ロック表示）。
    provisional_profit: numOrNull(r.provisional_profit),
    provisional_profit_rate: numOrNull(r.provisional_profit_rate),
    // 固定費生値は staff に null。
    settings: normalizeSettings(r.settings),
  };
}

/**
 * get_monthly_report_all の totals を `MonthlyAllTotals` に正規化する。
 * staff に null で返る経営数値（gross_profit / labor_employee_fixed / sga_fixed /
 * operating_profit / operating_profit_rate）は null 保持（§5.4 ロック表示判定）。
 */
function normalizeTotals(raw: unknown): MonthlyAllTotals {
  const t = (raw ?? {}) as Record<string, unknown>;
  return {
    sales_total: num(t.sales_total),
    cogs_variable: num(t.cogs_variable),
    gross_profit: numOrNull(t.gross_profit),
    labor_parttime: num(t.labor_parttime),
    labor_employee_fixed: numOrNull(t.labor_employee_fixed),
    sga_variable: num(t.sga_variable),
    sga_fixed: numOrNull(t.sga_fixed),
    operating_profit: numOrNull(t.operating_profit),
    operating_profit_rate: numOrNull(t.operating_profit_rate),
    customers_total: num(t.customers_total),
    // 平均客単価は客数0等で算出不能なら null 保持（0 に潰さず「—」表示）。
    avg_spend: numOrNull(t.avg_spend),
  };
}

/**
 * get_monthly_report_all の stores[] 要素を月報サマリ（MonthlyReport と同型）に
 * 正規化する。設計 §1.8: 「get_monthly_report と同型の店舗別サマリ」のため
 * normalizeMonthlyReport を流用する。
 */
function normalizeStoreSummary(raw: unknown): MonthlyReport {
  return normalizeMonthlyReport(raw);
}

/**
 * get_monthly_report_all jsonb を `MonthlyReportAll` に正規化する。
 */
export function normalizeMonthlyReportAll(raw: unknown): MonthlyReportAll {
  const r = (raw ?? {}) as Record<string, unknown>;
  const storesRaw = Array.isArray(r.stores) ? r.stores : [];
  return {
    year: num(r.year),
    month: num(r.month),
    scope_ok: bool(r.scope_ok),
    stores: storesRaw.map(normalizeStoreSummary),
    totals: normalizeTotals(r.totals),
    labor_source: str(r.labor_source, 'unavailable'),
  };
}
