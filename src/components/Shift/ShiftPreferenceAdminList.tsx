import { useState, useEffect, useMemo } from 'react';
import type { ShiftPreference } from '../../types';
import { Loader2 } from 'lucide-react';
import { PreferenceActionRow } from './PreferenceActionRow';

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
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {selectedIds.size > 0 ? `${selectedIds.size} 件選択中` : '一括操作'}
        </span>
        {bulkConfirming === 'approve' ? (
          <>
            <button 
              onClick={handleBulkApproveConfirm} 
              disabled={processing} 
              className="px-3 py-1.5 text-xs font-medium text-white bg-success-700 rounded-md hover:bg-success-800 disabled:opacity-50 motion-safe:transition flex items-center"
            >
              {processing && <Loader2 className="w-4 h-4 motion-safe:animate-spin mr-1" />}
              {selectedIds.size > 0 ? `選択 ${selectedIds.size}件 承認する` : `pending ${pendingCount}件 全て承認する`}
            </button>
            <button 
              onClick={() => setBulkConfirming(null)} 
              className="px-3 py-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-600 motion-safe:transition"
            >
              戻す
            </button>
          </>
        ) : bulkConfirming === 'reject' ? (
          <>
            <button 
              onClick={handleBulkRejectConfirm} 
              disabled={processing} 
              className="px-3 py-1.5 text-xs font-medium text-white bg-danger-700 rounded-md hover:bg-danger-800 disabled:opacity-50 motion-safe:transition flex items-center"
            >
              {processing && <Loader2 className="w-4 h-4 motion-safe:animate-spin mr-1" />}
              {selectedIds.size > 0 ? `選択 ${selectedIds.size}件 却下する` : `pending ${pendingCount}件 全て却下する`}
            </button>
            <button 
              onClick={() => setBulkConfirming(null)} 
              className="px-3 py-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-600 motion-safe:transition"
            >
              戻す
            </button>
          </>
        ) : (
          <>
            <button 
              onClick={() => setBulkConfirming('approve')} 
              disabled={!canBulk} 
              className="px-3 py-1.5 text-xs font-medium text-success-800 dark:text-success-300 bg-success-50 dark:bg-success-900/30 rounded-md hover:bg-success-100 dark:hover:bg-success-900/50 disabled:opacity-50 motion-safe:transition"
            >
              一括承認
            </button>
            <button 
              onClick={() => setBulkConfirming('reject')} 
              disabled={!canBulk} 
              className="px-3 py-1.5 text-xs font-medium text-danger-800 dark:text-danger-300 bg-danger-50 dark:bg-danger-900/30 rounded-md hover:bg-danger-100 dark:hover:bg-danger-900/50 disabled:opacity-50 motion-safe:transition"
            >
              一括却下
            </button>
            {selectedIds.size > 0 && (
              <button 
                onClick={() => setSelectedIds(new Set())} 
                className="text-xs text-neutral-500 hover:underline"
              >
                選択解除
              </button>
            )}
          </>
        )}
        {!historyMode && visiblePendingIds.length > 0 && (
          <button
            onClick={toggleSelectAllPending}
            className="ml-auto text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 font-medium"
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
        className="text-xs border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 rounded px-2 py-1"
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
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          {historyMode ? 'シフト希望の履歴' : 'シフト希望の承認'}
          {historyMode ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-neutral-100 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300">
              全 {preferences.length} 件
            </span>
          ) : (
            pendingCount > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-800 dark:bg-warning-900 dark:text-warning-200">
                {pendingCount}件 未対応
              </span>
            )
          )}
        </h3>
        {historyMode && renderSortSelect('flex-shrink-0')}
      </div>

      {/* フィルタータブ */}
      {!historyMode && (
        <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-700">
          <div className="flex gap-1 flex-1">
            <button
              onClick={() => setStatusFilter('pending')}
              aria-pressed={statusFilter === 'pending'}
              className={`px-3 py-1.5 text-xs motion-safe:transition-colors ${
                statusFilter === 'pending'
                  ? 'border-b-2 border-primary-600 text-primary-600 font-semibold dark:border-primary-400 dark:text-primary-400'
                  : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
              }`}
            >
              申請中({pendingCount})
            </button>
            <button
              onClick={() => setStatusFilter('all')}
              aria-pressed={statusFilter === 'all'}
              className={`px-3 py-1.5 text-xs motion-safe:transition-colors ${
                statusFilter === 'all'
                  ? 'border-b-2 border-primary-600 text-primary-600 font-semibold dark:border-primary-400 dark:text-primary-400'
                  : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
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
        <p className="text-sm text-neutral-500 dark:text-neutral-400 py-4 text-center">
          {historyMode ? '履歴はありません' : (statusFilter === 'all' ? '希望がありません' : '未対応の希望はありません')}
        </p>
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
          className="w-full px-6 py-3 text-sm font-medium text-primary-600 dark:text-primary-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 motion-safe:transition border-t border-neutral-200 dark:border-neutral-700 rounded-md"
        >
          もっと見る (+{Math.min(overflow, PAGE_SIZE)} / 残り {overflow}件)
        </button>
      )}
    </div>
  );
}
