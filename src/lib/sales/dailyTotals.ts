import { toFiniteNumber } from './salesRangeAdapter';
import type { OpenOrder } from './types';

// =============================================================================
// computeDailyTotals — 当日売上の「決済済み + 未決済」集計（唯一の真実源）
// -----------------------------------------------------------------------------
// オーナー要件: 本日の売上(ヘッドライン)に未決済(OPEN)も含め、決済済み/未決済の
// 内訳(件数・金額)を表示する。
//
// 正当性インバリアント（Reviewer 必須確認・過去の二重計上事故の再発防止）:
//   決済済み(transactions=完了決済)と未決済(OPEN=未払い伝票)は定義上ディスジョイント。
//   支払うと OPEN から消え transactions へ移るため、同一時点で重複しない。
//   → grandTotal は単純和（差し引き・重複排除なし）で二重計上は起きない。
//
// NaN/欠落防御: 全フィールドを toFiniteNumber 経由で正規化し NaN 伝播ゼロ。
//   (openOrders[].total_money は useSquareOpenOrders 内で正規化済みだが、契約変更に
//    対する防御として本関数でも再度 toFiniteNumber を通す。)
// =============================================================================

/** useSquareLiveSales の sales（決済済み集計）。本関数が参照する一部のみ。 */
export interface DailyTotalsSales {
  total_amount: number;
  transaction_count: number;
}

export interface DailyTotals {
  /** 決済済み売上合計 */
  settledTotal: number;
  /** 決済済み取引件数 */
  settledCount: number;
  /** 未決済(OPEN)売上合計 */
  openTotal: number;
  /** 未決済(OPEN)伝票件数 = openOrders.length */
  openCount: number;
  /** 合計売上 = settledTotal + openTotal */
  grandTotal: number;
  /** 合計件数 = settledCount + openCount */
  grandCount: number;
}

/**
 * 当日の決済済み + 未決済を集計する純関数。
 * @param sales      決済済み集計（null 可 → 0 に倒す）
 * @param openOrders 未決済(OPEN)伝票配列（null/undefined 可 → 空扱い）
 */
export function computeDailyTotals(
  sales: DailyTotalsSales | null | undefined,
  openOrders: OpenOrder[] | null | undefined,
): DailyTotals {
  const settledTotal = toFiniteNumber(sales?.total_amount);
  const settledCount = toFiniteNumber(sales?.transaction_count);

  const orders = openOrders ?? [];
  const openTotal = orders.reduce((sum, o) => sum + toFiniteNumber(o?.total_money), 0);
  const openCount = orders.length;

  return {
    settledTotal,
    settledCount,
    openTotal,
    openCount,
    grandTotal: settledTotal + openTotal,
    grandCount: settledCount + openCount,
  };
}
