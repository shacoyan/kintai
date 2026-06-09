import { describe, it, expect } from 'vitest';
import {
  calculateYoY,
  formatYoY,
  shiftDateOneYearBack,
  shiftDateOneYearForward,
  shiftRangeOneYearBack,
  aggregateSalesRangeTotals,
  yoyClassToColorClass,
  buildYoYResultFromResponses,
  type SalesRangeLike,
} from './yoy';

describe('calculateYoY', () => {
  it('up (current=110, lastYear=100)', () => {
    const res = calculateYoY(110, 100);
    expect(res.deltaPercent).toBeCloseTo(10);
    expect(res.classification).toBe('up');
  });

  it('down (current=80, lastYear=100)', () => {
    const res = calculateYoY(80, 100);
    expect(res.deltaPercent).toBeCloseTo(-20);
    expect(res.classification).toBe('down');
  });

  it('flat 境界 (current=102, lastYear=100 → 2%)', () => {
    const res = calculateYoY(102, 100);
    expect(res.deltaPercent).toBeCloseTo(2);
    expect(res.classification).toBe('flat');
  });

  it('flat わずか超え (current=103, lastYear=100 → 3% で up)', () => {
    const res = calculateYoY(103, 100);
    expect(res.deltaPercent).toBeCloseTo(3);
    expect(res.classification).toBe('up');
  });

  it('0 vs N (current=0, lastYear=100 → -100% down)', () => {
    const res = calculateYoY(0, 100);
    expect(res.deltaPercent).toBeCloseTo(-100);
    expect(res.classification).toBe('down');
  });

  it('N vs 0 (current=100, lastYear=0 → no_data)', () => {
    const res = calculateYoY(100, 0);
    expect(res.deltaPercent).toBeNull();
    expect(res.classification).toBe('no_data');
  });

  it('N vs null (current=100, lastYear=null → no_data)', () => {
    const res = calculateYoY(100, null);
    expect(res.deltaPercent).toBeNull();
    expect(res.classification).toBe('no_data');
  });

  it('current 非有限 (NaN) は 0 として扱う（toFiniteNumber ガード）', () => {
    const res = calculateYoY(NaN, 100);
    expect(res.current).toBe(0);
    expect(res.deltaPercent).toBeCloseTo(-100);
    expect(res.classification).toBe('down');
  });

  it('lastYear 非有限 (NaN) は no_data に倒れる（lastYear=NaN→0→no_data）', () => {
    const res = calculateYoY(100, NaN);
    expect(res.deltaPercent).toBeNull();
    expect(res.classification).toBe('no_data');
  });

  it('数値文字列を number 化して計算する（toFiniteNumber）', () => {
    const res = calculateYoY('110' as unknown as number, '100' as unknown as number);
    expect(res.current).toBe(110);
    expect(res.lastYear).toBe(100);
    expect(res.deltaPercent).toBeCloseTo(10);
    expect(res.classification).toBe('up');
  });
});

describe('shiftDateOneYearBack', () => {
  it('うるう年 2024-02-29 → 2023-02-28', () => {
    expect(shiftDateOneYearBack('2024-02-29')).toBe('2023-02-28');
  });

  it('通常 2024-01-01 → 2023-01-01', () => {
    expect(shiftDateOneYearBack('2024-01-01')).toBe('2023-01-01');
  });

  it('通常 2024-12-31 → 2023-12-31', () => {
    expect(shiftDateOneYearBack('2024-12-31')).toBe('2023-12-31');
  });

  it('平年→うるう年でも 2025-02-28 → 2024-02-28 (2/29 にしない)', () => {
    expect(shiftDateOneYearBack('2025-02-28')).toBe('2024-02-28');
  });

  it('月末 2024-05-31 → 2023-05-31', () => {
    expect(shiftDateOneYearBack('2024-05-31')).toBe('2023-05-31');
  });
});

describe('shiftDateOneYearForward', () => {
  it('うるう年 2024-02-29 → 2025-02-28', () => {
    expect(shiftDateOneYearForward('2024-02-29')).toBe('2025-02-28');
  });

  it('通常 2023-02-28 → 2024-02-28', () => {
    expect(shiftDateOneYearForward('2023-02-28')).toBe('2024-02-28');
  });

  it('通常 2023-01-01 → 2024-01-01', () => {
    expect(shiftDateOneYearForward('2023-01-01')).toBe('2024-01-01');
  });
});

