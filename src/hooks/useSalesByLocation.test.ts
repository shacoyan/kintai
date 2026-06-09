import { describe, it, expect } from 'vitest';
import { normalizeByLocation } from './useSalesByLocation';
import { getLocationColor } from '../lib/sales/locationColors';

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
    // 色は location_id 由来で安定。
    expect(rows[0].color).toBe(getLocationColor('LOC_A'));
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

  it('meta は欠落フィールドを既定値で補う', () => {
    const { meta } = normalizeByLocation({ byLocation: [], meta: { source: 'aggregate' } });
    expect(meta.source).toBe('aggregate');
    expect(meta.location_ids).toEqual([]);
    expect(meta.use_aggregate).toBe(true);
  });
});
