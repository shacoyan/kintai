import { describe, it, expect } from 'vitest';
import { computeAvgDailyYoY, inclusiveDaySpan } from './avgDailyYoY';
import type { SalesRangeYoYResult, SalesRangeTotal } from './yoy';

// open 込みの合計を持つ SalesRangeTotal（テストに必要なフィールドのみ + キャスト）。
function totals(total_amount: number, open_total_amount: number): SalesRangeTotal {
  return { total_amount, open_total_amount } as unknown as SalesRangeTotal;
}

// computeAvgDailyYoY が参照する period / lastYearPeriod / current / lastYear を最小構成で組む。
// 分母は連続全カレンダー日数（period / lastYearPeriod の両端含む span）なので、
// byDate ではなく period の {start,end} が分母を決める（母数統一の核心）。
function yoyWith(args: {
  period: { start: string; end: string };
  lastYearPeriod: { start: string; end: string };
  current: SalesRangeTotal;
  lastYear: SalesRangeTotal | null;
}): SalesRangeYoYResult {
  return {
    period: args.period,
    lastYearPeriod: args.lastYearPeriod,
    current: args.current,
    lastYear: args.lastYear,
    byDate: [],
  } as unknown as SalesRangeYoYResult;
}

describe('inclusiveDaySpan', () => {
  it('両端含む連続日数を返す（カード elapsedDays = enumerateDates(from,to).length と一致）', () => {
    expect(inclusiveDaySpan('2026-06-01', '2026-06-03')).toBe(3);
    expect(inclusiveDaySpan('2026-06-01', '2026-06-01')).toBe(1);
    expect(inclusiveDaySpan('2026-06-01', '2026-06-30')).toBe(30);
  });

  it('月跨ぎ・年跨ぎも UTC 両端含みで正しい', () => {
    expect(inclusiveDaySpan('2026-01-30', '2026-02-02')).toBe(4);
    expect(inclusiveDaySpan('2025-12-30', '2026-01-02')).toBe(4);
  });

  it('不正入力は 0', () => {
    expect(inclusiveDaySpan('', '2026-06-03')).toBe(0);
    expect(inclusiveDaySpan('2026-06-03', '2026-06-01')).toBe(0); // 逆順
    expect(inclusiveDaySpan('not-a-date', '2026-06-03')).toBe(0);
  });
});

describe('computeAvgDailyYoY', () => {
  it('yoy=null のとき null', () => {
    expect(computeAvgDailyYoY(null)).toBeNull();
  });

  it('当年 period span が 0 のとき null', () => {
    const yoy = yoyWith({
      period: { start: '2026-06-03', end: '2026-06-01' }, // 逆順 → span 0
      lastYearPeriod: { start: '2025-06-01', end: '2025-06-03' },
      current: totals(0, 0),
      lastYear: totals(0, 0),
    });
    expect(computeAvgDailyYoY(yoy)).toBeNull();
  });

  it('カードと同母数: 当年=open込み合計/当年連続全日数、前年=open込み合計/前年連続全日数', () => {
    // 当年 3 日(6/1-6/3): 決済済 450 + open 150 = 600 → 日平均 200。
    // 前年 3 日(前年同期): 決済済 240 + open 60 = 300 → 日平均 100 → +100%（up）。
    const yoy = yoyWith({
      period: { start: '2026-06-01', end: '2026-06-03' },
      lastYearPeriod: { start: '2025-06-01', end: '2025-06-03' },
      current: totals(450, 150),
      lastYear: totals(240, 60),
    });
    const delta = computeAvgDailyYoY(yoy);
    expect(delta).not.toBeNull();
    expect(delta!.classification).toBe('up');
    expect(delta!.current).toBeCloseTo(200, 5); // 600 / 3
    expect(delta!.lastYear).toBeCloseTo(100, 5); // 300 / 3
    expect(delta!.deltaPercent).toBeCloseTo(100, 5);
  });

  it('母数は連続全日数（実売上日が欠損していても period span で割る = カードと一致）', () => {
    // RPC は実売上日しか byDate に返さないが、分母は period の連続全日数。
    // 6/1-6/4 の 4 日 span。当年 open 込み合計 400 → 日平均 100。
    // 前年も 6/1-6/4 の 4 日 span。open 込み合計 400 → 日平均 100 → flat。
    // （round1 は前年を matched 行数 2 で割り 200=down だったが、母数非対称で誤り。
    //   連続全日数で当年/前年とも割ると対称化され正しく flat になる。）
    const yoy = yoyWith({
      period: { start: '2026-06-01', end: '2026-06-04' },
      lastYearPeriod: { start: '2025-06-01', end: '2025-06-04' },
      current: totals(400, 0),
      lastYear: totals(400, 0),
    });
    const delta = computeAvgDailyYoY(yoy);
    expect(delta).not.toBeNull();
    expect(delta!.current).toBeCloseTo(100, 5); // 400 / 4
    expect(delta!.lastYear).toBeCloseTo(100, 5); // 400 / 4（前年も連続全日数）
    expect(delta!.classification).toBe('flat');
  });

  it('open が当年/前年とも分子に入る（open 抜きとは値が変わる）', () => {
    // 当年 2 日: 決済済 200 + open 200 = 400 → 平均 200。
    // 前年 2 日: 決済済 100 + open 100 = 200 → 平均 100 → +100%。
    const yoy = yoyWith({
      period: { start: '2026-06-01', end: '2026-06-02' },
      lastYearPeriod: { start: '2025-06-01', end: '2025-06-02' },
      current: totals(200, 200),
      lastYear: totals(100, 100),
    });
    const delta = computeAvgDailyYoY(yoy);
    expect(delta!.current).toBeCloseTo(200, 5);
    expect(delta!.lastYear).toBeCloseTo(100, 5);
    expect(delta!.classification).toBe('up');
  });

  it('前年が null（希薄判定で除外）のとき no_data', () => {
    const yoy = yoyWith({
      period: { start: '2026-06-01', end: '2026-06-02' },
      lastYearPeriod: { start: '2025-06-01', end: '2025-06-02' },
      current: totals(300, 0),
      lastYear: null,
    });
    const delta = computeAvgDailyYoY(yoy);
    expect(delta).not.toBeNull();
    expect(delta!.classification).toBe('no_data');
    expect(delta!.lastYear).toBeNull();
  });
});
