import { describe, it, expect } from 'vitest';
import { normalizeByLocation } from './useSalesByLocation';
import { getLocationColors } from '../lib/sales/locationColors';

// =============================================================================
// normalizeByLocation（追補B/C / Engineer C）
// RPC get_sales_by_location_scoped の返り jsonb → rows 整形の純関数テスト。
// 観点: 客数母数 = 4 セグ合計（customer_count 不使用）/ totalSales = 決済済+未決済 /
//        色割当 / fail-closed（空・不正入力）。
// =============================================================================

describe('normalizeByLocation', () => {
  it('totalCustomers は 4 セグ合計（new+repeat+regular+staff）で customer_count(ユニークID) は使わない', () => {
    const raw = {
      byLocation: [
        {
          location_id: 'LOC_A',
          location_name: '吸暮',
          total_amount: 1000,
          open_total_amount: 200,
          // 4 セグ合計 = 10+5+3+2 = 20。customer_count はわざと 999 にして混入しないことを確認。
          customer_count: 999,
          new_customer_count: 10,
          repeat_customer_count: 5,
          regular_customer_count: 3,
          staff_customer_count: 2,
          unlisted_customer_count: 7,
        },
      ],
      meta: { source: 'aggregate', location_ids: ['LOC_A'], use_aggregate: true },
    };

    const { rows } = normalizeByLocation(raw);
    expect(rows).toHaveLength(1);
    // totalCustomers = 4 セグ合計（unlisted も customer_count も含めない）。
    expect(rows[0].totalCustomers).toBe(20);
    // totalSales = total_amount + open_total_amount。
    expect(rows[0].totalSales).toBe(1200);
    expect(rows[0].locationName).toBe('吸暮');
    // 2026-07-21 D3: 色は location_name 由来（location_name マージの決定的色割当）。
    expect(rows[0].color).toBe(getLocationColors(['吸暮'])['吸暮']);
  });

  it('B13: desired index が衝突する複数店でも color が相異なる（getLocationColors 一括適用）', () => {
    // パレット数 N に対し djb2 hash%N が衝突しうる ID を複数並べる。
    const raw = {
      byLocation: [
        { location_id: 'LOC_1', location_name: '店1', total_amount: 100, new_customer_count: 1 },
        { location_id: 'LOC_2', location_name: '店2', total_amount: 90, new_customer_count: 1 },
        { location_id: 'LOC_3', location_name: '店3', total_amount: 80, new_customer_count: 1 },
        { location_id: 'LOC_4', location_name: '店4', total_amount: 70, new_customer_count: 1 },
        { location_id: 'LOC_5', location_name: '店5', total_amount: 60, new_customer_count: 1 },
        { location_id: 'LOC_6', location_name: '店6', total_amount: 50, new_customer_count: 1 },
        { location_id: 'LOC_7', location_name: '店7', total_amount: 40, new_customer_count: 1 },
      ],
      meta: {},
    };
    const { rows } = normalizeByLocation(raw);
    const colors = rows.map((r) => r.color);
    // 7 店すべて相異なる色（衝突回避が効いている）。
    expect(new Set(colors).size).toBe(colors.length);
    // 2026-07-21 D3: マージ関数内の colorMap と純関数 getLocationColors(sorted names) の割当が一致する。
    const names = [...raw.byLocation.map((r) => r.location_name)].sort();
    const map = getLocationColors(names);
    rows.forEach((r) => expect(r.color).toBe(map[r.locationName]));
  });

  it('B18: 数値文字列 / null / Infinity の total_amount でも有限数（NaN/文字列連結なし）', () => {
    const raw = {
      byLocation: [
        {
          location_id: 'LOC_S',
          location_name: 'S',
          // 数値文字列・null・Infinity が混入しても toFiniteNumber で有限数 0 補完。
          total_amount: '1000' as unknown as number,
          open_total_amount: null as unknown as number,
          new_customer_count: '4' as unknown as number,
          repeat_customer_count: Infinity as unknown as number,
          regular_customer_count: 1,
          staff_customer_count: 2,
        },
      ],
    };
    const { rows } = normalizeByLocation(raw);
    // '1000' は文字列連結せず 1000、null は 0 → 1000。
    expect(rows[0].totalSales).toBe(1000);
    expect(Number.isFinite(rows[0].totalSales)).toBe(true);
    // '4'→4, Infinity→0, 1, 2 = 7。
    expect(rows[0].totalCustomers).toBe(7);
    expect(Number.isFinite(rows[0].totalCustomers)).toBe(true);
  });

  it('RPC の total_amount DESC 並びを尊重し再ソートしない', () => {
    const raw = {
      byLocation: [
        { location_id: 'LOC_BIG', location_name: '大', total_amount: 9000, new_customer_count: 1 },
        { location_id: 'LOC_SMALL', location_name: '小', total_amount: 100, new_customer_count: 1 },
      ],
      meta: {},
    };
    const { rows } = normalizeByLocation(raw);
    expect(rows.map((r) => r.locationId)).toEqual(['LOC_BIG', 'LOC_SMALL']);
  });

  it('staff スコープ等で byLocation が空（meta.empty=true）→ rows=[]（fail-closed 同等）', () => {
    const raw = {
      byLocation: [],
      meta: { source: 'aggregate', location_ids: [], use_aggregate: true, empty: true },
    };
    const { rows, meta } = normalizeByLocation(raw);
    expect(rows).toEqual([]);
    expect(meta.location_ids).toEqual([]);
  });

  it('不正入力（null / byLocation 非配列）でも throw せず rows=[]', () => {
    expect(normalizeByLocation(null).rows).toEqual([]);
    expect(normalizeByLocation({ byLocation: 'oops' }).rows).toEqual([]);
    expect(normalizeByLocation(undefined).rows).toEqual([]);
  });

  it('セグメント欠落フィールドは 0 補完（open_total_amount 省略時は total_amount のみ）', () => {
    const raw = {
      byLocation: [
        { location_id: 'LOC_X', location_name: 'X', total_amount: 500, new_customer_count: 4 },
      ],
    };
    const { rows } = normalizeByLocation(raw);
    expect(rows[0].totalSales).toBe(500); // open_total_amount 省略 → 0
    expect(rows[0].totalCustomers).toBe(4); // repeat/regular/staff 省略 → 0
  });

  it('2026-07-21 D-01: 同名 2 location_id 行は location_name マージで 1 行に合算される', () => {
    const raw = {
      byLocation: [
        {
          location_id: 'OLD_SOUQ',
          location_name: '吸暮',
          total_amount: 1000,
          open_total_amount: 0,
          new_customer_count: 5,
        },
        {
          location_id: 'NEW_SOUQ',
          location_name: '吸暮',
          total_amount: 500,
          open_total_amount: 0,
          new_customer_count: 3,
        },
      ],
    };
    const { rows } = normalizeByLocation(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0].locationName).toBe('吸暮');
    // 代表 locationId = 初出行(OLD_SOUQ)。
    expect(rows[0].locationId).toBe('OLD_SOUQ');
    expect(rows[0].totalSales).toBe(1500);
    expect(rows[0].totalCustomers).toBe(8);
  });

  it('meta は欠落フィールドを既定値で補う', () => {
    const { meta } = normalizeByLocation({ byLocation: [], meta: { source: 'aggregate' } });
    expect(meta.source).toBe('aggregate');
    expect(meta.location_ids).toEqual([]);
    expect(meta.use_aggregate).toBe(true);
  });
});