describe('shiftRangeOneYearBack', () => {
  it('start+end 両方シフトされる (うるう年含む)', () => {
    const res = shiftRangeOneYearBack({
      start_date: '2024-02-29',
      end_date: '2024-03-15',
    });
    expect(res.start_date).toBe('2023-02-28');
    expect(res.end_date).toBe('2023-03-15');
  });

  it('年またぎ範囲', () => {
    const res = shiftRangeOneYearBack({
      start_date: '2024-12-15',
      end_date: '2025-01-15',
    });
    expect(res.start_date).toBe('2023-12-15');
    expect(res.end_date).toBe('2024-01-15');
  });
});

describe('aggregateSalesRangeTotals', () => {
  it('空 dict → 全 0', () => {
    const res = aggregateSalesRangeTotals({});
    expect(res).toEqual({
      total_amount: 0,
      open_total_amount: 0,
      transaction_count: 0,
      customer_count: 0,
      new_customer_count: 0,
      repeat_customer_count: 0,
      regular_customer_count: 0,
      staff_customer_count: 0,
      unlisted_customer_count: 0,
    });
  });

  it('1 日のみ → そのままの値 (セグメント未指定は 0)', () => {
    const res = aggregateSalesRangeTotals({
      '2024-01-01': { total_amount: 100, transaction_count: 10, customer_count: 5 },
    });
    expect(res).toEqual({
      total_amount: 100,
      open_total_amount: 0,
      transaction_count: 10,
      customer_count: 5,
      new_customer_count: 0,
      repeat_customer_count: 0,
      regular_customer_count: 0,
      staff_customer_count: 0,
      unlisted_customer_count: 0,
    });
  });

  it('複数日 → 正しく SUM される (セグメント未指定は 0)', () => {
    const res = aggregateSalesRangeTotals({
      '2024-01-01': { total_amount: 100, transaction_count: 10, customer_count: 5 },
      '2024-01-02': { total_amount: 200, transaction_count: 20, customer_count: 10 },
      '2024-01-03': { total_amount: 300, transaction_count: 30, customer_count: 15 },
    });
    expect(res).toEqual({
      total_amount: 600,
      open_total_amount: 0,
      transaction_count: 60,
      customer_count: 30,
      new_customer_count: 0,
      repeat_customer_count: 0,
      regular_customer_count: 0,
      staff_customer_count: 0,
      unlisted_customer_count: 0,
    });
  });

  it('セグメント別フィールド付き → 全フィールドが SUM される', () => {
    const res = aggregateSalesRangeTotals({
      '2024-01-01': {
        total_amount: 100, transaction_count: 10, customer_count: 5,
        new_customer_count: 2, repeat_customer_count: 1, regular_customer_count: 1, staff_customer_count: 1, unlisted_customer_count: 0,
      },
      '2024-01-02': {
        total_amount: 200, transaction_count: 20, customer_count: 10,
        new_customer_count: 3, repeat_customer_count: 4, regular_customer_count: 2, staff_customer_count: 1, unlisted_customer_count: 0,
      },
    });
    expect(res).toEqual({
      total_amount: 300,
      open_total_amount: 0,
      transaction_count: 30,
      customer_count: 15,
      new_customer_count: 5,
      repeat_customer_count: 5,
      regular_customer_count: 3,
      staff_customer_count: 2,
      unlisted_customer_count: 0,
    });
  });

  it('open_total_amount 付き → 未決済も正しく SUM される', () => {
    const res = aggregateSalesRangeTotals({
      '2024-01-01': {
        total_amount: 100, open_total_amount: 50, transaction_count: 10, customer_count: 5,
      },
      '2024-01-02': {
        total_amount: 200, open_total_amount: 30, transaction_count: 20, customer_count: 10,
      },
      '2024-01-03': {
        total_amount: 300, transaction_count: 30, customer_count: 15, // open_total_amount 省略 → 0 扱い
      },
    });
    expect(res).toEqual({
      total_amount: 600,
      open_total_amount: 80,
      transaction_count: 60,
      customer_count: 30,
      new_customer_count: 0,
      repeat_customer_count: 0,
      regular_customer_count: 0,
      staff_customer_count: 0,
      unlisted_customer_count: 0,
    });
  });
});

