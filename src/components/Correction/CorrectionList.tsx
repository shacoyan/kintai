import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { FileEdit } from 'lucide-react';
import { CorrectionRequest } from '../../types';
import { Badge, Button, EmptyState } from '../ui';
import type { BadgeTone } from '../ui';
import { messages } from '../../lib/messages';

type FilterKey = 'all' | 'pending' | 'approved' | 'rejected' | 'correction' | 'delete';

interface CorrectionListProps {
  requests: CorrectionRequest[];
  onReview?: (id: string, status: 'approved' | 'rejected') => void;
  onRevert?: (id: string) => void | Promise<void>;
  showFilter?: boolean;
  memberNames?: Map<string, string>;
  storeNames?: Map<string, string>;
}

const statusConfig = {
  pending: { label: '承認待ち' },
  approved: { label: '承認済み' },
  rejected: { label: '却下' },
} as const;

const typeConfig = {
  correction: { label: '修正' },
  delete: { label: '削除' },
} as const;

const filterTabs: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'pending', label: '承認待ち' },
  { key: 'approved', label: '承認済' },
  { key: 'rejected', label: '却下' },
  { key: 'correction', label: '修正のみ' },
  { key: 'delete', label: '削除のみ' },
];

function statusToTone(status: 'pending' | 'approved' | 'rejected'): BadgeTone {
  return status === 'approved' ? 'success' : status === 'pending' ? 'warning' : 'danger';
}

function typeToTone(type: 'correction' | 'delete'): BadgeTone {
  return type === 'delete' ? 'danger' : 'primary';
}

function formatTime(time: string | null): string {
  if (!time) return '-';
  try {
    return format(parseISO(time), 'HH:mm');
  } catch {
    return time.substring(0, 5);
  }
}

