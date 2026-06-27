import { describe, it, expect } from 'vitest';
import { computeDailyTotals } from './dailyTotals';
import type { OpenOrder } from './types';

function makeOpenOrder(total: number): OpenOrder {
  return {
    id: `o-${total}`,
    created_at: null,
    total_money: total,
    customer_name: null,
    line_items: [],
    discounts: [],
  };
}

describe('computeDailyTotals', () => {
  // T1: 通常ケース（決済済み + 複数未決済）
  it('決済済みと複数の未決済を合算する', () => {
    const r = computeDailyTotals(
      { total_amount: 10000, transaction_count: 3 },
      [makeOpenOrder(1500), makeOpenOrder(2500)],
    );
    expect(r.settledTotal).toBe(10000);
    expect(r.settledCount).toBe(3);
    expect(r.openTotal).toBe(4000);
    expect(r.openCount).toBe(2);
    expect(r.grandTotal).toBe(14000);
    expect(r.grandCount).toBe(5);
  });

  // T2: 未決済が空配列
  it('未決済が空のときは決済済みのみが合計になる', () => {
    const r = computeDailyTotals({ total_amount: 8000, transaction_count: 4 }, []);
    expect(r.openTotal).toBe(0);
    expect(r.openCount).toBe(0);
    expect(r.grandTotal).toBe(8000);
    expect(r.grandCount).toBe(4);
  });

  // T3: sales が null → 決済済み 0
  it('sales=null のとき決済済みは 0 に倒れる', () => {
    const r = computeDailyTotals(null, [makeOpenOrder(3000)]);
    expect(r.settledTotal).toBe(0);
    expect(r.settledCount).toBe(0);
    expect(r.openTotal).toBe(3000);
    expect(r.openCount).toBe(1);
    expect(r.grandTotal).toBe(3000);
    expect(r.grandCount).toBe(1);
  });

  // T4: sales が undefined
  it('sales=undefined のとき決済済みは 0 に倒れる', () => {
    const r = computeDailyTotals(undefined, []);
    expect(r.settledTotal).toBe(0);
    expect(r.settledCount).toBe(0);
    expect(r.grandTotal).toBe(0);
    expect(r.grandCount).toBe(0);
  });

  // T5: openOrders が null/undefined → 空扱い
  it('openOrders=null/undefined を空扱いする', () => {
    const a = computeDailyTotals({ total_amount: 500, transaction_count: 1 }, null);
    const b = computeDailyTotals({ total_amount: 500, transaction_count: 1 }, undefined);
    for (const r of [a, b]) {
      expect(r.openTotal).toBe(0);
      expect(r.openCount).toBe(0);
      expect(r.grandTotal).toBe(500);
      expect(r.grandCount).toBe(1);
    }
  });

  // T6: 全空 → ゼロ
  it('全て空のときは全フィールド 0', () => {
    const r = computeDailyTotals(null, null);
    expect(r).toEqual({
      settledTotal: 0,
      settledCount: 0,
      openTotal: 0,
      openCount: 0,
      grandTotal: 0,
      grandCount: 0,
    });
  });

  // T7: sales の NaN/欠落吸収
  it('sales の total_amount/transaction_count が NaN でも 0 に吸収する', () => {
    const r = computeDailyTotals(
      { total_amount: NaN, transaction_count: NaN },
      [makeOpenOrder(1000)],
    );
    expect(r.settledTotal).toBe(0);
    expect(r.settledCount).toBe(0);
    expect(r.grandTotal).toBe(1000);
    expect(r.grandCount).toBe(1);
  });

  // T8: openOrders 内の NaN/Infinity を吸収
  it('未決済の total_money が NaN/Infinity でも 0 に吸収する', () => {
    const r = computeDailyTotals({ total_amount: 0, transaction_count: 0 }, [
      makeOpenOrder(NaN),
      makeOpenOrder(Infinity),
      makeOpenOrder(2000),
    ]);
    // 金額は NaN/Infinity を 0 に吸収し 2000 のみ
    expect(r.openTotal).toBe(2000);
    // 件数は length ベース（金額が異常でも +1）
    expect(r.openCount).toBe(3);
    expect(r.grandTotal).toBe(2000);
    expect(r.grandCount).toBe(3);
  });

  // T9: 金額 0 の OPEN 伝票も件数に数える
  it('金額 0 の未決済伝票も件数に含める', () => {
    const r = computeDailyTotals({ total_amount: 0, transaction_count: 0 }, [
      makeOpenOrder(0),
      makeOpenOrder(0),
    ]);
    expect(r.openTotal).toBe(0);
    expect(r.openCount).toBe(2);
    expect(r.grandCount).toBe(2);
  });

  // T10: grandTotal は常に settledTotal + openTotal（差し引きなし）
  it('grandTotal = settledTotal + openTotal を機械保証する', () => {
    const r = computeDailyTotals({ total_amount: 12345, transaction_count: 7 }, [
      makeOpenOrder(111),
      makeOpenOrder(222),
      makeOpenOrder(333),
    ]);
    expect(r.grandTotal).toBe(r.settledTotal + r.openTotal);
    expect(r.grandTotal).toBe(12345 + 666);
  });

  // T11: grandCount は常に settledCount + openCount（重複排除・差し引きなし＝二重計上ゼロ）
  it('grandCount = settledCount + openCount を機械保証する（ディスジョイント単純和）', () => {
    const r = computeDailyTotals({ total_amount: 0, transaction_count: 9 }, [
      makeOpenOrder(1),
      makeOpenOrder(1),
    ]);
    expect(r.grandCount).toBe(r.settledCount + r.openCount);
    expect(r.grandCount).toBe(11);
  });

  // T12: 単一未決済
  it('未決済が 1 件のケース', () => {
    const r = computeDailyTotals({ total_amount: 4000, transaction_count: 2 }, [
      makeOpenOrder(1000),
    ]);
    expect(r.openTotal).toBe(1000);
    expect(r.openCount).toBe(1);
    expect(r.grandTotal).toBe(5000);
    expect(r.grandCount).toBe(3);
  });

  // T13: 小数金額も保持（丸めない）
  it('小数金額を丸めず保持する', () => {
    const r = computeDailyTotals({ total_amount: 100.5, transaction_count: 1 }, [
      makeOpenOrder(0.25),
    ]);
    expect(r.openTotal).toBe(0.25);
    expect(r.grandTotal).toBeCloseTo(100.75, 10);
  });
});