describe('formatYoY', () => {
  const baseUp = calculateYoY(110, 100);
  const baseDown = calculateYoY(80, 100);
  const baseFlat = calculateYoY(102, 100);
  const baseNoData = calculateYoY(100, null);

  it('up のフルテキスト', () => {
    expect(formatYoY(baseUp)).toBe('↑ +10.0% vs 前年');
  });

  it('down のフルテキスト', () => {
    expect(formatYoY(baseDown)).toBe('↓ -20.0% vs 前年');
  });

  it('flat のフルテキスト', () => {
    expect(formatYoY(baseFlat)).toBe('±0.0% 変化なし');
  });

  it('no_data のフルテキスト', () => {
    expect(formatYoY(baseNoData)).toBe('前年データなし');
  });

  it('compact=true で up が省略', () => {
    expect(formatYoY(baseUp, { compact: true })).toBe('↑ +10.0%');
  });

  it('compact=true で down が省略', () => {
    expect(formatYoY(baseDown, { compact: true })).toBe('↓ -20.0%');
  });

  it('compact=true で flat が省略', () => {
    expect(formatYoY(baseFlat, { compact: true })).toBe('±0.0%');
  });

  it('compact=true でも no_data は「前年データなし」で統一', () => {
    expect(formatYoY(baseNoData, { compact: true })).toBe('前年データなし');
  });

  it('formatLastYear 付き up (フル)', () => {
    const delta = calculateYoY(5000000, 4000000);
    const opts = { formatLastYear: (v: number) => `¥${v.toLocaleString()}` };
    expect(formatYoY(delta, opts)).toBe('↑ +25.0% vs 前年 (前年: ¥4,000,000)');
  });

  it('formatLastYear 付き up (compact)', () => {
    const delta = calculateYoY(5000000, 4000000);
    const opts = { compact: true, formatLastYear: (v: number) => `¥${v.toLocaleString()}` };
    expect(formatYoY(delta, opts)).toBe('↑ +25.0% (前年: ¥4,000,000)');
  });

  it('formatLastYear 付き down (フル)', () => {
    const delta = calculateYoY(80, 100);
    const opts = { formatLastYear: (v: number) => `${v}人` };
    expect(formatYoY(delta, opts)).toBe('↓ -20.0% vs 前年 (前年: 100人)');
  });

  it('formatLastYear 付き flat (フル)', () => {
    const delta = calculateYoY(102, 100);
    const opts = { formatLastYear: (v: number) => `¥${v.toLocaleString()}` };
    expect(formatYoY(delta, opts)).toBe('±0.0% 変化なし (前年: ¥100)');
  });

  it('formatLastYear 付き flat (compact)', () => {
    const delta = calculateYoY(102, 100);
    const opts = { compact: true, formatLastYear: (v: number) => `¥${v.toLocaleString()}` };
    expect(formatYoY(delta, opts)).toBe('±0.0% (前年: ¥100)');
  });

  it('formatLastYear 付き no_data は併記なし', () => {
    const delta = calculateYoY(100, null);
    const opts = { formatLastYear: (v: number) => `¥${v}` };
    expect(formatYoY(delta, opts)).toBe('前年データなし');
  });
});

describe('yoyClassToColorClass', () => {
  it('up → text-success', () => {
    expect(yoyClassToColorClass('up')).toBe('text-success');
  });
  it('down → text-danger', () => {
    expect(yoyClassToColorClass('down')).toBe('text-danger');
  });
  it('flat → text-text-muted', () => {
    expect(yoyClassToColorClass('flat')).toBe('text-text-muted');
  });
  it('no_data → text-text-muted', () => {
    expect(yoyClassToColorClass('no_data')).toBe('text-text-muted');
  });
});

// =============================================================================
// buildYoYResultFromResponses（追補D / Engineer C）
// =============================================================================

/** テスト用 SalesRangeLike 1 日分を組む簡易ヘルパ。 */
function day(over: Partial<SalesRangeLike['byDate'][string]> = {}): SalesRangeLike['byDate'][string] {
  return {
    total_amount: 0,
    transaction_count: 0,
    customer_count: 0,
    new_customer_count: 0,
    repeat_customer_count: 0,
    regular_customer_count: 0,
    staff_customer_count: 0,
    unlisted_customer_count: 0,
    open_total_amount: 0,
    ...over,
  };
}

