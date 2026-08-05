/**
 * シフト一覧ステータスフィルタの型・定義
 *
 * 設計書 §16.1 / §16.5 に基づき、ステータスフィルタ値の型と
 * ラベル・CSSクラス・ストレージキーなどの関連定数を一元管理する。
 */

/**
 * ステータスフィルタで扱う全値
 * - `pending_preference` / `unavailable_preference` は擬似 status
 *   (preference の pending を shift とは別 chip で扱う)
 * - `pending` (shift) は Loop10 で chip 削除済。shift.status='pending' は常時表示扱いとなり
 *   フィルタ対象外。
 */
export type StatusFilterValue =
  | 'tentative'
  | 'approved'
  | 'rejected'
  | 'modified'
  | 'cancelled'
  | 'pending_preference'
  | 'unavailable_preference';

/** 全ステータスフィルタ値の不変配列 */
export const ALL_STATUS_FILTER_VALUES: readonly StatusFilterValue[] = [
  'pending_preference',
  'unavailable_preference',
  'tentative',
  'approved',
  'modified',
  'rejected',
  'cancelled',
] as const;

/**
 * デフォルトで有効なステータスフィルタ
 * rejected / cancelled は初期状態で OFF
 * unavailable_preference は初期 ON (出勤不可は直感的に見えるべき / Loop14)
 */
export const DEFAULT_STATUS_FILTER: ReadonlySet<StatusFilterValue> = new Set<StatusFilterValue>([
  'pending_preference',
  'unavailable_preference',
  'tentative',
  'approved',
  'modified',
]);

/**
 * localStorage 保存キー (v4 / Loop14)
 * v3 から v4 へ bump: 'unavailable_preference' chip 追加に伴い、
 * 既存ユーザーも DEFAULT_STATUS_FILTER (4 chip 全 ON) で開始させる。
 * 旧 v3 値は読まずに DEFAULT_STATUS_FILTER で開始する（簡潔な移行）。
 */
export const STATUS_FILTER_STORAGE_KEY = 'kintai.shift.statusFilter.v4';

/** 各ステータスの表示ラベル */
export const STATUS_FILTER_LABELS: Record<StatusFilterValue, string> = {
  pending_preference: '申請中（未承認）',
  unavailable_preference: '出勤不可',
  tentative: '仮承認',
  approved: '本承認',
  modified: '修正',
  rejected: '却下',
  cancelled: '取消',
};

/** 各ステータスのドット表示用 CSS クラス (§16.5) */
export const STATUS_FILTER_DOT_CLASS: Record<StatusFilterValue, string> = {
  pending_preference: 'bg-orange-400',
  unavailable_preference: 'bg-red-500',
  tentative: 'bg-blue-400',
  approved: 'bg-emerald-400',
  modified: 'bg-blue-400',
  rejected: 'bg-red-400',
  cancelled: 'bg-stone-400',
};

/**
 * 「自分のみ」表示トグルの localStorage 保存キー (v1)
 * STATUS_FILTER_STORAGE_KEY とは別キーで永続化する (互換性のため独立キー)。
 */
export const MINE_ONLY_STORAGE_KEY = 'kintai.shift.mineOnly.v1';

/** mineOnly 判定対象となる行が最低限持つべき形状 */
export interface MineOnlyFilterableRow {
  user_id: string | null | undefined;
}

/**
 * 「自分のみ」フィルタの純関数。
 * - mineOnly が false の場合は常に true (絞り込みなし)。
 * - currentUserId が null/undefined の間は絞り込みを一切行わない
 *   (全件表示のまま保つ。null 同士の比較で全件 false になる罠を避ける)。
 * - それ以外は row.user_id === currentUserId の行のみ true。
 */
export function isMineOnlyVisible(
  row: MineOnlyFilterableRow,
  mineOnly: boolean,
  currentUserId: string | null | undefined
): boolean {
  if (!mineOnly) return true;
  if (currentUserId == null) return true;
  return !!currentUserId && row.user_id === currentUserId;
}

/**
 * 「自分のみ」チップを表示してよいかどうか。
 * - canManageTenant が false (staff) の場合は元々自分のみの表示なので無意味 → 非表示。
 * - currentUserId が未確定の間は誤ってフィルタを適用させないよう非表示。
 */
export function shouldShowMineOnlyFilter(
  canManageTenant: boolean,
  currentUserId: string | null | undefined
): boolean {
  return canManageTenant && currentUserId != null;
}
