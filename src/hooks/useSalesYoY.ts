import { useMemo } from 'react';
import { useSalesRange } from './useSalesRange';
import {
  buildYoYResultFromResponses,
  shiftRangeOneYearBack,
  type SalesRangeYoYResult,
} from '../lib/sales/yoy';
import type { SalesRangeMeta } from '../lib/sales/salesRangeAdapter';

// =============================================================================
// useSalesYoY — current 期間 + 前年同期の 2 回 RPC 呼びで YoY を返す hook
// -----------------------------------------------------------------------------
// 設計書 追補D（2026-06-09 Loop2）。既存 `get_sales_range_scoped`(070) を
// current 期間と前年同期で 2 回呼び（RPC 改修不要）、純関数
// `buildYoYResultFromResponses` で `SalesRangeYoYResult` を組む。
//
//   - 前年同期の期間は呼び側（本 hook）で在庫 `shiftRangeOneYearBack` を使い算出。
//     RPC 内では前年を算出しない（070 無改変）。
//   - `useSalesRange` を 2 インスタンス使う（current / 前年）。前年も同じ
//     `locationNames` を渡すだけで前年スコープも DB が強制（staff は前年も自店のみ）。
//   - 前年取得失敗・前年空・前年希薄は **部分成功**: current は出し、YoY 欄は
//     no_data（data.lastYear=null）。current 失敗のみ error。
//   - 客数 YoY 母数は buildYoYResultFromResponses が 4 セグ合計に統一
//     （2026-05-31 母数不整合バグ再発防止）。
//   - 当年も前年も同一 RPC(070) なので start_hour JOIN による二重計上回避が両期間で効く。
// =============================================================================

export interface UseSalesYoYArgs {
  /** current 期間の開始日 YYYY-MM-DD（SalesPage が calculatePeriodDates から算出）。 */
  from: string;
  /** current 期間の終了日 YYYY-MM-DD。 */
  to: string;
  /**
   * 閲覧対象の Square location_name 配列。
   * `null` = ALL（許可全店）。RPC には p_location_names=null で渡る。
   */
  locationNames: string[] | null;
  /** false のときフェッチをスキップ（YoY を出す時のみ true）。省略時 true。 */
  enabled?: boolean;
}

export interface UseSalesYoYResult {
  data: SalesRangeYoYResult | null;
  loading: boolean;
  error: string | null;
  currentMeta: SalesRangeMeta | null;
  lastYearMeta: SalesRangeMeta | null;
}

export function useSalesYoY(args: UseSalesYoYArgs): UseSalesYoYResult {
  const { from, to, locationNames, enabled = true } = args;

  // 前年同期の範囲を算出（うるう年クランプは shiftDateOneYearBack が担保）。
  const lastYearRange = useMemo(
    () => shiftRangeOneYearBack({ start_date: from, end_date: to }),
    [from, to],
  );

  // current 期間（070 RPC）。
  const cur = useSalesRange({ from, to, locationNames, enabled });

  // 前年同期（070 RPC・同スコープ）。
  const ly = useSalesRange({
    from: lastYearRange.start_date,
    to: lastYearRange.end_date,
    locationNames,
    enabled,
  });

  const data = useMemo<SalesRangeYoYResult | null>(() => {
    // current 失敗 / 未取得は YoY 全体を null（バッジ非表示）に倒す。
    // cur.data は fail-closed で EMPTY_RESPONSE が入り得るため、cur.error も併せて見る。
    if (cur.error || !cur.data) return null;
    // 前年が空（byDate 0 件）なら lastYearRes=null で渡す → no_data 扱い（部分成功）。
    // ly.error 時も EMPTY_RESPONSE（byDate 空）が入るため同判定で null に倒れる。
    const lastYearRes =
      ly.data && Object.keys(ly.data.byDate).length > 0 ? ly.data : null;
    return buildYoYResultFromResponses({
      start_date: from,
      end_date: to,
      currentRes: cur.data,
      lastYearRes,
    });
  }, [cur.error, cur.data, ly.data, from, to]);

  return {
    data,
    loading: cur.loading || ly.loading,
    // current 失敗のみ error。前年失敗は部分成功（data.lastYear=null）。
    error: cur.error,
    currentMeta: cur.data?.meta ?? null,
    lastYearMeta: ly.data?.meta ?? null,
  };
}
