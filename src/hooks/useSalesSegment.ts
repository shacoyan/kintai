import { useMemo } from 'react';
import { useSalesRange } from './useSalesRange';
import {
  buildSegmentAnalysisFromSalesRange,
  type SalesRangeMeta,
  type SalesRangeResponse,
} from '../lib/sales/salesRangeAdapter';
import type { CustomerSegmentAnalysis, PeriodPreset } from '../lib/sales/types';

// =============================================================================
// useSalesSegment — RPC 駆動の集約 hook（Loop2 / 設計書 §4.1 + 追補E）
// -----------------------------------------------------------------------------
// 在庫の `useSalesRange`（RPC=`get_sales_range_scoped`・`withSquareSession`
// fail-closed）と在庫の `buildSegmentAnalysisFromSalesRange`（byDate →
// `CustomerSegmentAnalysis` 変換。客数=新規+リピート+常連+スタッフの 4 セグ合計
// （記載なし=unlisted は内訳/グラフには保持するが、客数 headline・客単価分母から
// は除外＝salesRangeAdapter.ts で 4 セグ合計に統一）・二重計上回避・daily trend を
// granularity 集約）を繋ぐ薄い hook。
//
// 追補E（設計書 L574）: dates(from/to) は SalesPage 側で
// `calculatePeriodDates` を一度算出し、`useSalesSegment` / `useSalesYoY` /
// `useSalesByLocation` の 3 hook に共有する（二重計算・期間ズレ防止）。よって
// 本 hook は dates を内部算出せず **from/to を受領** し、from..to を内部で日付列挙
// して adapter に渡す。period/baseDate は trend 集約の granularity・ラベル用。
//
// 設計判断:
//   - 本 hook は新規ロジックを持たない（集計本体は adapter・RPC が担保）。
//     → テスト容易・回帰面積最小。
//   - YoY は Loop2 無効。`enableYoy` 引数は持たせない（YoY は別 hook
//     `useSalesYoY` = Engineer C）。
//   - error 時 / セッション無は fail-closed（useSalesRange が EMPTY_RESPONSE を
//     返す）。本 hook は error があれば `data=null` を返し空表示に倒す。
// =============================================================================

export interface UseSalesSegmentArgs {
  /** 開始日 YYYY-MM-DD（営業日基準）。SalesPage が dates[0] を渡す。 */
  from: string;
  /** 終了日 YYYY-MM-DD（営業日基準）。SalesPage が dates.at(-1) を渡す。 */
  to: string;
  /** 期間プリセット（trend 集約の granularity・ラベル用）。 */
  period: PeriodPreset;
  /** 基準日 YYYY-MM-DD（getBusinessDate(11)）。elapsedDays 算出に使用。 */
  baseDate: string;
  /**
   * 閲覧対象の Square location_name 配列。
   * `null` = ALL（許可全店合算）。RPC には p_location_names=null で渡る。
   */
  locationNames: string[] | null;
  /** false のときフェッチをスキップ（スコープ確定前など）。省略時 true。 */
  enabled?: boolean;
}

export interface UseSalesSegmentResult {
  data: CustomerSegmentAnalysis | null;
  meta: SalesRangeMeta | null;
  loading: boolean;
  error: string | null;
}

/**
 * from..to（両端含む）の日付列を YYYY-MM-DD で列挙する。
 * byDate に存在しない日は adapter 側で `continue` されるため、欠損日があっても
 * 安全（elapsedDays は baseDate 基準で adapter が別途算出）。
 *
 * export しているのはテスト（純関数検証）と再利用のため。
 */
export function enumerateDates(from: string, to: string): string[] {
  if (!from || !to || from > to) return [];
  const dates: string[] = [];
  // UTC 固定でパースし日付のみを進める（タイムゾーン依存の日跨ぎを避ける）。
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  for (let d = start; d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * resp + error から `CustomerSegmentAnalysis | null` を導出する純関数。
 * React 非依存。テスト（観点 a/d）と hook 本体の useMemo から共有する。
 *
 *   - error 時は fail-closed で null（useSalesRange は error 時も EMPTY_RESPONSE
 *     を data にセットするため、ここで明示的に null 化して空表示に倒す）。
 *   - resp 無し（フェッチ前）も null。
 *   - それ以外は adapter（在庫）で byDate → CustomerSegmentAnalysis に変換。
 */
export function computeSalesSegment(input: {
  resp: SalesRangeResponse | null;
  error: string | null;
  dates: string[];
  period: PeriodPreset;
  baseDate: string;
}): CustomerSegmentAnalysis | null {
  const { resp, error, dates, period, baseDate } = input;
  if (error) return null;
  if (!resp) return null;
  return buildSegmentAnalysisFromSalesRange({
    byDate: resp.byDate,
    dates,
    period,
    baseDate,
  });
}

export function useSalesSegment(args: UseSalesSegmentArgs): UseSalesSegmentResult {
  const { from, to, period, baseDate, locationNames, enabled = true } = args;

  const { data: resp, loading, error } = useSalesRange({
    from,
    to,
    locationNames,
    enabled,
  });

  const dates = useMemo(() => enumerateDates(from, to), [from, to]);

  const data = useMemo<CustomerSegmentAnalysis | null>(
    () => computeSalesSegment({ resp, error, dates, period, baseDate }),
    [resp, error, dates, period, baseDate],
  );

  return {
    data,
    meta: resp?.meta ?? null,
    loading,
    error,
  };
}
