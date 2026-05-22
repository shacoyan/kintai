import { useState, useEffect, useMemo } from 'react';
import type { ShiftPreference } from '../../types';
import { PreferenceActionRow } from './PreferenceActionRow';
import { EmptyState, Heading } from '../ui';
import { Spinner } from '../ui/Spinner';

interface ShiftPreferenceAdminListProps {
  preferences: ShiftPreference[];
  memberNames: Map<string, string>;
  onApprove: (id: string, startTime?: string, endTime?: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onRefresh: () => void;
  historyMode?: boolean;
  canManageStore: (storeId: string | null) => boolean;
  onBulkApprove?: (ids: string[]) => Promise<void>;
  onBulkReject?: (ids: string[]) => Promise<void>;
  stores?: { id: string; name: string }[];
  onRevert?: (id: string) => Promise<void>;
}

type SortKey = 'date_asc' | 'date_desc' | 'created_desc' | 'member';
type BulkConfirmType = 'approve' | 'reject' | null;

const PAGE_SIZE = 20;

function sortPrefs(arr: ShiftPreference[], key: SortKey, memberNamesMap: Map<string, string>): ShiftPreference[] {
  const sorted = [...arr];
  switch (key) {
    case 'date_asc':
      return sorted.sort((a, b) => a.date.localeCompare(b.date) || (a.start_time ?? '').localeCompare(b.start_time ?? ''));
    case 'date_desc':
      return sorted.sort((a, b) => b.date.localeCompare(a.date) || (a.start_time ?? '').localeCompare(b.start_time ?? ''));
    case 'created_desc':
      return sorted.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
    case 'member':
      return sorted.sort((a, b) => (memberNamesMap.get(a.user_id) ?? '').localeCompare(memberNamesMap.get(b.user_id) ?? '', 'ja') || a.date.localeCompare(b.date));
    default:
      return sorted;
  }
}

export function ShiftPreferenceAdminList({
  preferences,
  memberNames,
  onApprove,
  onReject,
  onRefresh,
  historyMode = false,
  canManageStore,
  onBulkApprove,
  onBulkReject,
  stores,
  onRevert,
}: ShiftPreferenceAdminListProps) {
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');
  const [sortKey, setSortKey] = useState<SortKey>('date_asc');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirming, setBulkConfirming] = useState<BulkConfirmType>(null);
  const [processing, setProcessing] = useState(false);

  const displayed = historyMode 
    ? preferences 
    : (statusFilter === 'all' ? preferences : preferences.filter((p) => p.status === 'pending'));