export function CorrectionList({ requests, onReview, onRevert, showFilter = false, memberNames, storeNames }: CorrectionListProps) {
  const [confirming, setConfirming] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);
  const [filterKey, setFilterKey] = useState<FilterKey>('all');
  // 処理中の request.id（二重 RPC 防止: 確定ボタンを loading + disabled 化）
  const [inFlight, setInFlight] = useState<string | null>(null);

  const handleReview = async (id: string, status: 'approved' | 'rejected') => {
    setInFlight(id);
    try {
      await onReview?.(id, status);
      setConfirming(null);
    } finally {
      setInFlight(null);
    }
  };

  const handleRevert = async (id: string) => {
    if (!window.confirm(messages.confirm.revertCorrection)) return;
    setInFlight(id);
    try {
      await onRevert?.(id);
    } finally {
      setInFlight(null);
    }
  };

  const filtered = showFilter
    ? requests.filter(r => {
        switch (filterKey) {
          case 'all': return true;
          case 'pending': return r.status === 'pending';
          case 'approved': return r.status === 'approved';
          case 'rejected': return r.status === 'rejected';
          case 'correction': return (r.request_type ?? 'correction') === 'correction';
          case 'delete': return r.request_type === 'delete';
        }
      })
    : requests;

  if (filtered.length === 0) {
    return (
      <>
        {showFilter && (
          <div className="flex border-b border-stone-200 dark:border-stone-700 mb-4 overflow-x-auto">
            {filterTabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setFilterKey(tab.key)}
                className={`px-4 py-2 text-sm font-medium whitespace-nowrap motion-safe:transition-colors duration-150 ease-out ${
                  filterKey === tab.key
                    ? 'border-b-2 border-blue-500 dark:border-blue-400 text-blue-600 dark:text-blue-400'
                    : 'text-stone-500 dark:text-stone-300 hover:text-stone-700 dark:hover:text-stone-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
        <EmptyState
          icon={<FileEdit className="w-12 h-12 text-stone-400 dark:text-stone-500" />}
          title={messages.empty.correction.title}
          description={messages.empty.correction.description}
        />
      </>
    );
  }

  return (
    <>
      {showFilter && (
        <div className="flex border-b border-stone-200 dark:border-stone-700 mb-4 overflow-x-auto">
          {filterTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilterKey(tab.key)}
              className={`px-4 py-2 text-sm font-medium whitespace-nowrap motion-safe:transition-colors duration-150 ease-out ${
                filterKey === tab.key
                  ? 'border-b-2 border-blue-500 dark:border-blue-400 text-blue-600 dark:text-blue-400'
                  : 'text-stone-500 dark:text-stone-300 hover:text-stone-700 dark:hover:text-stone-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* モバイル: カード表示 */}
      <div className="sm:hidden divide-y divide-stone-200 dark:divide-stone-700">
        {filtered.map((request) => {
          const statusCfg = statusConfig[request.status];
          const requestType = request.request_type || 'correction';
          const typeCfg = typeConfig[requestType];
          const statusTone = statusToTone(request.status);
          const typeTone = typeToTone(requestType);
          const storeId = request.store_id ?? (request as any).attendance_records?.store_id ?? null;
          const storeName = storeId ? storeNames?.get(storeId) : null;
          return (
            <div key={request.id} className="px-4 py-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-stone-900 dark:text-stone-100">{request.date}</span>
                <div className="flex gap-2">
                  {storeName && <Badge tone="primary">{storeName}</Badge>}
                  <Badge tone={typeTone}>{typeCfg.label}</Badge>
                  <Badge tone={statusTone}>{statusCfg.label}</Badge>
                </div>
              </div>
              <div className="text-xs text-stone-500 dark:text-stone-300">
                {memberNames?.get(request.user_id)}
              </div>
              {requestType !== 'delete' && (
                <div className="flex gap-4 text-sm text-stone-600 dark:text-stone-300 tabular-nums">
                  <span>出勤: {formatTime(request.requested_clock_in)}</span>
                  <span>退勤: {formatTime(request.requested_clock_out)}</span>
                </div>
              )}
              <p className="text-sm text-stone-700 dark:text-stone-300">{request.reason}</p>
              {(onReview || onRevert) && (
                <div className="flex gap-2 pt-1">
                  {confirming?.id === request.id && confirming.action === 'approve' ? (
                    <div className="flex gap-1 flex-1">
                      <Button variant="primary" size="sm" className="flex-1" loading={inFlight === request.id} onClick={() => handleReview(request.id, 'approved')}>確定</Button>
                      <Button variant="tertiary" size="sm" className="flex-1" disabled={inFlight === request.id} onClick={() => setConfirming(null)}>戻す</Button>
                    </div>
                  ) : confirming?.id === request.id && confirming.action === 'reject' ? (
                    <div className="flex gap-1 flex-1">
                      <Button variant="danger" size="sm" className="flex-1" loading={inFlight === request.id} onClick={() => handleReview(request.id, 'rejected')}>確定</Button>
                      <Button variant="tertiary" size="sm" className="flex-1" disabled={inFlight === request.id} onClick={() => setConfirming(null)}>戻す</Button>
                    </div>
                  ) : request.status === 'pending' && onReview ? (
                    <div className="flex gap-1 flex-1">
                      <Button variant="primary" size="sm" className="flex-1" onClick={() => setConfirming({ id: request.id, action: 'approve' })}>承認</Button>
                      <Button variant="danger" size="sm" className="flex-1" onClick={() => setConfirming({ id: request.id, action: 'reject' })}>却下</Button>
                    </div>
                  ) : request.status !== 'pending' && onRevert ? (
                    <Button variant="tertiary" size="sm" className="flex-1" loading={inFlight === request.id} onClick={() => handleRevert(request.id)}>巻き戻す</Button>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* デスクトップ: テーブル表示 */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="min-w-full divide-y divide-stone-200 dark:divide-stone-700">
          <thead className="bg-stone-50 dark:bg-stone-700">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-stone-500 dark:text-stone-300 uppercase tracking-wider">日付</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-stone-500 dark:text-stone-300 uppercase tracking-wider">申請者</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-stone-500 dark:text-stone-300 uppercase tracking-wider">種類</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-stone-500 dark:text-stone-300 uppercase tracking-wider">申請出勤</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-stone-500 dark:text-stone-300 uppercase tracking-wider">申請退勤</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-stone-500 dark:text-stone-300 uppercase tracking-wider">理由</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-stone-500 dark:text-stone-300 uppercase tracking-wider">ステータス</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-stone-500 dark:text-stone-300 uppercase tracking-wider">店舗</th>
              {(onReview || onRevert) && (
                <th className="px-4 py-3 text-left text-xs font-medium text-stone-500 dark:text-stone-300 uppercase tracking-wider">操作</th>
              )}
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-stone-800 divide-y divide-stone-200 dark:divide-stone-700 tabular-nums">
            {filtered.map((request) => {
              const statusCfg = statusConfig[request.status];
              const requestType = request.request_type || 'correction';
              const typeCfg = typeConfig[requestType];
              const statusTone = statusToTone(request.status);
              const typeTone = typeToTone(requestType);
              const storeId = request.store_id ?? (request as any).attendance_records?.store_id ?? null;
              const storeName = storeId ? storeNames?.get(storeId) : null;
              return (
                <tr key={request.id} className="hover:bg-stone-50 dark:hover:bg-stone-700/50 motion-safe:transition-colors duration-150 ease-out">
                  <td className="px-4 py-3 text-sm text-stone-900 dark:text-stone-100 whitespace-nowrap">{request.date}</td>
                  <td className="px-4 py-3 text-sm text-stone-900 dark:text-stone-100 whitespace-nowrap">
                    {memberNames?.get(request.user_id) ?? '-'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Badge tone={typeTone}>{typeCfg.label}</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-stone-900 dark:text-stone-100 whitespace-nowrap">
                    {requestType === 'delete' ? '-' : formatTime(request.requested_clock_in)}
                  </td>
                  <td className="px-4 py-3 text-sm text-stone-900 dark:text-stone-100 whitespace-nowrap">
                    {requestType === 'delete' ? '-' : formatTime(request.requested_clock_out)}
                  </td>
                  <td className="px-4 py-3 text-sm text-stone-700 dark:text-stone-300 max-w-xs truncate">{request.reason}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Badge tone={statusTone}>{statusCfg.label}</Badge>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {storeName ? <Badge tone="primary">{storeName}</Badge> : <span className="text-sm text-stone-400 dark:text-stone-500">-</span>}
                  </td>
                  {(onReview || onRevert) && (
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {confirming?.id === request.id && confirming.action === 'approve' ? (
                        <div className="flex gap-1">
                          <Button variant="primary" size="sm" loading={inFlight === request.id} onClick={() => handleReview(request.id, 'approved')}>確定</Button>
                          <Button variant="tertiary" size="sm" disabled={inFlight === request.id} onClick={() => setConfirming(null)}>戻す</Button>
                        </div>
                      ) : confirming?.id === request.id && confirming.action === 'reject' ? (
                        <div className="flex gap-1">
                          <Button variant="danger" size="sm" loading={inFlight === request.id} onClick={() => handleReview(request.id, 'rejected')}>確定</Button>
                          <Button variant="tertiary" size="sm" disabled={inFlight === request.id} onClick={() => setConfirming(null)}>戻す</Button>
                        </div>
                      ) : request.status === 'pending' && onReview ? (
                        <div className="flex gap-1">
                          <Button variant="primary" size="sm" onClick={() => setConfirming({ id: request.id, action: 'approve' })}>承認</Button>
                          <Button variant="danger" size="sm" onClick={() => setConfirming({ id: request.id, action: 'reject' })}>却下</Button>
                        </div>
                      ) : request.status !== 'pending' && onRevert ? (
                        <Button variant="tertiary" size="sm" loading={inFlight === request.id} onClick={() => handleRevert(request.id)}>巻き戻す</Button>
                      ) : (
                        <span className="text-xs text-stone-400 dark:text-stone-500">-</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