describe('buildYoYResultFromResponses', () => {
  it('客数 YoY 母数は 4 セグ合計（new+repeat+regular+staff）で計算し customer_count は使わない', () => {
    // current: 4 セグ合計 = 10+5+3+2 = 20。customer_count(ユニークID系) はわざと 999 にして
    // 母数に混入しないことを確認する。
    const current: SalesRangeLike = {
      byDate: {
        '2026-05-01': day({
          total_amount: 200,
          new_customer_count: 10,
          repeat_customer_count: 5,
          regular_customer_count: 3,
          staff_customer_count: 2,
          customer_count: 999,
        }),
      },
    };
    // lastYear (2025-05-01): 4 セグ合計 = 5+3+1+1 = 10（>= MIN_LASTYEAR_CUSTOMERS=10 で有効）。
    const lastYear: SalesRangeLike = {
      byDate: {
        '2025-05-01': day({
          total_amount: 100,
          new_customer_count: 5,
          repeat_customer_count: 3,
          regular_customer_count: 1,
          staff_customer_count: 1,
          customer_count: 888,
        }),
      },
    };

    const res = buildYoYResultFromResponses({
      start_date: '2026-05-01',
      end_date: '2026-05-01',
      currentRes: current,
      lastYearRes: lastYear,
    });

    // 客数 YoY: current 20 vs lastYear 10 = +100%（customer_count 999/888 ではない）。
    expect(res.yoy.customer_count.current).toBe(20);
    expect(res.yoy.customer_count.lastYear).toBe(10);
    expect(res.yoy.customer_count.deltaPercent).toBeCloseTo(100);
    expect(res.yoy.customer_count.classification).toBe('up');
    // 売上 YoY: 200 vs 100 = +100%。
    expect(res.yoy.total_amount.deltaPercent).toBeCloseTo(100);
  });

  it('前年 4 セグ合計が MIN_LASTYEAR_CUSTOMERS 未満なら lastYear を null 化し yoy.* を no_data（部分成功）', () => {
    const current: SalesRangeLike = {
      byDate: {
        '2026-05-01': day({
          total_amount: 200,
          new_customer_count: 10,
          repeat_customer_count: 5,
          regular_customer_count: 3,
          staff_customer_count: 2,
        }),
      },
    };
    // 前年は 4 セグ合計 = 1+0+0+0 = 1 < 10 → 希薄。
    const lastYear: SalesRangeLike = {
      byDate: {
        '2025-05-01': day({ total_amount: 50, new_customer_count: 1 }),
      },
    };

    const res = buildYoYResultFromResponses({
      start_date: '2026-05-01',
      end_date: '2026-05-01',
      currentRes: current,
      lastYearRes: lastYear,
    });

    // 前年希薄 → lastYear 全体 null（部分成功: current は維持）。
    expect(res.lastYear).toBeNull();
    expect(res.current.total_amount).toBe(200);
    expect(res.yoy.customer_count.classification).toBe('no_data');
    expect(res.yoy.total_amount.classification).toBe('no_data');
    expect(res.yoy.customer_count.lastYear).toBeNull();
  });

  it('前年 res が null（前年取得失敗/空）でも current は維持し yoy.* は no_data', () => {
    const current: SalesRangeLike = {
      byDate: {
        '2026-05-01': day({ total_amount: 300, new_customer_count: 20 }),
      },
    };

    const res = buildYoYResultFromResponses({
      start_date: '2026-05-01',
      end_date: '2026-05-01',
      currentRes: current,
      lastYearRes: null,
    });

    expect(res.lastYear).toBeNull();
    expect(res.current.total_amount).toBe(300);
    expect(res.yoy.total_amount.classification).toBe('no_data');
    expect(res.dataCoverage).toBe(0);
  });

  it('dataCoverage は前年同日にデータがある日数 / current 日数', () => {
    const current: SalesRangeLike = {
      byDate: {
        '2026-05-01': day({ new_customer_count: 10 }),
        '2026-05-02': day({ new_customer_count: 10 }),
      },
    };
    // 前年は 2025-05-01 のみ存在（2025-05-02 は欠損）。4 セグ合計 12 >= 10 で有効。
    const lastYear: SalesRangeLike = {
      byDate: {
        '2025-05-01': day({ new_customer_count: 12 }),
      },
    };

    const res = buildYoYResultFromResponses({
      start_date: '2026-05-01',
      end_date: '2026-05-02',
      currentRes: current,
      lastYearRes: lastYear,
    });

    // 2 日中 1 日のみ前年同日マッチ → 0.5。
    expect(res.dataCoverage).toBeCloseTo(0.5);
    expect(res.byDate).toHaveLength(2);
    expect(res.byDate[0].lastYear).not.toBeNull();
    expect(res.byDate[1].lastYear).toBeNull();
  });

  it('売上 YoY 母数は未決済 (open) 込み（total_amount + open_total_amount）で当年・前年とも計算する', () => {
    // current: 決済済 200 + open 50 = 250。4 セグ合計 = 10+5+3+2 = 20。
    const current: SalesRangeLike = {
      byDate: {
        '2026-05-01': day({
          total_amount: 200,
          open_total_amount: 50,
          new_customer_count: 10,
          repeat_customer_count: 5,
          regular_customer_count: 3,
          staff_customer_count: 2,
        }),
      },
    };
    // lastYear: 決済済 100 + open 20 = 120。4 セグ合計 = 5+3+1+1 = 10（有効データ扱い）。
    const lastYear: SalesRangeLike = {
      byDate: {
        '2025-05-01': day({
          total_amount: 100,
          open_total_amount: 20,
          new_customer_count: 5,
          repeat_customer_count: 3,
          regular_customer_count: 1,
          staff_customer_count: 1,
        }),
      },
    };

    const res = buildYoYResultFromResponses({
      start_date: '2026-05-01',
      end_date: '2026-05-01',
      currentRes: current,
      lastYearRes: lastYear,
    });

    // 売上 YoY 母数は open 込み: current 250 vs lastYear 120 = +108.33%。
    expect(res.yoy.total_amount.current).toBe(250);
    expect(res.yoy.total_amount.lastYear).toBe(120);
    expect(res.yoy.total_amount.deltaPercent).toBeCloseTo(108.33, 2);
    expect(res.yoy.total_amount.classification).toBe('up');
    // 決済済フィールド total_amount は open 込みに変えない（不変）。
    expect(res.current.total_amount).toBe(200);
  });

  it('byDate payload の数値フィールドを toFiniteNumber で正規化する（null/NaN→0、B18 同根）', () => {
    const current: SalesRangeLike = {
      byDate: {
        '2026-05-01': day({
          total_amount: 200,
          open_total_amount: null as unknown as number,
          transaction_count: null as unknown as number,
          customer_count: null as unknown as number,
          new_customer_count: 10,
          repeat_customer_count: null as unknown as number,
          regular_customer_count: 3,
          staff_customer_count: 2,
        }),
      },
    };
    const lastYear: SalesRangeLike = {
      byDate: {
        '2025-05-01': day({
          total_amount: 100,
          transaction_count: null as unknown as number,
          new_customer_count: 5,
          repeat_customer_count: 3,
          regular_customer_count: 1,
          staff_customer_count: 1,
        }),
      },
    };

    const res = buildYoYResultFromResponses({
      start_date: '2026-05-01',
      end_date: '2026-05-01',
      currentRes: current,
      lastYearRes: lastYear,
    });

    const d = res.byDate[0];
    // null/NaN は 0 に正規化され NaN が混入しない。
    expect(Number.isNaN(d.current.transaction_count)).toBe(false);
    expect(d.current.transaction_count).toBe(0);
    expect(d.current.customer_count).toBe(0);
    expect(d.current.repeat_customer_count).toBe(0);
    // 有効値はそのまま number 化される。
    expect(d.current.new_customer_count).toBe(10);
    expect(d.current.total_amount).toBe(200);
    expect(d.lastYear).not.toBeNull();
    expect(Number.isNaN(d.lastYear!.transaction_count)).toBe(false);
    expect(d.lastYear!.transaction_count).toBe(0);
    expect(d.lastYear!.new_customer_count).toBe(5);
  });
});

