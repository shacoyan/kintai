export interface Discount {
  name: string;
  amount: number;
}

export interface Location {
  id: string;
  name: string;
  /** 営業日の日付変更線(JST hour 0-23)。/api/locations 由来。未指定時は当面10。 */
  business_day_start_hour?: number;
}

export interface LineItem {
  name: string;
  quantity: string;
  amount: number;
  category?: string | null;
}

export interface Transaction {
  id: string;
  customer_name: string | null;
  created_at_jst: string;
  order_created_at_jst?: string | null;
  amount: number;
  status: string;
  source: string;
  line_items: LineItem[];
  discounts: Discount[];
}

export interface OpenOrder {
  id: string;
  created_at: string | null;
  total_money: number;
  customer_name: string | null;
  line_items: LineItem[];
  discounts: Discount[];
}

export interface SalesData {
  total_amount: number;
  transaction_count: number;
  currency: string;
}

export type CustomerSegment = 'new' | 'repeat' | 'regular' | 'staff' | 'unlisted';
export type AcquisitionChannel = 'google' | 'review' | 'signboard' | 'sns' | 'unknown'; // 'review' は「口コミ」（旧表記「クチコミ」）の内部キー。UI 表示は「口コミ」で統一。

export interface SegmentBreakdown {
  new: number;
  repeat: number;
  regular: number;
  staff: number;
  unlisted: number;
}

export interface AcquisitionBreakdown {
  google: number;
  review: number; // 「口コミ」の内部キー。UIでは「口コミ」表記。
  signboard: number;
  sns: number;
  unknown: number; // 打ち漏れ
}

export interface DailySegmentPoint {
  date: string; // YYYY-MM-DD (JST)
  // 人数
  new: number;
  repeat: number;
  regular: number;
  staff: number;
  unlisted: number;
  // 売上（Round 14 追加）
  newSales: number;
  repeatSales: number;
  regularSales: number;
  staffSales: number;
  unlistedSales: number;
}

export type PeriodPreset = 'today' | 'week' | 'month' | 'quarter' | 'year';

export interface CustomerSegmentAnalysis {
  period: PeriodPreset;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD
  elapsedDays: number;
  totalSales: number;
  totalCustomers: number;
  averageDailySales: number | null; // today のとき null
  overallAveragePerCustomer: number | null;
  customersBySegment: SegmentBreakdown;
  salesBySegment: SegmentBreakdown;
  acquisitionBreakdown: AcquisitionBreakdown; // 新規客のみ
  dailyTrend: DailySegmentPoint[];
  rawDailyTrend: DailySegmentPoint[];
}

// 全店舗比較 — 店舗 1 行分の集計
export interface LocationSegmentRow {
  locationId: string;
  locationName: string;
  totalSales: number;
  averageDailySales: number | null;
  overallAveragePerCustomer: number | null;
  totalCustomers: number;
  customersBySegment: SegmentBreakdown;
  salesBySegment: SegmentBreakdown;
  acquisitionBreakdown: AcquisitionBreakdown;
  dailyTrend: DailySegmentPoint[];
  rawDailyTrend: DailySegmentPoint[];
  loadError: string | null;
  partialFailure: { failedDays: number; totalDays: number } | null;
  // 時間帯別混雑分析（2026-05-05）: 同時滞在組数算出のため raw transactions を露出
  transactions: Transaction[];
}

// 全店舗比較 — セクション全体のデータ
export interface LocationComparisonData {
  period: PeriodPreset;
  periodStart: string;
  periodEnd: string;
  elapsedDays: number;
  rows: LocationSegmentRow[];
  totals: Omit<LocationSegmentRow, 'locationId' | 'locationName' | 'loadError' | 'partialFailure' | 'transactions'>;
  allDates: string[];
}