  const pendingCount = preferences.filter((p) => p.status === 'pending').length;
  const canBulk = !historyMode && (selectedIds.size > 0 || pendingCount > 0);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [statusFilter, sortKey, historyMode, preferences.length]);

  const sortedDisplayed = useMemo(() => sortPrefs(displayed, sortKey, memberNames), [displayed, sortKey, memberNames]);
  const visibleDisplayed = sortedDisplayed.slice(0, visibleCount);
  const overflow = sortedDisplayed.length - visibleCount;

  const visiblePendingIds = useMemo(
    () => visibleDisplayed.filter(p => p.status === 'pending' && p.preference_type !== 'unavailable').map(p => p.id),
    [visibleDisplayed]
  );

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAllPending = () => {
    setSelectedIds(prev => {
      const allSelected = visiblePendingIds.length > 0 && visiblePendingIds.every(id => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        visiblePendingIds.forEach(id => next.delete(id));
        return next;
      } else {
        const next = new Set(prev);
        visiblePendingIds.forEach(id => next.add(id));
        return next;
      }
    });
  };

  const storeMap = useMemo(() => new Map((stores ?? []).map(s => [s.id, s.name])), [stores]);
  const showStoreBadge = (stores?.length ?? 0) >= 2;

  const handleBulkApproveConfirm = async () => {
    const ids = selectedIds.size > 0
      ? [...selectedIds]
      : preferences.filter(p => p.status === 'pending' && p.preference_type !== 'unavailable').map(p => p.id);
    
    if (ids.length === 0) return;
    
    setProcessing(true);
    try {
      await onBulkApprove?.(ids);
      setSelectedIds(new Set());
      setBulkConfirming(null);
    } finally {
      setProcessing(false);
    }
  };

  const handleBulkRejectConfirm = async () => {
    const ids = selectedIds.size > 0
      ? [...selectedIds]
      : preferences.filter(p => p.status === 'pending').map(p => p.id);
      
    if (ids.length === 0) return;

    setProcessing(true);
    try {
      await onBulkReject?.(ids);
      setSelectedIds(new Set());
      setBulkConfirming(null);
    } finally {
      setProcessing(false);
    }
  };

  const renderBulkActionBar = () => {
    if (historyMode) return null;

    return (
      <div className="flex flex-wrap items-center gap-2 py-2">
        <span className="text-xs text-stone-500 dark:text-stone-300">
          {selectedIds.size > 0 ? `${selectedIds.size} 件選択中` : '一括操作'}
        </span>
        {bulkConfirming === 'approve' ? (
          <>
            <button 
              onClick={handleBulkApproveConfirm} 
              disabled={processing} 
              className="px-3 py-2 text-xs font-medium text-white bg-emerald-700 dark:bg-emerald-200 rounded-md hover:bg-emerald-700 dark:hover:bg-emerald-100 disabled:opacity-50 motion-safe:transition-colors duration-150 ease-out flex items-center"
            >
              {processing && <Spinner size="sm" inline className="mr-1" />}
              {selectedIds.size > 0 ? `選択 ${selectedIds.size}件 承認する` : `pending ${pendingCount}件 全て承認する`}
            </button>
            <button 
              onClick={() => setBulkConfirming(null)} 
              className="px-3 py-2 text-xs font-medium text-stone-600 dark:text-stone-300 bg-stone-100 dark:bg-stone-700 rounded-md hover:bg-stone-200 dark:hover:bg-stone-600 motion-safe:transition-colors duration-150 ease-out"
            >
              戻す
            </button>
          </>
        ) : bulkConfirming === 'reject' ? (
          <>
            <button 
              onClick={handleBulkRejectConfirm} 
              disabled={processing} 
              className="px-3 py-2 text-xs font-medium text-white bg-red-700 dark:bg-red-200 rounded-md hover:bg-red-700 dark:hover:bg-red-100 disabled:opacity-50 motion-safe:transition-colors duration-150 ease-out flex items-center"
            >
              {processing && <Spinner size="sm" inline className="mr-1" />}
              {selectedIds.size > 0 ? `選択 ${selectedIds.size}件 却下する` : `pending ${pendingCount}件 全て却下する`}
            </button>
            <button 
              onClick={() => setBulkConfirming(null)} 
              className="px-3 py-2 text-xs font-medium text-stone-600 dark:text-stone-300 bg-stone-100 dark:bg-stone-700 rounded-md hover:bg-stone-200 dark:hover:bg-stone-600 motion-safe:transition-colors duration-150 ease-out"
            >
              戻す
            </button>
          </>
        ) : (
          <>
            <button 
              onClick={() => setBulkConfirming('approve')} 
              disabled={!canBulk} 
              className="px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-800/30 rounded-md hover:bg-emerald-50 dark:hover:bg-emerald-800/50 disabled:opacity-50 motion-safe:transition-colors duration-150 ease-out"
            >
              一括承認
            </button>
            <button 
              onClick={() => setBulkConfirming('reject')} 
              disabled={!canBulk} 
              className="px-3 py-2 text-xs font-medium text-red-700 dark:text-red-200 bg-red-50 dark:bg-red-800/30 rounded-md hover:bg-red-50 dark:hover:bg-red-800/50 disabled:opacity-50 motion-safe:transition-colors duration-150 ease-out"
            >
              一括却下
            </button>
            {selectedIds.size > 0 && (
              <button 
                onClick={() => setSelectedIds(new Set())} 
                className="text-xs text-stone-500 dark:text-stone-300 hover:underline"
              >
                選択解除
              </button>
            )}
          </>
        )}
        {!historyMode && visiblePendingIds.length > 0 && (
          <button
            onClick={toggleSelectAllPending}
            className="ml-auto text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
          >
            {visiblePendingIds.every(id => selectedIds.has(id)) ? '全解除' : `表示中 pending ${visiblePendingIds.length}件 全選択`}
          </button>
        )}
      </div>
    );
  };

  const renderSortSelect = (className: string) => (
    <div className={className}>
      <select 
        value={sortKey} 
        onChange={(e) => setSortKey(e.target.value as SortKey)} 
        aria-label="並び順" 
        className="text-xs border border-stone-200 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 dark:focus-visible:ring-offset-stone-900"
      >
        <option value="date_asc">日付↑</option>
        <option value="date_desc">日付↓</option>
        <option value="created_desc">申請日↓</option>
        <option value="member">メンバー</option>
      </select>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <Heading level={4} className="flex items-center gap-2">
          {historyMode ? 'シフト申請の履歴' : 'シフト申請の承認'}
          {historyMode ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-700 dark:bg-stone-700 dark:text-stone-300">
              全 {preferences.length} 件
            </span>
          ) : (
            pendingCount > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-700 dark:bg-orange-800 dark:text-orange-100">
                {pendingCount}件 未対応
              </span>
            )
          )}
        </Heading>
        {historyMode && renderSortSelect('flex-shrink-0')}
      </div>

      {/* フィルタータブ */}
      {!historyMode && (
        <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-700">
          <div className="flex gap-1 flex-1">
            <button
              onClick={() => setStatusFilter('pending')}
              aria-pressed={statusFilter === 'pending'}
              className={`px-3 py-2 text-xs motion-safe:transition-colors duration-150 ease-out ${
                statusFilter === 'pending'
                  ? 'border-b-2 border-blue-600 text-blue-600 font-semibold dark:border-blue-400 dark:text-blue-400'
                  : 'text-stone-500 hover:text-stone-700 dark:text-stone-300 dark:hover:text-stone-200'
              }`}
            >
              申請中({pendingCount})
            </button>
            <button
              onClick={() => setStatusFilter('all')}
              aria-pressed={statusFilter === 'all'}
              className={`px-3 py-2 text-xs motion-safe:transition-colors duration-150 ease-out ${
                statusFilter === 'all'
                  ? 'border-b-2 border-blue-600 text-blue-600 font-semibold dark:border-blue-400 dark:text-blue-400'
                  : 'text-stone-500 hover:text-stone-700 dark:text-stone-300 dark:hover:text-stone-200'
              }`}
            >
              すべて
            </button>
          </div>
          {renderSortSelect('px-4 py-2')}
        </div>
      )}

      {/* Bulk Action Bar */}
      {renderBulkActionBar()}

      {sortedDisplayed.length === 0 && (
        <EmptyState
          size="sm"
          title={historyMode ? '履歴はありません' : (statusFilter === 'all' ? 'シフト申請がありません' : '未対応のシフト申請はありません')}
        />
      )}

      <div className="space-y-2">
        {visibleDisplayed.map((pref) => (
          <PreferenceActionRow
            key={pref.id}
            variant="full"
            preference={pref}
            memberName={memberNames.get(pref.user_id) ?? '不明'}
            onApprove={onApprove}
            onReject={onReject}
            canManage={canManageStore(pref.store_id)}
            onMutated={onRefresh}
            selectable={!historyMode}
            selected={selectedIds.has(pref.id)}
            onToggleSelect={toggleSelect}
            storeName={pref.store_id ? storeMap.get(pref.store_id) : undefined}
            showStoreBadge={showStoreBadge}
            onRevert={onRevert}
          />
        ))}
      </div>

      {overflow > 0 && (
        <button 
          onClick={() => setVisibleCount(c => c + PAGE_SIZE)} 
          className="w-full px-6 py-3 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-stone-50 dark:hover:bg-stone-800 motion-safe:transition-colors duration-150 ease-out border-t border-stone-200 dark:border-stone-700 rounded-md"
        >
          もっと見る (+{Math.min(overflow, PAGE_SIZE)} / 残り {overflow}件)
        </button>
      )}
    </div>
  );
}
