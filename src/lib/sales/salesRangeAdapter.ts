import type {
  CustomerSegmentAnalysis,
  DailySegmentPoint,
  SegmentBreakdown,
  PeriodPreset,
  AcquisitionBreakdown,
} from './types';
import { aggregateTrendByGranularity, granularityFor } from './trendAggregation';

/**
 * 任意値を有限数に正規化する (B18 NaN 伝播ガード)。
 *
 * `Number(v)` が有限数なら採用、それ以外 (NaN/Infinity/-Infinity/数値化不能な
 * 文字列/null/undefined/object) は 0 に倒す。
 *
 * RPC が数値文字列 `"123"` や `null` を返しても、下流の加算で
 * 文字列連結 (`"123"+"45"="12345"`) や `null+x=NaN` が伝播しないようにする
 * 最小ヘルパ。`normalizeResponse`(useSalesRange) / `normalizeByLocation`
 * (useSalesByLocation) / `aggregateSalesRangeTotals`(yoy) から import される。
 *
 * @param v 任意の値 (number | string | null | undefined | unknown)
 * @returns 有限数。正規化できない場合は 0。
 */
export function toFiniteNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * /api/sales-range の byDate[date] エントリ。
 * flat fields 採用、segments nested は使わない (設計書 §5)。
 */
export interface SalesRangeDay {
  total_amount: number;
  transaction_count: number;
  customer_count: number;
  new_customer_count: number;
  repeat_customer_count: number;
  regular_customer_count: number;
  staff_customer_count: number;
  unlisted_customer_count: number;
  new_sales: number;
  repeat_sales: number;
  regular_sales: number;
  staff_sales: number;
  unlisted_sales: number;
  open_total_amount: number;
  open_order_count: number;
  categories?: Array<{
    category_id: string | null;
    category_name: string;
    sales: number;
    item_count: number;
  }>;
  segments?: {
    customers: SegmentBreakdown;
    sales: SegmentBreakdown;
  };
}

export interface SalesRangeMeta {
  source: 'live' | 'aggregate' | 'hybrid' | 'empty';
  location_ids: string[];
  live_dates: string[];
  aggregate_dates: string[];
  future_dates: string[];
  use_aggregate: boolean;
  missing_combinations?: Array<{ business_date: string; location_id: string }>;
  partial_failures?: Array<{ business_date: string; location_id: string; error: string }>;
  warnings?: string[];
  live_window_days?: number;
  empty?: boolean;
}

export interface SalesRangeResponse {
  byDate: Record<string, SalesRangeDay>;
  meta: SalesRangeMeta;
}

/**
 * /api/sales-range を呼び出して SalesRangeResponse を返す。
 *
 * - token があれば Authorization: Bearer を付与する
 * - 4xx/5xx は throw する (呼び出し側で fallback / detailError 表示する)
 */
export async function fetchSalesRange(args: {
  start_date: string;
  end_date: string;
  location_id: string;
  start_hour?: number | string;
  token?: string;
  signal?: AbortSignal;
}): Promise<SalesRangeResponse> {
  const params = new URLSearchParams({
    start_date: args.start_date,
    end_date: args.end_date,
    location_id: args.location_id,
  });

  if (args.start_hour !== undefined) {
    params.set('start_hour', String(args.start_hour));
  }

  const headers: Record<string, string> = {};
  if (args.token) {
    headers['Authorization'] = `Bearer ${args.token}`;
  }

  const res = await fetch(`/api/sales-range?${params.toString()}`, {
    method: 'GET',
    headers,
    signal: args.signal,
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`sales-range fetch failed: ${res.status} ${msg}`);
  }

  return (await res.json()) as SalesRangeResponse;
}

/**
 * sales-range の byDate を CustomerSegmentAnalysis に変換。
 *
 * flat fields 採用、segments nested は使わない (設計書 §5)。
 * acquisitionBreakdown は呼び出し側で別途与える (短期間時のみ)。
 * 長期間時は zeros (default)。
 *
 * total = total_amount + open_total_amount (UX 互換: 既存 useCustomerSegment は
 * 「決済済 + 未決済」を allTransactions として合算していたため)。
 */
