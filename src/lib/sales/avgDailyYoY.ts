import { calculateYoY } from './yoy';
import type { YoYDelta, SalesRangeYoYResult } from './yoy';

// =============================================================================
// avgDailyYoY — 1日平均売上の YoY（前回の符号逆転を解消した形）
// -----------------------------------------------------------------------------
// 当年=byDate 全件 current.total_amount 合計 / 当年実在日数、
// 前年=lastYear 非 null 行の lastYear.total_amount 合計 / その実在日数 の各年日平均→YoY。
//
// 前回バグは「前年分子=前年全件合計」と「分母=当年∩前年件数」の集合不一致で符号逆転して
// いた。本実装は前年も「前年に実在した行だけ」を分子・分母に使うため集合が一致し符号が正しい。
//
// NOTE: byDate.current/lastYear.total_amount は決済済のみ（open 抜き）ベース。カード表示値
// averageDailySales（open 込み）とは数値が一致しないが、当年/前年を同じ open 抜き定義に揃える
// ことが符号正しさの本質であり意図的（各年の実在日数を取るため byDate ベースが必須）。
// =============================================================================
export function computeAvgDailyYoY(yoy: SalesRangeYoYResult | null): YoYDelta | null {
  if (!yoy) return null;
  const curDays = yoy.byDate.length;
  if (curDays === 0) return null;
  const curSum = yoy.byDate.reduce((s, b) => s + b.current.total_amount, 0);
  const curAvg = curSum / curDays;
  const lyRows = yoy.byDate.filter((b) => b.lastYear !== null);
  const lyDays = lyRows.length;
  const lyAvg =
    lyDays > 0 ? lyRows.reduce((s, b) => s + b.lastYear!.total_amount, 0) / lyDays : null;
  return calculateYoY(curAvg, lyAvg);
}