describe('calculateYoY — B18 NaN 伝播ガード', () => {
  it('current が NaN → 0 とみなす (lastYear 有効なら down)', () => {
    const res = calculateYoY(NaN, 100);
    expect(res.current).toBe(0);
    expect(res.lastYear).toBe(100);
    expect(res.deltaPercent).toBeCloseTo(-100);
    expect(res.classification).toBe('down');
  });

  it('current が Infinity → 0 とみなす', () => {
    const res = calculateYoY(Infinity, 100);
    expect(res.current).toBe(0);
    expect(res.deltaPercent).toBeCloseTo(-100);
  });

  it('lastYear が NaN → null 扱い → no_data', () => {
    const res = calculateYoY(100, NaN);
    expect(res.current).toBe(100);
    expect(res.lastYear).toBeNull();
    expect(res.deltaPercent).toBeNull();
    expect(res.classification).toBe('no_data');
  });

  it('lastYear が Infinity → null 扱い → no_data', () => {
    const res = calculateYoY(100, Infinity);
    expect(res.lastYear).toBeNull();
    expect(res.classification).toBe('no_data');
  });

  it('両方 NaN → current=0 / lastYear=null / no_data', () => {
    const res = calculateYoY(NaN, NaN);
    expect(res.current).toBe(0);
    expect(res.lastYear).toBeNull();
    expect(res.classification).toBe('no_data');
  });

  it('正常系は従来挙動を維持 (up)', () => {
    const res = calculateYoY(120, 100);
    expect(res.current).toBe(120);
    expect(res.lastYear).toBe(100);
    expect(res.deltaPercent).toBeCloseTo(20);
    expect(res.classification).toBe('up');
  });
});

