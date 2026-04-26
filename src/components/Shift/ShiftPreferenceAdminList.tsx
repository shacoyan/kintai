import { useState } from 'react';
import type { ShiftPreference } from '../../types';
import { PreferenceActionRow } from './PreferenceActionRow';

interface ShiftPreferenceAdminListProps {
  preferences: ShiftPreference[];
  memberNames: Map<string, string>;
  onApprove: (id: string, startTime?: string, endTime?: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onRefresh: () => void;
  historyMode?: boolean;
  canManageStore: (storeId: string | null) => boolean;
}

export function ShiftPreferenceAdminList({
  preferences,
  memberNames,
  onApprove,
  onReject,
  onRefresh,
  historyMode = false,
  canManageStore,
}: ShiftPreferenceAdminListProps) {
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');

  const displayed = historyMode ? preferences : (statusFilter === 'all' ? preferences : preferences.filter((p) => p.status === 'pending'));

  const pendingCount = preferences.filter((p) => p.status === 'pending').length;

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
      </div>

      {/* フィルタータブ */}
      {!historyMode && (
        <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-700">
          <button
            onClick={() => setStatusFilter('pending')}
            aria-pressed={statusFilter === 'pending'}
            className={`px-3 py-1.5 text-xs transition-colors ${
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
            className={`px-3 py-1.5 text-xs transition-colors ${
              statusFilter === 'all'
                ? 'border-b-2 border-primary-600 text-primary-600 font-semibold dark:border-primary-400 dark:text-primary-400'
                : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            すべて
          </button>
        </div>
      )}

      {displayed.length === 0 && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400 py-4 text-center">
          {historyMode ? '履歴はありません' : (statusFilter === 'all' ? '希望がありません' : '未対応の希望はありません')}
        </p>
      )}

      <div className="space-y-2">
        {displayed.map((pref) => (
          <PreferenceActionRow
            key={pref.id}
            variant="full"
            preference={pref}
            memberName={memberNames.get(pref.user_id) ?? '不明'}
            onApprove={onApprove}
            onReject={onReject}
            canManage={canManageStore(pref.store_id)}
            onMutated={onRefresh}
          />
        ))}
      </div>
    </div>
  );
}
