// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// useSalesRange をモックして RPC レイヤを切り離す（hook の結線のみを検証）。
const useSalesRangeMock = vi.fn();
vi.mock('./useSalesRange', () => ({
  useSalesRange: (args: unknown) => useSalesRangeMock(args),
}));

import {
  useSalesSegment,
  computeSalesSegment,
  enumerateDates,
} from './useSalesSegment';
import { buildSegmentAnalysisFromSalesRange } from '../lib/sales/salesRangeAdapter';
import type {
  SalesRangeDay,
  SalesRangeResponse,
} from '../lib/sales/salesRangeAdapter';

function makeDay(overrides: Partial<SalesRangeDay> = {}): SalesRangeDay {
  return {
    total_amount: 10000,
    open_total_amount: 500,
    transaction_count: 10,
    customer_count: 7,
    new_customer_count: 2,
    repeat_customer_count: 3,
    regular_customer_count: 1,
    staff_customer_count: 0,
    unlisted_customer_count: 1,
    new_sales: 2000,
    repeat_sales: 4000,
    regular_sales: 3000,
    staff_sales: 0,
    unlisted_sales: 1000,
    open_order_count: 1,
    ...overrides,
  };
}

function makeResponse(
  byDate: Record<string, SalesRangeDay>,
): SalesRangeResponse {
  return {
    byDate,
    meta: {
      source: 'aggregate',
      location_ids: ['loc-1'],
      live_dates: [],
      aggregate_dates: Object.keys(byDate),
      future_dates: [],
      use_aggregate: true,
    },
  };
}

beforeEach(() => {
  useSalesRangeMock.mockReset();
});

describe('enumerateDates', () => {
  it('from..to を両端含めて列挙する', () => {
    expect(enumerateDates('2026-05-01', '2026-05-03')).toEqual([
      '2026-05-01',
      '2026-05-02',
      '2026-05-03',
    ]);
  });

  it('単日は 1 要素', () => {
    expect(enumerateDates('2026-05-01', '2026-05-01')).toEqual(['2026-05-01']);
  });

  it('from > to / 空文字は空配列（不正入力で例外を投げない）', () => {
    expect(enumerateDates('2026-05-03', '2026-05-01')).toEqual([]);
    expect(enumerateDates('', '2026-05-01')).toEqual([]);
    expect(enumerateDates('2026-05-01', '')).toEqual([]);
  });

  it('月跨ぎでも UTC 基準で正しく列挙（日跨ぎ TZ バグ無し）', () => {
    expect(enumerateDates('2026-04-30', '2026-05-02')).toEqual([
      '2026-04-30',
      '2026-05-01',
      '2026-05-02',
    ]);
  });
});

describe('computeSalesSegment（観点 a/d）', () => {
  const dates = ['2026-05-01', '2026-05-02'];
  const period = 'week' as const;
  const baseDate = '2026-05-02';
  const byDate = {
    '2026-05-01': makeDay({ total_amount: 120000, new_customer_count: 5 }),
    '2026-05-02': makeDay({ total_amount: 80000, repeat_customer_count: 4 }),
  };

  it('(a) byDate → CustomerSegmentAnalysis 変換が adapter 出力と一致', () => {
    const resp = makeResponse(byDate);
    const got = computeSalesSegment({ resp, error: null, dates, period, baseDate });
    const expected = buildSegmentAnalysisFromSalesRange({
      byDate,
      dates,
      period,
      baseDate,
    });
    expect(got).toEqual(expected);
  });

  it('(d) error 時は data=null（fail-closed・EMPTY_RESPONSE が来ても null 化）', () => {
    const resp = makeResponse({}); // useSalesRange は error 時 EMPTY_RESPONSE を返す
    const got = computeSalesSegment({
      resp,
      error: 'RPC failed',
      dates,
      period,
      baseDate,
    });
    expect(got).toBeNull();
  });

  it('resp 無し（フェッチ前）も null', () => {
    const got = computeSalesSegment({
      resp: null,
      error: null,
      dates,
      period,
      baseDate,
    });
    expect(got).toBeNull();
  });
});

describe('useSalesSegment（観点 b/c・RPC 引数の素通し）', () => {
  const base = {
    from: '2026-05-01',
    to: '2026-05-07',
    period: 'week' as const,
    baseDate: '2026-05-07',
  };

  it('(b) locationNames=null（ALL）が useSalesRange へそのまま渡る', () => {
    useSalesRangeMock.mockReturnValue({
      data: makeResponse({}),
      loading: false,
      error: null,
    });
    renderHook(() =>
      useSalesSegment({ ...base, locationNames: null, enabled: true }),
    );
    expect(useSalesRangeMock).toHaveBeenCalledWith({
      from: '2026-05-01',
      to: '2026-05-07',
      locationNames: null,
      enabled: true,
    });
  });

  it('(b) 単店 locationNames が useSalesRange へそのまま渡る', () => {
    useSalesRangeMock.mockReturnValue({
      data: makeResponse({}),
      loading: false,
      error: null,
    });
    renderHook(() =>
      useSalesSegment({ ...base, locationNames: ['souq'], enabled: true }),
    );
    expect(useSalesRangeMock).toHaveBeenCalledWith({
      from: '2026-05-01',
      to: '2026-05-07',
      locationNames: ['souq'],
      enabled: true,
    });
  });

  it('(c) enabled=false が useSalesRange へ伝播（フェッチ抑止は useSalesRange 側で担保）', () => {
    useSalesRangeMock.mockReturnValue({
      data: null,
      loading: false,
      error: null,
    });
    const { result } = renderHook(() =>
      useSalesSegment({ ...base, locationNames: null, enabled: false }),
    );
    expect(useSalesRangeMock).toHaveBeenCalledWith({
      from: '2026-05-01',
      to: '2026-05-07',
      locationNames: null,
      enabled: false,
    });
    // フェッチ前相当（data=null）→ analysis は null
    expect(result.current.data).toBeNull();
  });

  it('正常応答で data に CustomerSegmentAnalysis、meta を透過、loading/error を中継', () => {
    const byDate = {
      '2026-05-01': makeDay({ total_amount: 120000 }),
    };
    useSalesRangeMock.mockReturnValue({
      data: makeResponse(byDate),
      loading: false,
      error: null,
    });
    const { result } = renderHook(() =>
      useSalesSegment({
        from: '2026-05-01',
        to: '2026-05-01',
        period: 'week',
        baseDate: '2026-05-01',
        locationNames: null,
        enabled: true,
      }),
    );
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.meta?.location_ids).toEqual(['loc-1']);
    expect(result.current.data).not.toBeNull();
    expect(result.current.data?.totalSales).toBeGreaterThan(0);
  });

  it('error 時 data=null・meta は透過（useSalesRange の EMPTY を中継）', () => {
    useSalesRangeMock.mockReturnValue({
      data: makeResponse({}),
      loading: false,
      error: 'boom',
    });
    const { result } = renderHook(() =>
      useSalesSegment({
        from: '2026-05-01',
        to: '2026-05-07',
        period: 'week',
        baseDate: '2026-05-07',
        locationNames: null,
        enabled: true,
      }),
    );
    expect(result.current.error).toBe('boom');
    expect(result.current.data).toBeNull();
  });
});
