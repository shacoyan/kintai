// =============================================================================
// kintai store.name <-> Square locations_meta.location_name 名称マッピング
// -----------------------------------------------------------------------------
// 設計書 §2.5。kintai 側の店舗名と Square 側の location_name は基本同名だが、
// 「こまいぬ」↔「狛犬」の 1 件のみ表記が異なる。テーブル化はコスト > 効果のため
// フロント静的定数で吸収する（Phase3 で public.stores.square_location_id 列へ
// 昇格し、この定数表は撤去予定）。
//
// 突合キーは location_name（square_dashboard.locations_meta に label 列は無い）。
// 2026-06-06 実 active 店: Goodbye / KITUNE / LR / moumou / 吸暮 / 狛犬 / 金魚。
// → kintai 側「こまいぬ」以外は同名 passthrough で一致する。
// =============================================================================

/** kintai store.name -> Square location_name（不一致はこの 1 件のみ） */
export const STORE_NAME_TO_SQUARE: Record<string, string> = {
  こまいぬ: '狛犬',
};

/** 逆引き: Square location_name -> kintai store.name */
const SQUARE_NAME_TO_STORE: Record<string, string> = Object.fromEntries(
  Object.entries(STORE_NAME_TO_SQUARE).map(([k, v]) => [v, k])
);

/**
 * kintai store.name を Square location_name に変換する。
 * マップに無ければそのまま返す（同名 passthrough）。
 */
export function resolveSquareLocationName(storeName: string): string {
  return STORE_NAME_TO_SQUARE[storeName] ?? storeName;
}

/**
 * Square location_name を kintai store.name に逆変換する。
 * マップに無ければそのまま返す（同名 passthrough）。
 */
export function resolveKintaiStoreName(squareName: string): string {
  return SQUARE_NAME_TO_STORE[squareName] ?? squareName;
}
