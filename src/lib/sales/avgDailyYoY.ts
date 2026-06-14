import { calculateYoY } from './yoy';
import type { YoYDelta, SalesRangeYoYResult } from './yoy';

// =============================================================================
// avgDailyYoY — 1日平均売上の YoY（カード表示値と同一基準 = open 込み + 母数統一）
// -----------------------------------------------------------------------------
// 監査 item avgdaily-yoy-paid-only-vs-card-open-included の修正 + round2 blocking
// （母数統一の核心要件）対応。
//
// ■ 分子（open 込み）— round1 で対応済
//   旧実装は byDate[].current/lastYear.total_amount（決済済のみ・open 抜き）で日平均を
//   取っていたため、カード値 averageDailySales（= Σ(total_amount + open_total_amount) /
//   日数 = open 込み）と分子が不一致だった。当年/前年とも open 込み全期間合計に統一する。
//
// ■ 分母（母数統一）— round2 blocking 対応の核心
//   カード averageDailySales（salesRangeAdapter.ts）の分母は
//     elapsedDays = dates.length = enumerateDates(from,to).length
//   = from..to の「連続全カレンダー日数」（休業日・売上ゼロ日・データ未投入日も含む）。
//   一方 RPC 070（GROUP BY business_date + jsonb_object_agg、generate_series 無し）は
//   「実売上のある日」しか byDate に返さないため、`yoy.byDate.length`（= currentRes.byDate
//   のキー数）は欠損日があるとカードの分母より小さくなり、両者が乖離する。
//   よって round1 の `curDays = yoy.byDate.length` は誤り（コメントの「byDate.length =
//   elapsedDays」という前提は RPC が全日を埋めない事実に反する）。
//
//   修正: 当年分母を **連続全カレンダー日数** = inclusiveDaySpan(period.start, period.end)
//   に揃える。これは enumerateDates(from,to).length と同一値であり（同じ UTC 両端含む
//   列挙）、カードの elapsedDays とビット一致する。period.{start,end} は SalesPage が
//   追補E で全 hook に共有する from/to そのもの（useSalesYoY に渡る start_date/end_date）
//   なので、カードの from/to と同一集合になる。
//
// ■ 当年/前年の分母対称化
//   前年分母も同一定義「前年期間の連続全カレンダー日数」=
//   inclusiveDaySpan(lastYearPeriod.start, lastYearPeriod.end) で割る。
//   round1 の前年分母 lyDays（byDate で lastYear!==null の行数 = 当年∩前年の matched 日数）は
//   当年分母（連続全日）と集合定義が非対称だった。lastYearPeriod は shiftRangeOneYearBack で
//   当年と原則同日数（うるう日 {2/28,2/29}→{2/28,2/28} の単日潰れだけが例外）だが、
//   交差や matched に依存せず「その年の期間の連続全日数」で当年・前年とも割ることで
//   集合定義を完全に対称化する。これにより分子（open 込み全期間合計）と分母（その年の
//   連続全日数）が当年・前年で同一定義となり、母数統一と符号正しさを両立する。
//
//   前年が MIN_LASTYEAR_CUSTOMERS 未満で希薄判定された場合は yoy.lastYear=null →
//   lyAvg=null → calculateYoY が no_data に倒す（SABABA は Square 本格運用 2025-03 開始の
//   ため前年が希薄な期間がある）。
// =============================================================================

/**
 * start..end（両端含む）の連続カレンダー日数を返す。
 *
 * カード averageDailySales の分母 elapsedDays = enumerateDates(from,to).length と
 * 同一値（同じ UTC 両端含む列挙の件数）。lib を hook（useSalesSegment.enumerateDates）に
 * 依存させない（lib→hook の循環/逆依存を避ける）ため、件数だけを O(1) で算出する。
 * 不正入力（空・逆順・パース不能）は 0 を返す（enumerateDates と同じく安全側）。
 */
export function inclusiveDaySpan(start: string, end: string): number {
  if (!start || !end || start > end) return 0;
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  return Math.floor((e.getTime() - s.getTime()) / 86400000) + 1;
}

export function computeAvgDailyYoY(yoy: SalesRangeYoYResult | null): YoYDelta | null {
  if (!yoy) return null;

  // 当年分母 = 当年期間の連続全カレンダー日数（= カード elapsedDays と同一集合）。
  const curDays = inclusiveDaySpan(yoy.period.start, yoy.period.end);
  if (curDays === 0) return null;

  // 当年: open 込み全期間合計 / 当年連続全日数（= カード averageDailySales と同基準）。
  const curSum = yoy.current.total_amount + yoy.current.open_total_amount;
  const curAvg = curSum / curDays;

  // 前年: open 込み全期間合計 / 前年連続全日数（当年と同一の集合定義で対称化）。
  // 前年データが希薄判定で null 化されていれば no_data に倒す。
  const lyDays =
    yoy.lastYear !== null
      ? inclusiveDaySpan(yoy.lastYearPeriod.start, yoy.lastYearPeriod.end)
      : 0;
  const lyAvg =
    yoy.lastYear !== null && lyDays > 0
      ? (yoy.lastYear.total_amount + yoy.lastYear.open_total_amount) / lyDays
      : null;

  return calculateYoY(curAvg, lyAvg);
}
