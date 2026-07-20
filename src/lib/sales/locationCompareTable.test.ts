import { describe, expect, it } from 'vitest';
import { buildLocationCompareTable } from './locationCompareTable';
import type { SalesByLocationRow } from '../../hooks/useSalesByLocation';
import type { AcquisitionBreakdown, DailySegmentPoint } from './types';

// =============================================================================
// locationCompareTable のユニットテスト（設計書 §6-C item3 網羅）
// =============================================================================

function row(name: string, totalSales: number, totalCustomers: number): SalesByLocationRow {
  return { locationId: `${name}-id`, locationName: name, totalSales, totalCustomers, color: '#000' };
}

function point(
  date: string,
  overrides: Partial<DailySegmentPoint> = {},
): DailySegmentPoint {
  return {
    date,
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

const emptyAcq: AcquisitionBreakdown = { google: 0, review: 0, signboard: 0, sns: 0, unknown: 0 };

describe('buildLocationCompareTable', () => {
  it('totalSales DESC に並ぶ（合計行は別フィールド）', () => {
    const currentRows = [row('B店', 1000, 10), row('A店', 3000, 20), row('C店', 2000, 15)];
    const result = buildLocationCompareTable({
      currentRows,
      lastYearRows: null,
      dailySeries: null,
      acquisitionByName: null,
      elapsedDays: 10,
      lastYearDays: 10,
    });
    expect(result.rows.map((r) => r.locationName)).toEqual(['A店', 'C店', 'B店']);
    expect(result.totals.locationName).toBe('合計');
    expect(result.totals.totalSales).toBe(6000);
    expect(result.totals.totalCustomers).toBe(45);
  });

  it('lastYearRows=null（非適用期間）は yoy が全行 null', () => {
    const currentRows = [row('A店', 1000, 10)];
    const result = buildLocationCompareTable({
      currentRows,
      lastYearRows: null,
      dailySeries: null,
      acquisitionByName: null,
      elapsedDays: 10,
      lastYearDays: 10,
    });
    expect(result.rows[0].yoy).toBeNull();
    expect(result.totals.yoy).toBeNull();
  });

  it('locationName 突合: 前年に同名店なし → no_data（yoy 自体は null でなく各メトリクスが no_data）', () => {
    const currentRows = [row('A店', 2000, 20)];
    const lastYearRows = [row('B店', 1000, 15)]; // 別名 → A店にマッチしない
    const result = buildLocationCompareTable({
      currentRows,
      lastYearRows,
      dailySeries: null,
      acquisitionByName: null,
      elapsedDays: 10,
      lastYearDays: 10,
    });
    const yoy = result.rows[0].yoy;
    expect(yoy).not.toBeNull();
    expect(yoy!.totalSales.classification).toBe('no_data');
    expect(yoy!.totalCustomers.classification).toBe('no_data');
    expect(yoy!.perCustomer.classification).toBe('no_data');
    expect(yoy!.avgDailySales.classification).toBe('no_data');
  });

  it('前年 4 セグ客数が閾値未満(9人)は no_data、閾値(10人)ちょうどは有効', () => {
    const currentRows = [row('A店', 2000, 20), row('B店', 2200, 20)];
    const lastYearRows = [row('A店', 1000, 9), row('B店', 1000, 10)];
    const result = buildLocationCompareTable({
      currentRows,
      lastYearRows,
      dailySeries: null,
      acquisitionByName: null,
      elapsedDays: 10,
      lastYearDays: 10,
    });
    const a = result.rows.find((r) => r.locationName === 'A店')!;
    const b = result.rows.find((r) => r.locationName === 'B店')!;
    expect(a.yoy!.totalSales.classification).toBe('no_data');
    expect(b.yoy!.totalSales.classification).not.toBe('no_data');
    expect(b.yoy!.totalSales.lastYear).toBe(1000);
  });

  it('合計行 YoY も前年合算客数に同一閾値を適用する', () => {
    // 各店は閾値未満だが合算すると 10 人以上になるケース(5+6=11)。
    const currentRows = [row('A店', 1000, 20), row('B店', 1000, 20)];
    const lastYearRows = [row('A店', 500, 5), row('B店', 500, 6)];
    const result = buildLocationCompareTable({
      currentRows,
      lastYearRows,
      dailySeries: null,
      acquisitionByName: null,
      elapsedDays: 10,
      lastYearDays: 10,
    });
    // 個店はそれぞれ閾値未満で no_data。
    expect(result.rows.every((r) => r.yoy!.totalSales.classification === 'no_data')).toBe(true);
    // 合計は合算客数 11 人 >= 10 で有効。
    expect(result.totals.yoy!.totalSales.classification).not.toBe('no_data');
    expect(result.totals.yoy!.totalSales.lastYear).toBe(1000);
  });

  it('分母の非対称性: 当年 elapsedDays / 前年 lastYearDays を別々に使う', () => {
    const currentRows = [row('A店', 1000, 20)];
    const lastYearRows = [row('A店', 500, 20)];
    const result = buildLocationCompareTable({
      currentRows,
      lastYearRows,
      dailySeries: null,
      acquisitionByName: null,
      elapsedDays: 10, // 当年 平均日売上 = 100
      lastYearDays: 5, // 前年 平均日売上 = 100（同値でも分母が違う）
    });
    const a = result.rows[0];
    expect(a.averageDailySales).toBe(100);
    expect(a.yoy!.avgDailySales.lastYear).toBe(100); // 500/5
    expect(a.yoy!.avgDailySales.classification).toBe('flat');
  });

  it('0 客の店は perCustomer が null', () => {
    const currentRows = [row('A店', 1000, 0)];
    const result = buildLocationCompareTable({
      currentRows,
      lastYearRows: null,
      dailySeries: null,
      acquisitionByName: null,
      elapsedDays: 10,
      lastYearDays: 10,
    });
    expect(result.rows[0].perCustomer).toBeNull();
  });

  it('elapsedDays=0 は averageDailySales が null', () => {
    const currentRows = [row('A店', 1000, 10)];
    const result = buildLocationCompareTable({
      currentRows,
      lastYearRows: null,
      dailySeries: null,
      acquisitionByName: null,
      elapsedDays: 0,
      lastYearDays: 0,
    });
    expect(result.rows[0].averageDailySales).toBeNull();
  });

  it('totals の acquisition は 1 店でも null なら null（過少表示禁止）', () => {
    const currentRows = [row('A店', 1000, 10), row('B店', 2000, 20)];
    const acquisitionByName: Record<string, AcquisitionBreakdown | null> = {
      A店: { ...emptyAcq, google: 5 },
      B店: null, // 失敗店
    };
    const result = buildLocationCompareTable({
      currentRows,
      lastYearRows: null,
      dailySeries: null,
      acquisitionByName,
      elapsedDays: 10,
      lastYearDays: 10,
    });
    const a = result.rows.find((r) => r.locationName === 'A店')!;
    const b = result.rows.find((r) => r.locationName === 'B店')!;
    expect(a.acquisition).toEqual({ ...emptyAcq, google: 5 });
    expect(b.acquisition).toBeNull();
    expect(result.totals.acquisition).toBeNull();
  });

  it('acquisitionByName が全店成功なら totals も合算される', () => {
    const currentRows = [row('A店', 1000, 10), row('B店', 2000, 20)];
    const acquisitionByName: Record<string, AcquisitionBreakdown | null> = {
      A店: { ...emptyAcq, google: 5 },
      B店: { ...emptyAcq, google: 3, sns: 2 },
    };
    const result = buildLocationCompareTable({
      currentRows,
      lastYearRows: null,
      dailySeries: null,
      acquisitionByName,
      elapsedDays: 10,
      lastYearDays: 10,
    });
    expect(result.totals.acquisition).toEqual({ ...emptyAcq, google: 8, sns: 2 });
  });

  it('acquisitionByName=null（非対象期間）は全行・totals とも null', () => {
    const currentRows = [row('A店', 1000, 10)];
    const result = buildLocationCompareTable({
      currentRows,
      lastYearRows: null,
      dailySeries: null,
      acquisitionByName: null,
      elapsedDays: 10,
      lastYearDays: 10,
    });
    expect(result.rows[0].acquisition).toBeNull();
    expect(result.totals.acquisition).toBeNull();
  });

  it('dailySeries=null は seg が全行・totals とも null', () => {
    const currentRows = [row('A店', 1000, 10)];
    const result = buildLocationCompareTable({
      currentRows,
      lastYearRows: null,
      dailySeries: null,
      acquisitionByName: null,
      elapsedDays: 10,
      lastYearDays: 10,
    });
    expect(result.rows[0].seg).toBeNull();
    expect(result.totals.seg).toBeNull();
  });

  it('dailySeries が期間合算されセグ4列+記載なし売上を返す（該当店なしは null）', () => {
    const currentRows = [row('A店', 1000, 10), row('B店', 2000, 20)];
    const dailySeries = [
      {
        locationName: 'A店',
        points: [
          point('2026-07-01', { new: 2, repeat: 1, unlistedSales: 500 }),
          point('2026-07-02', { new: 1, regular: 3, unlistedSales: 300 }),
        ],
      },
      // B店は 077 に該当なし → seg=null
    ];
    const result = buildLocationCompareTable({
      currentRows,
      lastYearRows: null,
      dailySeries,
      acquisitionByName: null,
      elapsedDays: 2,
      lastYearDays: 2,
    });
    const a = result.rows.find((r) => r.locationName === 'A店')!;
    const b = result.rows.find((r) => r.locationName === 'B店')!;
    expect(a.seg).toEqual({ new: 3, repeat: 1, regular: 3, staff: 0, unlistedSales: 800 });
    expect(b.seg).toBeNull();
    // 合計行は該当店の合算（B店の null 分は 0 扱いでスキップ）。
    expect(result.totals.seg).toEqual({ new: 3, repeat: 1, regular: 3, staff: 0, unlistedSales: 800 });
  });

  it('客単価 = totalSales/totalCustomers（生値・丸めない）', () => {
    const currentRows = [row('A店', 1000, 3)];
    const result = buildLocationCompareTable({
      currentRows,
      lastYearRows: null,
      dailySeries: null,
      acquisitionByName: null,
      elapsedDays: 10,
      lastYearDays: 10,
    });
    expect(result.rows[0].perCustomer).toBeCloseTo(1000 / 3);
  });
});
