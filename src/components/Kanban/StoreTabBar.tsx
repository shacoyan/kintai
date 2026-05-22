/**
 * @fileoverview カンバンボードの店舗タブバー (Phase 2 Loop 1 で新規追加)
 *
 * 設計書: .company/engineering/docs/2026-05-22-kintai-task-kanban-phase2-techdesign.md §3-5
 *
 * 「全て」「全社」「店舗 × N」の横スクロールタブバー。
 * 各タブには未完了タスク数を Badge で表示する。
 * ホイールおよび横スワイプでスクロール可能。
 */
import { useMemo } from 'react';
import type { StoreTabValue } from './types';
import { cn } from '../../lib/cn';

/**
 * StoreTabValue を Map のキーとして使用するため、文字列にシリアライズする。
 * @example
 * serializeKey({ kind: 'all' })            // 'all'
 * serializeKey({ kind: 'company' })        // 'company'
 * serializeKey({ kind: 'store', storeId: 'abc' }) // 'store:abc'
 */
function serializeKey(value: StoreTabValue): string {
  switch (value.kind) {
    case 'all':
      return 'all';
    case 'company':
      return 'company';
    case 'store':
      return `store:${value.storeId}`;
    default:
      // Future-proof: 不明な kind は JSON にフォールバック
      return JSON.stringify(value);
  }
}

/**
 * 2 つの StoreTabValue が同一か判定する (kind 一致 + store の場合 storeId 一致)。
 */
function eqValue(a: StoreTabValue, b: StoreTabValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'store' && b.kind === 'store') {
    return a.storeId === b.storeId;
  }
  return true;
}

export interface StoreTabBarProps {
  /** 店舗一覧 */
  stores: Array<{ id: string; name: string }>;
  /** 現在選択中のタブ値 */
  value: StoreTabValue;
  /** タブ選択変更時コールバック */
  onChange: (value: StoreTabValue) => void;
  /** 未完了件数バッジ用のカウントマップ (任意) */
  /**
   * 文字列キー Map。キー規約:
   *   'all'      → 全件未完了数
   *   'company'  → store_id IS NULL の未完了数
   *   <storeId>  → 当該店舗の未完了数
   * Loop 4.5 P2-7: 元は Map<StoreTabValue, number> だったが object キーは
   * 参照同一性が一致せず lookup が常に miss していたため string キーに統一。
   */
  counts?: Map<string, number>;
}

export function StoreTabBar(props: StoreTabBarProps): JSX.Element {
  const { stores, value, onChange, counts } = props;

  // 既に文字列キー Map で渡ってくる前提だが、undefined ガードのためにラップ
  const countsMap = useMemo<Map<string, number>>(
    () => counts ?? new Map<string, number>(),
    [counts],
  );

  // タブ構成を定義
  const tabs: Array<{ tabValue: StoreTabValue; label: string }> = useMemo(
    () => [
      { tabValue: { kind: 'all' }, label: '全て' },
      { tabValue: { kind: 'company' }, label: '全社' },
      ...stores.map((store) => ({
        tabValue: { kind: 'store' as const, storeId: store.id },
        label: store.name,
      })),
    ],
    [stores],
  );

  return (
    <div
      className="flex items-center gap-2 overflow-x-auto py-1 px-1"
      role="tablist"
      aria-label="店舗タブ"
    >
      {tabs.map(({ tabValue, label }) => {
        const isActive = eqValue(value, tabValue);
        const count = countsMap.get(serializeKey(tabValue));

        return (
          <button
            key={serializeKey(tabValue)}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tabValue)}
            className={cn(
              'shrink-0 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
              isActive
                ? 'bg-blue-600 text-white shadow-sm hover:bg-blue-700'
                : 'bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-200 border border-stone-200 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-700',
            )}
          >
            {label}
            {count !== undefined && count > 0 && (
              isActive ? (
                <span className="bg-white/25 text-white px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums">
                  {count}
                </span>
              ) : (
                <span className="bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300 px-2 py-0.5 rounded-full text-[11px] font-medium tabular-nums">
                  {count}
                </span>
              )
            )}
          </button>
        );
      })}
    </div>
  );
}
