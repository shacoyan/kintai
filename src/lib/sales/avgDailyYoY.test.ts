import { describe, it, expect } from 'vitest';
import { computeAvgDailyYoY } from './avgDailyYoY';
import type { SalesRangeYoYResult } from './yoy';

// byDate の 1 行を組む小ヘルパ（テストに必要なフィールドのみ）。
function row(
  business_date: string,
  curAmount: number,
  lyAmount: number | null,
): SalesRangeYoYResult['byDate'][number] {
  return {
    business_date,
    lastYearDate: business_date,
    current: { total_amount: curAmount, transaction_count: 0, customer_count: 0 },
    lastYear:
      lyAmount === null
        ? null
        : { total_amount: lyAmount, transaction_count: 0, customer_count: 0 },
  };
}

// computeAvgDailyYoY は byDate のみ参照するので、最小構成を as でキャストして渡す。
function yoyWith(byDate: SalesRangeYoYResult['byDate']): SalesRangeYoYResult {
  return { byDate } as unknown as SalesRangeYoYResult;
}

describe('computeAvgDailyYoY', () => {
  it('yoy=null のとき null', () => {
    expect(computeAvgDailyYoY(null)).toBeNull();
  });

  it('byDate 空のとき null', () => {
    expect(computeAvgDailyYoY(yoyWith([]))).toBeNull();
  });

  it('当年=byDate 全件平均、前年=前年実在行のみ平均で YoY を出す', () => {
    // 当年: 3 日 [100,200,300] → 平均 200
    // 前年: 3 日 [50,100,150]  → 平均 100 → +100%（up）
    const yoy = yoyWith([
      row('2026-06-01', 100, 50),
      row('2026-06-02', 200, 100),
      row('2026-06-03', 300, 150),
    ]);
    const delta = computeAvgDailyYoY(yoy);
    expect(delta).not.toBeNull();
    expect(delta!.classification).toBe('up');
    expect(delta!.current).toBeCloseTo(200, 5);
    expect(delta!.lastYear).toBeCloseTo(100, 5);
    expect(delta!.deltaPercent).toBeCloseTo(100, 5);
  });

  it('回帰: 前年が一部日付のみ存在しても符号が正しい（前回の符号逆転バグ）', () => {
    // 当年 4 日 [100,100,100,100] → 当年日平均 100。
    // 前年は 2 日のみ実在 [200,200]（残 2 日は lastYear=null）→ 前年日平均 200。
    // 正: 100 < 200 で down（前年比 -50%）。
    // 前回バグ: 前年分子=実在2日合計400 を 当年実在日数4 で割る等で 100 に化け flat/up へ
    //          符号逆転していた。本実装は「前年実在行のみで分子/分母を揃える」ため正しく down。
    const yoy = yoyWith([
      row('2026-06-01', 100, 200),
      row('2026-06-02', 100, 200),
      row('2026-06-03', 100, null),
      row('2026-06-04', 100, null),
    ]);
    const delta = computeAvgDailyYoY(yoy);
    expect(delta).not.toBeNull();
    expect(delta!.current).toBeCloseTo(100, 5);
    expect(delta!.lastYear).toBeCloseTo(200, 5);
    expect(delta!.classification).toBe('down');
    expect(delta!.deltaPercent).toBeCloseTo(-50, 5);
  });

  it('前年が全行 null のとき no_data（lastYear=null）', () => {
    const yoy = yoyWith([row('2026-06-01', 100, null), row('2026-06-02', 200, null)]);
    const delta = computeAvgDailyYoY(yoy);
    expect(delta).not.toBeNull();
    expect(delta!.classification).toBe('no_data');
    expect(delta!.lastYear).toBeNull();
  });
});