export function buildSegmentAnalysisFromSalesRange(args: {
  byDate: Record<string, SalesRangeDay>;
  dates: string[];
  period: PeriodPreset;
  baseDate: string;
  acquisitionBreakdown?: AcquisitionBreakdown;
}): CustomerSegmentAnalysis {
  const { byDate, dates, period, baseDate } = args;
  const acquisitionBreakdown: AcquisitionBreakdown = args.acquisitionBreakdown ?? {
    google: 0,
    review: 0,
    signboard: 0,
    sns: 0,
    unknown: 0,
  };

  let totalSales = 0;
  let totalCustomers = 0;

  const customersBySegment: SegmentBreakdown = {
    new: 0,
    repeat: 0,
    regular: 0,
    staff: 0,
    unlisted: 0,
  };

  const salesBySegment: SegmentBreakdown = {
    new: 0,
    repeat: 0,
    regular: 0,
    staff: 0,
    unlisted: 0,
  };

  const dailyTrend: DailySegmentPoint[] = [];

  for (const date of dates) {
    const day = byDate[date];
    if (!day) continue;

    // RPC が null を返しても NaN 化しないよう全数値フィールドを toFiniteNumber 経由で正規化（B18）。
    const totalAmount = toFiniteNumber(day.total_amount);
    const openTotalAmount = toFiniteNumber(day.open_total_amount);
    const newCustomerCount = toFiniteNumber(day.new_customer_count);
    const repeatCustomerCount = toFiniteNumber(day.repeat_customer_count);
    const regularCustomerCount = toFiniteNumber(day.regular_customer_count);
    const staffCustomerCount = toFiniteNumber(day.staff_customer_count);
    const unlistedCustomerCount = toFiniteNumber(day.unlisted_customer_count);
    const newSales = toFiniteNumber(day.new_sales);
    const repeatSales = toFiniteNumber(day.repeat_sales);
    const regularSales = toFiniteNumber(day.regular_sales);
    const staffSales = toFiniteNumber(day.staff_sales);
    const unlistedSales = toFiniteNumber(day.unlisted_sales);

    const daySales = totalAmount + openTotalAmount;
    totalSales += daySales;

    // dayCustomers から unlisted を除外（4 セグ合計に統一）。
    // 客数 headline・客単価分母は new+repeat+regular+staff のみ。
    // customersBySegment.unlisted（内訳）・dailyTrend.unlisted（グラフ）は従来どおり保持する。
    const dayCustomers =
      newCustomerCount + repeatCustomerCount + regularCustomerCount + staffCustomerCount;
    totalCustomers += dayCustomers;

    customersBySegment.new += newCustomerCount;
    customersBySegment.repeat += repeatCustomerCount;
    customersBySegment.regular += regularCustomerCount;
    customersBySegment.staff += staffCustomerCount;
    customersBySegment.unlisted += unlistedCustomerCount;

    salesBySegment.new += newSales;
    salesBySegment.repeat += repeatSales;
    salesBySegment.regular += regularSales;
    salesBySegment.staff += staffSales;
    salesBySegment.unlisted += unlistedSales;

    dailyTrend.push({
      date,
      new: newCustomerCount,
      repeat: repeatCustomerCount,
      regular: regularCustomerCount,
      staff: staffCustomerCount,
      unlisted: unlistedCustomerCount,
      newSales,
      repeatSales,
      regularSales,
      staffSales,
      unlistedSales,
    });
  }

  const elapsedDays = dates.length;
  const averageDailySales: number | null =
    period === 'today' ? totalSales : elapsedDays > 0 ? totalSales / elapsedDays : null;

  const overallAveragePerCustomer: number | null =
    totalCustomers > 0 ? totalSales / totalCustomers : null;

  const sortedDailyTrend = dailyTrend.slice().sort((a, b) => a.date.localeCompare(b.date));
  const aggregatedTrend = aggregateTrendByGranularity(sortedDailyTrend, granularityFor(period));

  return {
    period,
    periodStart: dates[0] ?? baseDate,
    periodEnd: dates[dates.length - 1] ?? baseDate,
    elapsedDays,
    totalSales,
    totalCustomers,
    averageDailySales,
    overallAveragePerCustomer,
    customersBySegment,
    salesBySegment,
    acquisitionBreakdown,
    dailyTrend: aggregatedTrend,
    rawDailyTrend: sortedDailyTrend,
  };
}

/**
 * SalesRangeResponse を CustomerSegmentAnalysis に変換するラッパー。
 * 呼び出し側で fetch 結果を受け取ったあと、既存 hook 互換形式に整える。
 */
export function adaptToLegacyMetrics(
  salesRangeResponse: SalesRangeResponse,
  args: {
    dates: string[];
    period: PeriodPreset;
    baseDate: string;
    acquisitionBreakdown?: AcquisitionBreakdown;
  }
): CustomerSegmentAnalysis {
  return buildSegmentAnalysisFromSalesRange({
    byDate: salesRangeResponse.byDate,
    dates: args.dates,
    period: args.period,
    baseDate: args.baseDate,
    acquisitionBreakdown: args.acquisitionBreakdown,
  });
}

/**
 * flat fields → DailySegmentPoint 変換。
 * multi-location 集計で各店舗 row の dailyTrend を組み立てる際に共通利用する
 * (設計書 §6.3.2)。
 */
export function dayMetricsToTrendPoint(date: string, day: SalesRangeDay): DailySegmentPoint {
  return {
    date,
    new: day.new_customer_count,
    repeat: day.repeat_customer_count,
    regular: day.regular_customer_count,
    staff: day.staff_customer_count,
    unlisted: day.unlisted_customer_count,
    newSales: day.new_sales,
    repeatSales: day.repeat_sales,
    regularSales: day.regular_sales,
    staffSales: day.staff_sales,
    unlistedSales: day.unlisted_sales,
  };
}
