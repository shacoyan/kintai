import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildSegmentAnalysisFromSalesRange,
  adaptToLegacyMetrics,
  dayMetricsToTrendPoint,
  fetchSalesRange,
} from './salesRangeAdapter';
import type { SalesRangeDay, SalesRangeResponse, SalesRangeMeta } from './salesRangeAdapter';

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

describe('salesRangeAdapter', () => {
  const fixture5: Record<string, SalesRangeDay> = {
    '2026-04-01': makeDay(),
    '2026-04-02': makeDay(),
    '2026-04-03': makeDay(),
    '2026-04-04': makeDay(),
    '2026-04-05': makeDay(),
  };
  const dates5 = ['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05'];

  it('buildSegmentAnalysisFromSalesRange — 5 日 fixture の flat fields を正しく集計する', () => {
    const result = buildSegmentAnalysisFromSalesRange({
      byDate: fixture5,
      dates: dates5,
      period: 'week',
      baseDate: '2026-04-05',
    });

    expect(result.totalSales).toBe(52500);
    expect(result.totalCustomers).toBe(30);
    expect(result.customersBySegment.new).toBe(10);
    expect(result.customersBySegment.repeat).toBe(15);
    expect(result.customersBySegment.regular).toBe(5);
    expect(result.customersBySegment.staff).toBe(0);
    expect(result.customersBySegment.unlisted).toBe(5);
    expect(result.salesBySegment.new).toBe(10000);
    expect(result.salesBySegment.repeat).toBe(20000);
    expect(result.salesBySegment.regular).toBe(15000);
    expect(result.salesBySegment.staff).toBe(0);
    expect(result.salesBySegment.unlisted).toBe(5000);
    expect(result.averageDailySales).toBe(10500);
    expect(result.overallAveragePerCustomer).toBe(1750);
    expect(result.period).toBe('week');
    expect(result.elapsedDays).toBe(5);
    expect(result.periodStart).toBe('2026-04-01');
    expect(result.periodEnd).toBe('2026-04-05');
    expect(result.acquisitionBreakdown).toEqual({
      google: 0,
      review: 0,
      signboard: 0,
      sns: 0,
      unknown: 0,
    });
    expect(Array.isArray(result.dailyTrend)).toBe(true);
    // week → granularity 'daily' で 5 日分のまま
    expect(result.dailyTrend.length).toBeGreaterThan(0);
  });

  it('acquisitionBreakdown 引数で上書き可能', () => {
    const result = buildSegmentAnalysisFromSalesRange({
      byDate: fixture5,
      dates: dates5,
      period: 'week',
      baseDate: '2026-04-05',
      acquisitionBreakdown: { google: 5, review: 2, signboard: 1, sns: 3, unknown: 0 },
    });

    expect(result.acquisitionBreakdown.google).toBe(5);
    expect(result.acquisitionBreakdown.review).toBe(2);
    expect(result.acquisitionBreakdown.signboard).toBe(1);
    expect(result.acquisitionBreakdown.sns).toBe(3);
    expect(result.acquisitionBreakdown.unknown).toBe(0);
  });

  it('byDate に存在しない date は集計から skip される', () => {
    const result = buildSegmentAnalysisFromSalesRange({
      byDate: { '2026-04-01': makeDay() },
      dates: ['2026-04-01', '2026-04-99'],
      period: 'week',
      baseDate: '2026-04-01',
    });

    expect(result.elapsedDays).toBe(2);
    expect(result.totalSales).toBe(10500);
  });

  it("period='today' のとき averageDailySales === totalSales", () => {
    const result = buildSegmentAnalysisFromSalesRange({
      byDate: { '2026-04-01': makeDay() },
      dates: ['2026-04-01'],
      period: 'today',
      baseDate: '2026-04-01',
    });

    expect(result.totalSales).toBe(10500);
    expect(result.averageDailySales).toBe(10500);
  });

  it('dates が空配列のとき null / baseDate にフォールバック', () => {
    const result = buildSegmentAnalysisFromSalesRange({
      byDate: {},
      dates: [],
      period: 'week',
      baseDate: '2026-04-05',
    });

    expect(result.totalSales).toBe(0);
    expect(result.averageDailySales).toBeNull();
    expect(result.overallAveragePerCustomer).toBeNull();
    expect(result.periodStart).toBe('2026-04-05');
    expect(result.periodEnd).toBe('2026-04-05');
  });

  it('dayMetricsToTrendPoint — flat fields を DailySegmentPoint に変換する', () => {
    const day = makeDay();
    const point = dayMetricsToTrendPoint('2026-04-01', day);

    expect(point.date).toBe('2026-04-01');
    expect(point.new).toBe(2);
    expect(point.repeat).toBe(3);
    expect(point.regular).toBe(1);
    expect(point.staff).toBe(0);
    expect(point.unlisted).toBe(1);
    expect(point.newSales).toBe(2000);
    expect(point.repeatSales).toBe(4000);
    expect(point.regularSales).toBe(3000);
    expect(point.staffSales).toBe(0);
    expect(point.unlistedSales).toBe(1000);
  });

  it('adaptToLegacyMetrics — SalesRangeResponse をラップして同じ結果を返す', () => {
    const meta: SalesRangeMeta = {
      source: 'live',
      location_ids: ['L1'],
      live_dates: dates5,
      aggregate_dates: [],
      future_dates: [],
      use_aggregate: true,
    };
    const response: SalesRangeResponse = { byDate: fixture5, meta };
    const result = adaptToLegacyMetrics(response, {
      dates: dates5,
      period: 'week',
      baseDate: '2026-04-05',
    });

    expect(result.totalSales).toBe(52500);
    expect(result.elapsedDays).toBe(5);
  });

  describe('fetchSalesRange', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            byDate: {},
            meta: {
              source: 'empty',
              location_ids: [],
              live_dates: [],
              aggregate_dates: [],
              future_dates: [],
              use_aggregate: true,
            },
          }),
        }),
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('start_date / end_date / location_id / start_hour で URL を組み立てる', async () => {
      await fetchSalesRange({
        start_date: '2026-04-01',
        end_date: '2026-04-05',
        location_id: 'L1',
        start_hour: 13,
      });

      const mockFetch = vi.mocked(fetch);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe(
        '/api/sales-range?start_date=2026-04-01&end_date=2026-04-05&location_id=L1&start_hour=13',
      );
    });

    it('token があれば Authorization: Bearer を付与する', async () => {
      await fetchSalesRange({
        start_date: '2026-04-01',
        end_date: '2026-04-05',
        location_id: 'L1',
        start_hour: 13,
        token: 't0k',
      });

      const mockFetch = vi.mocked(fetch);
      const [, init] = mockFetch.mock.calls[0]!;
      const headers = (init as RequestInit | undefined)?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer t0k');
    });

    it('!res.ok のとき throw する', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: async () => '{"error":"period_too_long"}',
        }),
      );

      await expect(
        fetchSalesRange({
          start_date: '2026-04-01',
          end_date: '2026-04-05',
          location_id: 'L1',
          start_hour: 13,
        }),
      ).rejects.toThrow(/sales-range fetch failed: 400/);
    });
  });
});
