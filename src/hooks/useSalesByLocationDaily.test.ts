import { describe, it, expect } from 'vitest';
import { normalizeByLocationDaily } from './useSalesByLocationDaily';
import { getLocationColors } from '../lib/sales/locationColors';

// =============================================================================
// normalizeByLocationDaily（Wave3 / Engineer B）
// RPC get_sales_by_location_daily_scoped の返り jsonb → 店舗別×日別系列の純関数テスト。
// 観点: 複数店×複数日 / date 昇順 / 全店フィールド合算 totalsSeries / null 数値 0 補完 /
//        空入力 / 単店 / 色割当（B13）。
// =============================================================================

function mkDay(overrides: Record<string, number> = {}) {
  return {
    total_amount: 0,
    open_total_amount: 0,
    new_customer_count: 0,
    repeat_customer_count: 0,
    regular_customer_count: 0,
    staff_customer_count: 0,
    unlisted_customer_count: 0,
    new_sales: 0,
    repeat_sales: 0,
    regular_sales: 0,
    staff_sales: 0,
    unlisted_sales: 0,
    transaction_count: 0,
    customer_count: 0,
    open_order_count: 0,
    ...overrides,
  };
}

describe('normalizeByLocationDaily', () => {
  it('複数店×複数日: 各店 points が date 昇順で DailySegmentPoint 化される', () => {
    const raw = {
      byLocationDaily: [
        {
          location_id: 'LOC_A',
          location_name: '吸暮',
          days: {
            // わざと降順で渡し、ソートされることを確認。
            '2026-05-02': mkDay({ new_customer_count: 3, new_sales: 300 }),
            '2026-05-01': mkDay({ new_customer_count: 1, new_sales: 100 }),
          },
        },
        {
          location_id: 'LOC_B',
          location_name: 'KITUNE',
          days: {
            '2026-05-01': mkDay({ repeat_customer_count: 5, repeat_sales: 500 }),
          },
        },
      ],
      allDates: ['2026-05-01', '2026-05-02'],
    };

    const { locationSeries, allDates } = normalizeByLocationDaily(raw);

    expect(locationSeries).toHaveLength(2);
    expect(allDates).toEqual(['2026-05-01', '2026-05-02']);

    const a = locationSeries.find((s) => s.locationId === 'LOC_A')!;
    expect(a.locationName).toBe('吸暮');
    // date 昇順。
    expect(a.points.map((p) => p.date)).toEqual(['2026-05-01', '2026-05-02']);
    expect(a.points[0].new).toBe(1);
    expect(a.points[0].newSales).toBe(100);
    expect(a.points[1].new).toBe(3);

    const b = locationSeries.find((s) => s.locationId === 'LOC_B')!;
    expect(b.points).toHaveLength(1);
    expect(b.points[0].repeat).toBe(5);
    expect(b.points[0].repeatSales).toBe(500);
  });

  it('totalsSeries は allDates ごとに全店 points をフィールド合算する', () => {
    const raw = {
      byLocationDaily: [
        {
          location_id: 'LOC_A',
          location_name: '吸暮',
          days: {
            '2026-05-01': mkDay({ new_customer_count: 1, new_sales: 100 }),
            '2026-05-02': mkDay({ repeat_customer_count: 2, repeat_sales: 200 }),
          },
        },
        {
          location_id: 'LOC_B',
          location_name: 'KITUNE',
          days: {
            '2026-05-01': mkDay({ new_customer_count: 4, new_sales: 400, staff_sales: 50 }),
            // LOC_B は 2026-05-02 のデータ無し（欠落）→ 合算で 0 扱い。
          },
        },
      ],
      allDates: ['2026-05-01', '2026-05-02'],
    };

    const { totalsSeries } = normalizeByLocationDaily(raw);

    expect(totalsSeries.map((p) => p.date)).toEqual(['2026-05-01', '2026-05-02']);
    // 2026-05-01: new = 1 + 4 = 5, newSales = 100 + 400 = 500, staffSales = 50。
    const d1 = totalsSeries[0];
    expect(d1.new).toBe(5);
    expect(d1.newSales).toBe(500);
    expect(d1.staffSales).toBe(50);
    // 2026-05-02: LOC_A のみ（LOC_B 欠落）→ repeat = 2, repeatSales = 200。
    const d2 = totalsSeries[1];
    expect(d2.repeat).toBe(2);
    expect(d2.repeatSales).toBe(200);
    expect(d2.new).toBe(0);
  });

  it('null/欠落の数値は 0 補完される（NaN 伝播なし）', () => {
    const raw = {
      byLocationDaily: [
        {
          location_id: 'LOC_A',
          location_name: '吸暮',
          days: {
            '2026-05-01': {
              // 一部フィールドのみ・残りは欠落（undefined）。null も混入。
              new_customer_count: null,
              repeat_customer_count: 3,
              new_sales: undefined,
              repeat_sales: 'not-a-number',
            },
          },
        },
      ],
      allDates: ['2026-05-01'],
    };

    const { locationSeries, totalsSeries } = normalizeByLocationDaily(raw as unknown);
    const p = locationSeries[0].points[0];
    expect(p.new).toBe(0); // null → 0
    expect(p.repeat).toBe(3);
    expect(p.newSales).toBe(0); // undefined → 0
    expect(p.repeatSales).toBe(0); // 文字列 → 0
    expect(Number.isFinite(p.new)).toBe(true);
    expect(Number.isNaN(totalsSeries[0].newSales)).toBe(false);
  });

  it('空入力（byLocationDaily=[] / null / 不正）は空集合を返す（fail-closed）', () => {
    for (const raw of [null, undefined, {}, { byLocationDaily: [] }, { byLocationDaily: 'x' }, 42]) {
      const r = normalizeByLocationDaily(raw as unknown);
      expect(r.locationSeries).toEqual([]);
      expect(r.totalsSeries).toEqual([]);
      expect(r.allDates).toEqual([]);
      expect(r.colorMap).toEqual({});
    }
  });

  it('単店: locationSeries 1 件、totalsSeries は単店 points と一致', () => {
    const raw = {
      byLocationDaily: [
        {
          location_id: 'LOC_A',
          location_name: '吸暮',
          days: {
            '2026-05-01': mkDay({ new_customer_count: 7, new_sales: 700 }),
          },
        },
      ],
      allDates: ['2026-05-01'],
    };

    const { locationSeries, totalsSeries, colorMap } = normalizeByLocationDaily(raw);
    expect(locationSeries).toHaveLength(1);
    expect(totalsSeries).toHaveLength(1);
    expect(totalsSeries[0].new).toBe(locationSeries[0].points[0].new);
    expect(totalsSeries[0].newSales).toBe(700);
    // 2026-07-21 D3: 色は location_name 由来。colorMap は代表 locationId キー。
    expect(colorMap).toEqual({ LOC_A: getLocationColors(['吸暮'])['吸暮'] });
    expect(locationSeries[0].color).toBe(colorMap['LOC_A']);
  });

  it('2026-07-21 D-01: 同名 2 location_id 系列は location_name マージで 1 系列に合算される（同日重複はフィールド毎加算）', () => {
    const raw = {
      byLocationDaily: [
        {
          location_id: 'OLD_SOUQ',
          location_name: '吸暮',
          days: {
            '2026-07-25': mkDay({ new_customer_count: 2, new_sales: 200 }),
          },
        },
        {
          location_id: 'NEW_SOUQ',
          location_name: '吸暮',
          days: {
            // 切替当日は旧新双方にデータが入り得る → 同日合算されること。
            '2026-07-25': mkDay({ new_customer_count: 3, new_sales: 300 }),
          },
        },
      ],
      allDates: ['2026-07-25'],
    };

    const { locationSeries } = normalizeByLocationDaily(raw);
    expect(locationSeries).toHaveLength(1);
    expect(locationSeries[0].locationName).toBe('吸暮');
    // 代表 locationId = 初出行(OLD_SOUQ)。
    expect(locationSeries[0].locationId).toBe('OLD_SOUQ');
    expect(locationSeries[0].points).toHaveLength(1);
    expect(locationSeries[0].points[0].new).toBe(5);
    expect(locationSeries[0].points[0].newSales).toBe(500);
  });

  it('allDates が RPC から欠落しても全店 days キーの和集合を昇順 distinct で再構築する', () => {
    const raw = {
      byLocationDaily: [
        {
          location_id: 'LOC_A',
          location_name: '吸暮',
          days: { '2026-05-03': mkDay(), '2026-05-01': mkDay() },
        },
        {
          location_id: 'LOC_B',
          location_name: 'KITUNE',
          days: { '2026-05-02': mkDay(), '2026-05-01': mkDay() },
        },
      ],
      // allDates 欠落。
    };

    const { allDates } = normalizeByLocationDaily(raw);
    expect(allDates).toEqual(['2026-05-01', '2026-05-02', '2026-05-03']);
  });
});
