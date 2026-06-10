import type { MonthlyReport } from './types';

// =============================================================================
// monthlyPnl — 店舗別月報 P&L の固定費・営業利益計算（純関数）
// -----------------------------------------------------------------------------
//   - MonthlyStoreReport の表示用に、暫定利益（固定費前）から固定費を控除した
//     「営業利益（固定費後）」とその率を算出する。
//   - すべて純関数。総合タブ get_monthly_report_all.operating_profit
//     （migration 076 L658-659: gross - (labor_pt+labor_emp) - (sga_var+sga_fix)）
//     の per-store 分解と恒等であることを monthlyPnl.test.ts で保証する。
//       provisional_profit = sales.total - cogs_variable - labor - sga_variable
//       operatingProfit    = provisional_profit - fixed_payroll_employee - fixedSga
//                          = sales - cogs - labor - sga_var - labor_emp - sga_fix
//       ＝ 総合 op_profit の per-store 分解と一致。
//   - **fail-safe（§5.4）**: settings / provisional_profit のいずれかが null
//     （= staff など非 managerial）なら戻り値も null を伝播する。NaN や 0 を
//     返さない（LockedValue が「—」表示する前提）。
//   - **単位（率）**: 営業利益率は `operatingProfit / sales.total * 100` で
//     0..100 のパーセント値として返す（monthlyDisplay の formatRate は 0..100
//     を想定）。なお RPC の provisional_profit_rate / operating_profit_rate は
//     round(.../sales, 4) ＝ 0..1 の小数で返るため、フロントで表示する際は
//     ×100 する必要がある（MonthlyStoreReport 側で対応）。本関数は最初から
//     0..100 で算出するため二重変換は不要。
// =============================================================================

/** P&L 計算結果。元値が null（staff）なら各値 null を伝播する。 */
export interface MonthlyPnl {
  /** 店舗固定販管費計 = rent + utilities + communication + advertising + other_sga_fixed。 */
  fixedSgaTotal: number | null;
  /** 固定費計 = fixed_payroll_employee + fixedSgaTotal。 */
  fixedTotal: number | null;
  /** 営業利益（固定費後） = provisional_profit − fixed_payroll_employee − fixedSgaTotal。負値（赤字）もそのまま返す。 */
  operatingProfit: number | null;
  /** 営業利益率（%・0..100）。sales.total<=0 または operatingProfit null なら null。 */
  operatingProfitRate: number | null;
}

/**
 * 店舗別月報の固定費・営業利益を算出する純関数。
 *
 * @param data MonthlyReport（settings と provisional_profit / sales を参照）
 * @returns MonthlyPnl（fail-safe で null 伝播）
 */
export function computeMonthlyPnl(data: MonthlyReport): MonthlyPnl {
  const settings = data.settings;

  // settings が null（staff）→ 固定費系は全て null。
  if (!settings) {
    return {
      fixedSgaTotal: null,
      fixedTotal: null,
      operatingProfit: null,
      operatingProfitRate: null,
    };
  }

  const fixedSgaTotal =
    settings.rent +
    settings.utilities +
    settings.communication +
    settings.advertising +
    settings.other_sga_fixed;

  const fixedTotal = settings.fixed_payroll_employee + fixedSgaTotal;

  // provisional_profit が null（staff）→ 営業利益系は null。
  const operatingProfit =
    data.provisional_profit == null
      ? null
      : data.provisional_profit - settings.fixed_payroll_employee - fixedSgaTotal;

  const salesTotal = data.sales.total;
  const operatingProfitRate =
    operatingProfit != null && salesTotal > 0
      ? (operatingProfit / salesTotal) * 100
      : null;

  return {
    fixedSgaTotal,
    fixedTotal,
    operatingProfit,
    operatingProfitRate,
  };
}
