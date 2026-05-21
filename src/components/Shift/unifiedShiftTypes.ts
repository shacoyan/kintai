/**
 * シフト一覧ステータスフィルタの型・定義
 *
 * 設計書 §16.1 / §16.5 に基づき、ステータスフィルタ値の型と
 * ラベル・CSSクラス・ストレージキーなどの関連定数を一元管理する。
 */

/**
 * ステータスフィルタで扱う全値
 * - `pending_preference` は擬似 status (preference の pending を shift とは別 chip で扱う)
 * - `pending` (shift) は Loop10 で chip 削除済。shift.status='pending' は常時表示扱いとなり
 *   フィルタ対象外。
 */
export type StatusFilterValue =
  | 'tentative'
  | 'approved'
  | 'rejected'
  | 'modified'
  | 'cancelled'
  | 'pending_preference';

/** 全ステータスフィルタ値の不変配列 */
export const ALL_STATUS_FILTER_VALUES: readonly StatusFilterValue[] = [
  'pending_preference',
  'tentative',
  'approved',
  'modified',
  'rejected',
  'cancelled',
] as const;

/**
 * デフォルトで有効なステータスフィルタ
 * rejected / cancelled は初期状態で OFF
 */
export const DEFAULT_STATUS_FILTER: ReadonlySet<StatusFilterValue> = new Set<StatusFilterValue>([
  'pending_preference',
  'tentative',
  'approved',
  'modified',
]);

/**
 * localStorage 保存キー (v3 / Loop10)
 * v2 から v3 へ bump: 'pending' chip 削除に伴うキー名変更。
 * 旧 v2 値は読まずに DEFAULT_STATUS_FILTER で開始する（簡潔な移行）。
 */
export const STATUS_FILTER_STORAGE_KEY = 'kintai.shift.statusFilter.v3';

/** 各ステータスの表示ラベル */
export const STATUS_FILTER_LABELS: Record<StatusFilterValue, string> = {
  pending_preference: '申請中（未承認）',
  tentative: '仮承認',
  approved: '本承認',
  modified: '修正',
  rejected: '却下',
  cancelled: '取消',
};

/** 各ステータスのドット表示用 CSS クラス (§16.5) */
export const STATUS_FILTER_DOT_CLASS: Record<StatusFilterValue, string> = {
  pending_preference: 'bg-warning-400',
  tentative: 'bg-info-400',
  approved: 'bg-success-400',
  modified: 'bg-primary-400',
  rejected: 'bg-danger-400',
  cancelled: 'bg-neutral-400',
};