describe('aggregateSalesRangeTotals — B18 NaN 伝播ガード', () => {
  it('数値文字列 / null / Infinity / undefined を含む byDate でも全フィールド有限数で集計', () => {
    const byDate = {
      d1: {
        total_amount: '100' as unknown as number,
        open_total_amount: null as unknown as number,
        transaction_count: 5,
        customer_count: '3' as unknown as number,
        new_customer_count: Infinity as unknown as number,
        repeat_customer_count: 2,
        regular_customer_count: undefined as unknown as number,
        staff_customer_count: 1,
        unlisted_customer_count: 'abc' as unknown as number,
      },
      d2: {
        total_amount: 50,
        open_total_amount: 10,
        transaction_count: 3,
        customer_count: 2,
        new_customer_count: 1,
        repeat_customer_count: 1,
        regular_customer_count: 1,
        staff_customer_count: 0,
        unlisted_customer_count: 0,
      },
    };
    const res = aggregateSalesRangeTotals(byDate);
    // 文字列 "100" は数値化、null/Infinity/undefined/"abc" は 0 補完。
    expect(res.total_amount).toBe(150); // 100 + 50
    expect(res.open_total_amount).toBe(10); // 0(null) + 10
    expect(res.transaction_count).toBe(8);
    expect(res.customer_count).toBe(5); // 3 + 2
    expect(res.new_customer_count).toBe(1); // 0(Infinity) + 1
    expect(res.regular_customer_count).toBe(1); // 0(undefined) + 1
    expect(res.unlisted_customer_count).toBe(0); // 0("abc") + 0
    // どのフィールドも NaN / 文字列でないこと。
    Object.values(res).forEach((v) => expect(Number.isFinite(v)).toBe(true));
  });
});

describe('shiftRangeOneYearBack — B19 うるう年回帰保護', () => {
  it('end が 2/29 のとき前年範囲は 2/28 に潰れる (表示ラベル挙動を固定)', () => {
    const res = shiftRangeOneYearBack({ start_date: '2024-02-28', end_date: '2024-02-29' });
    expect(res.start_date).toBe('2023-02-28');
    expect(res.end_date).toBe('2023-02-28');
  });

  it('うるう年でも集計は current 各日を個別 back-shift して正しく対応する', () => {
    // current 2024-02-28, 2024-02-29 → 前年 2023-02-28(両日とも)。
    // 前年 4 セグ合計 >= MIN_LASTYEAR_CUSTOMERS(10) にして insufficient 判定を回避し、
    // 「うるう年でも前年同日にマッチする」集計の正しさを検証する。
    const day = (over: Partial<SalesRangeLike['byDate'][string]> = {}) => ({
      total_amount: 100,
      transaction_count: 1,
      customer_count: 12,
      new_customer_count: 4,
      repeat_customer_count: 4,
      regular_customer_count: 2,
      staff_customer_count: 2,
      ...over,
    });
    const current: SalesRangeLike = {
      byDate: { '2024-02-28': day(), '2024-02-29': day({ total_amount: 200 }) },
    };
    const lastYear: SalesRangeLike = {
      byDate: { '2023-02-28': day({ total_amount: 80 }) },
    };
    const res = buildYoYResultFromResponses({
      start_date: '2024-02-28',
      end_date: '2024-02-29',
      currentRes: current,
      lastYearRes: lastYear,
    });
    // 表示ラベルは単日に潰れる。
    expect(res.lastYearPeriod).toEqual({ start: '2023-02-28', end: '2023-02-28' });
    // current 各日は個別 back-shift: 2/28→2023-02-28(マッチ), 2/29→2023-02-28(マッチ)。
    expect(res.byDate.find((b) => b.business_date === '2024-02-28')?.lastYearDate).toBe('2023-02-28');
    expect(res.byDate.find((b) => b.business_date === '2024-02-29')?.lastYearDate).toBe('2023-02-28');
    // 両日とも前年同日にデータがマッチ → coverage 1。
    expect(res.dataCoverage).toBe(1);
  });
});
