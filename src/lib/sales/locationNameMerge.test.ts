import { describe, it, expect } from 'vitest';
import {
  mergeSalesByLocationRowsByName,
  mergeLocationDailySeriesByName,
} from './locationNameMerge';
import { getLocationColors } from './locationColors';
import type { SalesByLocationRow } from '../../hooks/useSalesByLocation';
import type { LocationDailySeries } from '../../hooks/useSalesByLocationDaily';
import type { DailySegmentPoint } from './types';

// =============================================================================
// locationNameMerge（2026-07-21 kintai-sales-dedupe-compare / Engineer B）
// 観点: 同名マージ加算 / 別名素通し / 総和不変性 / 同名同日の重複日合算 /
//        空 name / 色の決定性（入力順が違っても同一 name 集合なら同色）。
// =============================================================================

function mkRow(overrides: Partial<SalesByLocationRow>): SalesByLocationRow {
  return {
    locationId: 'X',
    locationName: 'X',
    totalSales: 0,
    totalCustomers: 0,
    color: '',
    ...overrides,
  };
}

function mkPoint(overrides: Partial<DailySegmentPoint>): DailySegmentPoint {
  return {
    date: '2026-01-01',
    new: 0,
    repeat: 0,
    regular: 0,
    staff: 0,
    unlisted: 0,
    newSales: 0,
    repeatSales: 0,
    regularSales: 0,
    staffSales: 0,
    unlistedSales: 0,
    ...overrides,
  };
}

function mkSeries(overrides: Partial<LocationDailySeries>): LocationDailySeries {
  return {
    locationId: 'X',
    locationName: 'X',
    color: '',
    points: [],
    ...overrides,
  };
}

describe('mergeSalesByLocationRowsByName', () => {
  it('同名 2 id 行は totalSales/totalCustomers を加算し 1 行に統合、代表 ID は初出', () => {
    const rows = [
      mkRow({ locationId: 'OLD', locationName: '吸暮', totalSales: 1000, totalCustomers: 5 }),
      mkRow({ locationId: 'NEW', locationName: '吸暮', totalSales: 500, totalCustomers: 3 }),
    ];
    const merged = mergeSalesByLocationRowsByName(rows);
    expect(merged).toHaveLength(1);
    expect(merged[0].locationId).toBe('OLD');
    expect(merged[0].locationName).toBe('吸暮');
    expect(merged[0].totalSales).toBe(1500);
    expect(merged[0].totalCustomers).toBe(8);
  });

  it('別名の行はそのまま素通し（初出順維持）', () => {
    const rows = [
      mkRow({ locationId: 'A', locationName: 'KITUNE', totalSales: 100, totalCustomers: 1 }),
      mkRow({ locationId: 'B', locationName: 'moumou', totalSales: 200, totalCustomers: 2 }),
    ];
    const merged = mergeSalesByLocationRowsByName(rows);
    expect(merged.map((r) => r.locationName)).toEqual(['KITUNE', 'moumou']);
    expect(merged.map((r) => r.locationId)).toEqual(['A', 'B']);
  });

  it('総和不変性: マージ前後で totalSales/totalCustomers の合計が一致する', () => {
    const rows = [
      mkRow({ locationId: 'OLD1', locationName: '吸暮', totalSales: 1000, totalCustomers: 5 }),
      mkRow({ locationId: 'NEW1', locationName: '吸暮', totalSales: 500, totalCustomers: 3 }),
      mkRow({ locationId: 'OLD2', locationName: 'LR', totalSales: 700, totalCustomers: 4 }),
      mkRow({ locationId: 'NEW2', locationName: 'LR', totalSales: 300, totalCustomers: 1 }),
    ];
    const merged = mergeSalesByLocationRowsByName(rows);
    const sumBefore = {
      totalSales: rows.reduce((s, r) => s + r.totalSales, 0),
      totalCustomers: rows.reduce((s, r) => s + r.totalCustomers, 0),
    };
    const sumAfter = {
      totalSales: merged.reduce((s, r) => s + r.totalSales, 0),
      totalCustomers: merged.reduce((s, r) => s + r.totalCustomers, 0),
    };
    expect(sumAfter).toEqual(sumBefore);
  });

  it('空 name の行は 1 グループに畳まれ FALLBACK 色になる', () => {
    const rows = [
      mkRow({ locationId: 'A', locationName: '', totalSales: 10, totalCustomers: 1 }),
      mkRow({ locationId: 'B', locationName: '', totalSales: 20, totalCustomers: 2 }),
    ];
    const merged = mergeSalesByLocationRowsByName(rows);
    expect(merged).toHaveLength(1);
    expect(merged[0].totalSales).toBe(30);
    expect(merged[0].color).toBe(getLocationColors([''])['']);
  });

  it('同一 name 集合なら入力順が違っても色が一致する（071/077 間の色一致担保）', () => {
    const rowsOrderA = [
      mkRow({ locationId: 'A1', locationName: 'KITUNE', totalSales: 1 }),
      mkRow({ locationId: 'A2', locationName: 'moumou', totalSales: 2 }),
      mkRow({ locationId: 'A3', locationName: '吸暮', totalSales: 3 }),
    ];
    const rowsOrderB = [
      mkRow({ locationId: 'B3', locationName: '吸暮', totalSales: 3 }),
      mkRow({ locationId: 'B1', locationName: 'KITUNE', totalSales: 1 }),
      mkRow({ locationId: 'B2', locationName: 'moumou', totalSales: 2 }),
    ];
    const mergedA = mergeSalesByLocationRowsByName(rowsOrderA);
    const mergedB = mergeSalesByLocationRowsByName(rowsOrderB);
    const colorByNameA = Object.fromEntries(mergedA.map((r) => [r.locationName, r.color]));
    const colorByNameB = Object.fromEntries(mergedB.map((r) => [r.locationName, r.color]));
    expect(colorByNameA).toEqual(colorByNameB);
  });
});

