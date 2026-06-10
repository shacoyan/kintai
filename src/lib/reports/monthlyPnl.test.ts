import { describe, it, expect } from 'vitest';
import { computeMonthlyPnl } from './monthlyPnl';
import type { MonthlyReport, MonthlyStoreSettings } from './types';

// =============================================================================
// monthlyPnl.test — 営業利益計算純関数のユニットテスト
//   - managerial（settings/provisional_profit あり）で営業利益を検算
//   - 総合タブ get_monthly_report_all.operating_profit（076 L658-659）の
//     per-store 分解と恒等であることを 1 ケースで明示
//   - staff（settings=null / provisional_profit=null）で全て null（fail-safe）
//   - sales.total===0 のとき率 null
//   - 赤字（営業利益 < 0）で負値を返す（null 化しない）
// =============================================================================

const settings: MonthlyStoreSettings = {
  fixed_payroll_employee: 300000,
  rent: 200000,
  utilities: 50000,
  communication: 10000,
  advertising: 30000,
  other_sga_fixed: 10000,
  sales_target: 2000000,
};

/** テスト用 MonthlyReport を最小構成で生成する。 */
function makeReport(overrides: Partial<MonthlyReport> = {}): MonthlyReport {
  return {
    store_id: 's1',
    store_name: 'テスト店',
    year: 2026,
    month: 6,
    scope_ok: true,
    settings_exists: true,
    sales: {
      cash: 0,
      card: 0,
      external: 0,
      other: 0,
      total: 2000000,
      total_with_open: 2000000,
    },
    customers: { new: 0, repeat: 0, regular: 0, staff: 0, total: 0, avg_spend: 0 },
    shisha_count: 0,
    labor: { parttime: 0, source: 'aggregated' },
    expenses: {
      incentive: 0,
      drink: 0,
      food: 0,
      flavor: 0,
      supplies: 0,
      other: 0,
    },
    fees: { card: 0, external: 0 },
    cogs_variable: 0,
    sga_variable: 0,
    consumption_tax: 0,
    discrepancy_total: 0,
    target: { sales_target: 2000000, achievement_rate: 100 },
    provisional_profit: 800000,
    provisional_profit_rate: 0.4,
    settings,
    ...overrides,
  };
}

describe('computeMonthlyPnl', () => {
  it('managerial: 固定費計と営業利益を正しく算出する', () => {
    const r = makeReport();
    const pnl = computeMonthlyPnl(r);

    // fixedSga = 200000 + 50000 + 10000 + 30000 + 10000 = 300000
    expect(pnl.fixedSgaTotal).toBe(300000);
    // fixedTotal = 300000(employee) + 300000(sga) = 600000
    expect(pnl.fixedTotal).toBe(600000);
    // operatingProfit = 800000 - 300000 - 300000 = 200000
    expect(pnl.operatingProfit).toBe(200000);
    // rate = 200000 / 2000000 * 100 = 10 (0..100)
    expect(pnl.operatingProfitRate).toBe(10);
  });

  it('総合タブ operating_profit（076 L658-659）の per-store 分解と恒等', () => {
    // 総合: op = gross - (labor_pt+labor_emp) - (sga_var+sga_fix)
    //   = (sales - cogs) - labor_pt - labor_emp - sga_var - sga_fix
    // per-store: provisional = sales - cogs - labor_pt - sga_var
    //   op = provisional - labor_emp - sga_fix  ← computeMonthlyPnl の式
    const sales = 2000000;
    const cogs = 400000;
    const labor_pt = 250000;
    const sga_var = 150000;
    const labor_emp = settings.fixed_payroll_employee; // 300000
    const sga_fix =
      settings.rent +
      settings.utilities +
      settings.communication +
      settings.advertising +
      settings.other_sga_fixed; // 300000

    const provisional = sales - cogs - labor_pt - sga_var; // 1,200,000
    const expectedOp = sales - cogs - labor_pt - labor_emp - sga_var - sga_fix; // 600,000

    const r = makeReport({
      sales: { cash: 0, card: 0, external: 0, other: 0, total: sales, total_with_open: sales },
      provisional_profit: provisional,
    });
    const pnl = computeMonthlyPnl(r);

    expect(pnl.operatingProfit).toBe(expectedOp);
    expect(pnl.operatingProfit).toBe(600000);
  });

  it('staff: settings=null / provisional_profit=null で全て null（fail-safe）', () => {
    const r = makeReport({ settings: null, provisional_profit: null, provisional_profit_rate: null });
    const pnl = computeMonthlyPnl(r);

    expect(pnl.fixedSgaTotal).toBeNull();
    expect(pnl.fixedTotal).toBeNull();
    expect(pnl.operatingProfit).toBeNull();
    expect(pnl.operatingProfitRate).toBeNull();
  });

  it('provisional_profit のみ null（settings あり）でも営業利益・率は null、固定費は算出', () => {
    const r = makeReport({ provisional_profit: null });
    const pnl = computeMonthlyPnl(r);

    expect(pnl.fixedSgaTotal).toBe(300000);
    expect(pnl.fixedTotal).toBe(600000);
    expect(pnl.operatingProfit).toBeNull();
    expect(pnl.operatingProfitRate).toBeNull();
  });

  it('sales.total===0 のとき営業利益率は null（ゼロ除算回避）', () => {
    const r = makeReport({
      sales: { cash: 0, card: 0, external: 0, other: 0, total: 0, total_with_open: 0 },
      provisional_profit: -600000,
    });
    const pnl = computeMonthlyPnl(r);

    expect(pnl.operatingProfitRate).toBeNull();
    // 営業利益自体は算出される
    expect(pnl.operatingProfit).toBe(-1200000); // -600000 - 300000 - 300000
  });

  it('赤字（営業利益 < 0）で負値を返す（null 化しない）', () => {
    const r = makeReport({ provisional_profit: 100000 });
    const pnl = computeMonthlyPnl(r);

    // 100000 - 300000 - 300000 = -500000
    expect(pnl.operatingProfit).toBe(-500000);
    expect(pnl.operatingProfitRate).toBe(-25); // -500000 / 2000000 * 100
  });
});
