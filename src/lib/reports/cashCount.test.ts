import { describe, it, expect } from 'vitest';
import { cashTotal, emptyCashCounts, normalizeCashCounts } from './cashCount';
import { DENOMINATIONS } from './types';
import {
  adaptDailyReport,
  manualToForm,
  formToDailyReportRow,
  cashCountsToColumns,
} from './dailyReportAdapter';

describe('cashTotal', () => {
  it('金種×額面の合計を返す', () => {
    // 1万×3 + 5千×0 + 千×2 + 500×1 + 100×4 + 50×0 + 10×0 + 5×0 + 1×12
    const counts = {
      '10000': 3,
      '5000': 0,
      '1000': 2,
      '500': 1,
      '100': 4,
      '50': 0,
      '10': 0,
      '5': 0,
      '1': 12,
    };
    expect(cashTotal(counts)).toBe(30000 + 2000 + 500 + 400 + 12);
  });

  it('空オブジェクトは 0', () => {
    expect(cashTotal({})).toBe(0);
  });

  it('null / undefined は 0', () => {
    expect(cashTotal(null)).toBe(0);
    expect(cashTotal(undefined)).toBe(0);
  });

  it('欠落キーは 0 枚扱い', () => {
    expect(cashTotal({ '10000': 1 })).toBe(10000);
  });

  it('負数・小数・非数は 0 枚に倒す', () => {
    expect(cashTotal({ '10000': -5, '1000': 2.9, '100': NaN as unknown as number })).toBe(
      2000
    );
  });

  it('DENOMINATIONS に無いキーは無視する', () => {
    expect(cashTotal({ '99999': 100, '1000': 1 })).toBe(1000);
  });

  it('大金額でも overflow せず安全整数範囲に収まる', () => {
    // 1万円 × 100万枚 = 100億（< 2^53）
    const total = cashTotal({ '10000': 1_000_000 });
    expect(total).toBe(10_000_000_000);
    expect(Number.isSafeInteger(total)).toBe(true);
  });
});

describe('emptyCashCounts / normalizeCashCounts', () => {
  it('全額面キーを 0 で埋める', () => {
    const empty = emptyCashCounts();
    expect(Object.keys(empty).length).toBe(DENOMINATIONS.length);
    expect(cashTotal(empty)).toBe(0);
  });

  it('欠落キー補完・不正値を 0 化する', () => {
    const norm = normalizeCashCounts({ '10000': 2, '1000': -3, '500': 'x' });
    expect(norm['10000']).toBe(2);
    expect(norm['1000']).toBe(0);
    expect(norm['500']).toBe(0);
    expect(norm['1']).toBe(0); // 欠落キー補完
  });
});

describe('adaptDailyReport (null normalize)', () => {
  it('欠落キーは既定値で補完し落ちない', () => {
    const r = adaptDailyReport({});
    expect(r.scope_ok).toBe(false);
    expect(r.square.total_amount).toBe(0);
    expect(r.manual.report_exists).toBe(false);
    expect(r.manual.discrepancy_amount_manual).toBeNull();
    expect(r.manual.note).toBeNull();
    expect(r.labor.source).toBe('unavailable');
  });

  it('discrepancy_amount_manual の null を保持し、非 null は整数化する', () => {
    expect(adaptDailyReport({ manual: { discrepancy_amount_manual: null } }).manual
      .discrepancy_amount_manual).toBeNull();
    expect(adaptDailyReport({ manual: { discrepancy_amount_manual: 150.7 } }).manual
      .discrepancy_amount_manual).toBe(150);
  });

  it('square / manual の数値を Number(x)||0 で正規化する', () => {
    const r = adaptDailyReport({
      square: { total_amount: '5000', cash_amount: 'bad' },
      manual: { incentive: 1000, cash_counts: { '1000': 3 } },
    });
    expect(r.square.total_amount).toBe(5000);
    expect(r.square.cash_amount).toBe(0);
    expect(r.manual.incentive).toBe(1000);
    expect(r.manual.cash_counts['1000']).toBe(3);
  });
});

describe('manualToForm', () => {
  it('manual から自動違算(null)を保持してフォーム初期値を作る', () => {
    const r = adaptDailyReport({
      manual: { note: 'メモ', discrepancy_amount_manual: null, pool_amount: -500 },
    });
    const f = manualToForm(r);
    expect(f.note).toBe('メモ');
    expect(f.discrepancy_amount).toBeNull();
    expect(f.pool_amount).toBe(-500);
  });

  it('手動違算が非 null なら復元する', () => {
    const r = adaptDailyReport({ manual: { discrepancy_amount_manual: 300 } });
    expect(manualToForm(r).discrepancy_amount).toBe(300);
  });
});

describe('formToDailyReportRow / cashCountsToColumns', () => {
  it('cash_count_<denom> 9列に展開し cash_total は含めない', () => {
    const cols = cashCountsToColumns({ '10000': 2, '1000': 5 });
    expect(cols['cash_count_10000']).toBe(2);
    expect(cols['cash_count_1000']).toBe(5);
    expect(cols['cash_count_5000']).toBe(0);
    expect(Object.keys(cols).length).toBe(DENOMINATIONS.length);
    expect('cash_total' in cols).toBe(false);
  });

  it('行マップに cash_total を含めず、自動違算は null を保持する', () => {
    const row = formToDailyReportRow({
      incentive: 1000,
      expense_drink: 0,
      expense_food: 0,
      expense_flavor: 0,
      expense_supplies: 0,
      expense_other: 0,
      cash_counts: { '10000': 1 },
      pool_amount: 200,
      discrepancy_amount: null,
      note: '',
    });
    expect('cash_total' in row).toBe(false);
    expect('shisha_count' in row).toBe(false); // shisha_count は daily_reports へ書かない（Square 自動集計へ移行）
    expect(row['cash_count_10000']).toBe(1);
    expect(row['discrepancy_amount']).toBeNull();
    expect(row['note']).toBeNull(); // 空文字は null
    expect(row['pool_amount']).toBe(200);
  });

  it('手動違算は整数で送る', () => {
    const row = formToDailyReportRow({
      incentive: 0,
      expense_drink: 0,
      expense_food: 0,
      expense_flavor: 0,
      expense_supplies: 0,
      expense_other: 0,
      cash_counts: {},
      pool_amount: 0,
      discrepancy_amount: -1200,
      note: 'x',
    });
    expect(row['discrepancy_amount']).toBe(-1200);
    expect(row['note']).toBe('x');
  });
});