describe('mergeLocationDailySeriesByName', () => {
  it('同名 2 id 系列は points を date キーでフィールド毎加算し 1 系列に統合', () => {
    const series = [
      mkSeries({
        locationId: 'OLD',
        locationName: '吸暮',
        points: [mkPoint({ date: '2026-05-01', new: 1, newSales: 100 })],
      }),
      mkSeries({
        locationId: 'NEW',
        locationName: '吸暮',
        points: [mkPoint({ date: '2026-05-01', new: 2, newSales: 200 })],
      }),
    ];
    const { locationSeries } = mergeLocationDailySeriesByName(series);
    expect(locationSeries).toHaveLength(1);
    expect(locationSeries[0].locationId).toBe('OLD');
    expect(locationSeries[0].points).toHaveLength(1);
    expect(locationSeries[0].points[0].new).toBe(3);
    expect(locationSeries[0].points[0].newSales).toBe(300);
  });

  it('別名系列はそのまま素通し（date 昇順維持）', () => {
    const series = [
      mkSeries({
        locationId: 'A',
        locationName: 'KITUNE',
        points: [mkPoint({ date: '2026-05-02' }), mkPoint({ date: '2026-05-01' })],
      }),
    ];
    const { locationSeries } = mergeLocationDailySeriesByName(series);
    expect(locationSeries).toHaveLength(1);
    expect(locationSeries[0].points.map((p) => p.date)).toEqual(['2026-05-01', '2026-05-02']);
  });

  it('総和不変性: totalsSeries 相当（全系列の全フィールド合計）がマージ前後で一致する', () => {
    const series: LocationDailySeries[] = [
      mkSeries({
        locationId: 'OLD1',
        locationName: '吸暮',
        points: [
          mkPoint({ date: '2026-05-01', new: 1, newSales: 100 }),
          mkPoint({ date: '2026-05-02', repeat: 2, repeatSales: 200 }),
        ],
      }),
      mkSeries({
        locationId: 'NEW1',
        locationName: '吸暮',
        points: [mkPoint({ date: '2026-05-01', new: 4, newSales: 400, staffSales: 50 })],
      }),
      mkSeries({
        locationId: 'OLD2',
        locationName: 'LR',
        points: [mkPoint({ date: '2026-05-01', regular: 3, regularSales: 300 })],
      }),
    ];

    function sumAll(list: LocationDailySeries[]): number {
      let total = 0;
      for (const s of list) {
        for (const p of s.points) {
          total +=
            p.new +
            p.repeat +
            p.regular +
            p.staff +
            p.unlisted +
            p.newSales +
            p.repeatSales +
            p.regularSales +
            p.staffSales +
            p.unlistedSales;
        }
      }
      return total;
    }

    const before = sumAll(series);
    const { locationSeries } = mergeLocationDailySeriesByName(series);
    const after = sumAll(locationSeries);
    expect(after).toBe(before);
  });

  it('同名同日の重複はフィールド毎加算される（切替当日想定）', () => {
    const series = [
      mkSeries({
        locationId: 'OLD',
        locationName: '吸暮',
        points: [mkPoint({ date: '2026-07-25', new: 2, newSales: 200, staff: 1, staffSales: 10 })],
      }),
      mkSeries({
        locationId: 'NEW',
        locationName: '吸暮',
        points: [mkPoint({ date: '2026-07-25', new: 3, newSales: 300, staff: 1, staffSales: 20 })],
      }),
    ];
    const { locationSeries } = mergeLocationDailySeriesByName(series);
    const p = locationSeries[0].points[0];
    expect(p.new).toBe(5);
    expect(p.newSales).toBe(500);
    expect(p.staff).toBe(2);
    expect(p.staffSales).toBe(30);
  });

  it('空 name の系列は 1 グループに畳まれ FALLBACK 色になる', () => {
    const series = [
      mkSeries({ locationId: 'A', locationName: '', points: [mkPoint({ date: '2026-05-01', new: 1 })] }),
      mkSeries({ locationId: 'B', locationName: '', points: [mkPoint({ date: '2026-05-01', new: 2 })] }),
    ];
    const { locationSeries, colorMap } = mergeLocationDailySeriesByName(series);
    expect(locationSeries).toHaveLength(1);
    expect(locationSeries[0].points[0].new).toBe(3);
    expect(colorMap['A']).toBe(getLocationColors([''])['']);
  });

  it('colorMap は代表 locationId をキーに、色は location_name 由来で決定的', () => {
    const seriesOrderA = [
      mkSeries({ locationId: 'A1', locationName: 'KITUNE', points: [] }),
      mkSeries({ locationId: 'A2', locationName: '吸暮', points: [] }),
    ];
    const seriesOrderB = [
      mkSeries({ locationId: 'B2', locationName: '吸暮', points: [] }),
      mkSeries({ locationId: 'B1', locationName: 'KITUNE', points: [] }),
    ];
    const resultA = mergeLocationDailySeriesByName(seriesOrderA);
    const resultB = mergeLocationDailySeriesByName(seriesOrderB);
    const colorByNameA = Object.fromEntries(
      resultA.locationSeries.map((s) => [s.locationName, s.color]),
    );
    const colorByNameB = Object.fromEntries(
      resultB.locationSeries.map((s) => [s.locationName, s.color]),
    );
    expect(colorByNameA).toEqual(colorByNameB);
    // colorMap は代表 ID キー(初出の A1/B1 等)で供給される。
    expect(resultA.colorMap['A1']).toBe(colorByNameA['KITUNE']);
    expect(resultB.colorMap['B1']).toBe(colorByNameB['KITUNE']);
  });
});
