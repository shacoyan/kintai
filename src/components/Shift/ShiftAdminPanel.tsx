import { useState, useMemo, useEffect } from 'react';
import type { Shift, TenantMember } from '../../types';
import { formatSupabaseError } from '../../lib/errors';
import { EmptyState, Heading } from '../ui';
import { ActionMenu, type ActionMenuItem } from '../ui/ActionMenu';
import { Spinner } from '../ui/Spinner';
import { messages } from '../../lib/messages';
import { formatTimeRange } from '../../utils/formatTimeRange';

interface ShiftAdminPanelProps {
  shifts: Shift[];
  members: TenantMember[];
  onApprove: (shiftId: string) => Promise<void>;
  onReject: (shiftId: string) => Promise<void>;
  onModify: (shiftId: string, startTime: string, endTime: string, storeId?: string) => Promise<void>;
  onDelete: (shiftId: string) => Promise<void>;
  onRefresh: () => void;
  canManageStore: (storeId: string | null) => boolean;
  stores?: { id: string; name: string }[];
  onTentativeApprove?: (shiftId: string) => Promise<void>;
  onCancelTentative?: (shiftId: string) => Promise<void>;
  onFinalApproveStore?: (tenantId: string, storeId: string) => Promise<{ approved_count: number; approved_ids: string[] }>;
  onRestore?: (shiftId: string) => Promise<void>;
  onRevertToTentative?: (shiftId: string) => Promise<void>;
  tenantId?: string;
  onToast?: (message: string, type?: 'success' | 'error') => void;
}

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '15', '30', '45']) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`);
  }
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: '申請中', className: 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-300' },
  tentative: { label: '仮承認', className: 'bg-info-100 text-info-800 dark:bg-info-900/30 dark:text-info-300' },
  approved: { label: '本承認', className: 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300' },
  rejected: { label: '却下', className: 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-300' },
  modified: { label: '修正', className: 'bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-300' },
};

type SortKey = 'date_asc' | 'date_desc' | 'created_asc' | 'created_desc';

export function ShiftAdminPanel({
  shifts,
  members,
  onApprove,
  onReject,
  onModify,
  onDelete,
  onRefresh,
  canManageStore,
  stores,
  onTentativeApprove,
  onCancelTentative,
  onFinalApproveStore,
  onRestore,
  onRevertToTentative,
  tenantId,
  onToast
}: ShiftAdminPanelProps) {
  const [statusFilter, setStatusFilter] = useState<'pending' | 'tentative' | 'approved' | 'all'>('pending');
  const [modifyingId, setModifyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [modStart, setModStart] = useState('');
  const [modEnd, setModEnd] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('date_desc');
  const [confirmingId, setConfirmingId] = useState<{ id: string; action: 'approve' | 'reject' | 'restore' | 'tentative' | 'final-approve' } | null>(null);
  const [bulkConfirmingStoreId, setBulkConfirmingStoreId] = useState<string | null>(null);
  const [cancelingTentativeId, setCancelingTentativeId] = useState<string | null>(null);
  const [revertingToTentativeId, setRevertingToTentativeId] = useState<string | null>(null);

  const memberMap = new Map(members.map(m => [m.user_id, m.display_name]));
  const storeMap = useMemo(() => new Map((stores ?? []).map(s => [s.id, s.name])), [stores]);
  const showStoreBadge = (stores?.length ?? 0) >= 2;

  const manageableShifts = useMemo(() => shifts.filter(s => canManageStore(s.store_id)), [shifts, canManageStore]);

  const pendingShifts = useMemo(() => manageableShifts.filter(s => s.status === 'pending'), [manageableShifts]);
  const tentativeShifts = useMemo(() => manageableShifts.filter(s => s.status === 'tentative'), [manageableShifts]);
  const approvedShifts = useMemo(() => manageableShifts.filter(s => s.status === 'approved'), [manageableShifts]);
  const allShifts = useMemo(() => manageableShifts.filter(s => s.status !== 'cancelled'), [manageableShifts]);

  const displayedShifts = useMemo(() => {
    const filtered = manageableShifts.filter(s =>
      statusFilter === 'pending'
        ? s.status === 'pending'
        : statusFilter === 'tentative'
        ? s.status === 'tentative'
        : statusFilter === 'approved'
        ? s.status === 'approved'
        : s.status !== 'cancelled'
    );

    const arr = [...filtered];
    switch (sortKey) {
      case 'date_asc':
        return arr.sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));
      case 'date_desc':
        return arr.sort((a, b) => b.date.localeCompare(a.date) || a.start_time.localeCompare(b.start_time));
      case 'created_asc':
        return arr.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
      case 'created_desc':
        return arr.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
      default:
        return arr;
    }
  }, [manageableShifts, statusFilter, sortKey]);

  const PAGE_SIZE = 25;
  const [currentPage, setCurrentPage] = useState(1);
  
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, sortKey]);

  const totalPages = Math.ceil(displayedShifts.length / PAGE_SIZE);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const visibleShifts = displayedShifts.slice(startIndex, startIndex + PAGE_SIZE);

  const tentativeByStore = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of tentativeShifts) {
      if (s.store_id) {
        map.set(s.store_id, (map.get(s.store_id) ?? 0) + 1);
      }
    }
    return map;
  }, [tentativeShifts]);

  const handleAction = async (action: () => Promise<void>) => {
    setProcessing(true);
    setError(null);
    try {
      await action();
      onRefresh();
    } catch (err) {
      setError(formatSupabaseError(err).message);
    } finally {
      setProcessing(false);
    }
  };

  const handleModifyStart = (shift: Shift) => {
    setModifyingId(shift.id);
    setModStart(shift.start_time.slice(0, 5));
    setModEnd(shift.end_time.slice(0, 5));
  };

  const handleModifySubmit = async (shiftId: string) => {
    await handleAction(() => onModify(shiftId, modStart, modEnd));
    setModifyingId(null);
  };

  const handleBulkFinalApproveStore = async (storeId: string) => {
    if (!onFinalApproveStore || !tenantId) return;
    await handleAction(async () => {
      const result = await onFinalApproveStore(tenantId, storeId);
      const storeName = storeMap.get(storeId) ?? '不明店舗';
      onToast?.(`${storeName}の仮承認 ${result.approved_count} 件を本承認しました`, 'success');
    });
    setBulkConfirmingStoreId(null);
  };

  const renderBulkButton = () => {
    if (statusFilter === 'pending') return null;
    if (statusFilter !== 'tentative') return null;
    if (!onFinalApproveStore || !tenantId) return null;
    if (tentativeByStore.size === 0) return null;

    const buttons: React.ReactNode[] = [];

    for (const [storeId, count] of tentativeByStore.entries()) {
      const storeName = storeMap.get(storeId);
      if (!storeName || count < 1) continue;

      if (bulkConfirmingStoreId === storeId) {
        buttons.push(
          <div key={storeId} className="flex gap-2">
            <button
              onClick={() => handleBulkFinalApproveStore(storeId)}
              disabled={processing}
              aria-label={`${storeName} の仮承認 ${count}件を本承認する (確定)`}
              className="px-3 py-2 min-h-[44px] text-xs font-medium text-white bg-success-700 rounded-md hover:bg-success-800 dark:hover:bg-success-600 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo flex items-center"
            >
              {processing && <Spinner size="sm" inline className="mr-1" />}
              <span>{storeName} の仮承認 {count}件を本承認する</span>
            </button>
            <button
              onClick={() => setBulkConfirmingStoreId(null)}
              aria-label="一括本承認を取消"
              className="px-3 py-2 min-h-[44px] text-xs font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-600 motion-safe:transition-colors duration-120 ease-out-expo"
            >
              戻す
            </button>
          </div>
        );
      } else {
        buttons.push(
          <button
            key={storeId}
            onClick={() => setBulkConfirmingStoreId(storeId)}
            disabled={processing}
            aria-label={`${storeName} の仮承認 ${count}件を一括本承認`}
            className="px-3 py-2 min-h-[44px] text-xs font-medium text-white bg-success-600 rounded-md hover:bg-success-700 dark:hover:bg-success-500 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo flex items-center"
          >
            {processing && <Spinner size="sm" inline className="mr-1" />}
            <span>{storeName} の仮承認 {count}件を一括本承認</span>
          </button>
        );
      }
    }

    return <div className="flex flex-wrap items-center gap-2">{buttons}</div>;
  };

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between flex-wrap gap-2">
        <div>
          <Heading level={2}>シフト申請の承認</Heading>
          {pendingShifts.length > 0 && (
            <p className="text-sm text-neutral-500 dark:text-neutral-300 mt-0.5">{pendingShifts.length}件の承認待ち</p>
          )}
        </div>
        {renderBulkButton()}
      </div>

      <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-700">
        <div role="tablist" className="flex flex-1">
          <button
            onClick={() => setStatusFilter('pending')}
            aria-pressed={statusFilter === 'pending'}
            className={`flex-1 px-4 py-2 text-sm font-medium text-center motion-safe:transition-colors duration-120 ease-out-expo focus:outline-none ${
              statusFilter === 'pending'
                ? 'text-primary-600 border-b-2 border-primary-600 dark:text-primary-400 dark:border-primary-400'
                : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-300 dark:hover:text-neutral-200'
            }`}
          >
            申請中 ({pendingShifts.length})
          </button>
          <button
            onClick={() => setStatusFilter('tentative')}
            aria-pressed={statusFilter === 'tentative'}
            className={`flex-1 px-4 py-2 text-sm font-medium text-center motion-safe:transition-colors duration-120 ease-out-expo focus:outline-none ${
              statusFilter === 'tentative'
                ? 'text-primary-600 border-b-2 border-primary-600 dark:text-primary-400 dark:border-primary-400'
                : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-300 dark:hover:text-neutral-200'
            }`}
          >
            仮承認 ({tentativeShifts.length})
          </button>
          <button
            onClick={() => setStatusFilter('approved')}
            aria-pressed={statusFilter === 'approved'}
            className={`flex-1 px-4 py-2 text-sm font-medium text-center motion-safe:transition-colors duration-120 ease-out-expo focus:outline-none ${
              statusFilter === 'approved'
                ? 'text-primary-600 border-b-2 border-primary-600 dark:text-primary-400 dark:border-primary-400'
                : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-300 dark:hover:text-neutral-200'
            }`}
          >
            本承認 ({approvedShifts.length})
          </button>
          <button
            onClick={() => setStatusFilter('all')}
            aria-pressed={statusFilter === 'all'}
            className={`flex-1 px-4 py-2 text-sm font-medium text-center motion-safe:transition-colors duration-120 ease-out-expo focus:outline-none ${
              statusFilter === 'all'
                ? 'text-primary-600 border-b-2 border-primary-600 dark:text-primary-400 dark:border-primary-400'
                : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-300 dark:hover:text-neutral-200'
            }`}
          >
            すべて ({allShifts.length})
          </button>
        </div>
        <div className="px-4 py-2">
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label="並び順"
            className="text-xs border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 rounded px-2 py-1"
          >
            <option value="date_asc">日付↑</option>
            <option value="date_desc">日付↓</option>
            <option value="created_asc">申請日↑</option>
            <option value="created_desc">申請日↓</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 p-3 bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800 rounded-md">
          <p className="text-sm text-danger-600 dark:text-danger-400">{error}</p>
        </div>
      )}

      <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
        {displayedShifts.length === 0 ? (
          <EmptyState
            size="md"
            title={messages.empty.shiftRequest.title}
            description={messages.empty.shiftRequest.description}
          />
        ) : (
          visibleShifts.map((shift) => {
            const badge = STATUS_BADGE[shift.status] || STATUS_BADGE.pending;
            const isModifying = modifyingId === shift.id;
            const canManageRow = canManageStore(shift.store_id);
            const menuTitle = `${memberMap.get(shift.user_id) ?? '不明'} ${shift.date}`;

            let actionItems: ActionMenuItem[] = [];
            if (!isModifying && canManageRow) {
              if (shift.status === 'pending') {
                actionItems = [
                  { key: 'modify', label: '修正', onSelect: () => handleModifyStart(shift), tone: 'primary' },
                  { key: 'reject', label: '却下', onSelect: () => setConfirmingId({ id: shift.id, action: 'reject' }), tone: 'danger' }
                ];
              } else if (shift.status === 'tentative') {
                actionItems = [
                  { key: 'modify', label: '修正', onSelect: () => handleModifyStart(shift), tone: 'primary' },
                  { key: 'cancel-tentative', label: '差し戻し (申請中へ)', onSelect: () => setCancelingTentativeId(shift.id), tone: 'danger' },
                  { key: 'reject', label: '却下', onSelect: () => setConfirmingId({ id: shift.id, action: 'reject' }), tone: 'danger' }
                ];
              } else if (shift.status === 'approved') {
                actionItems = [];
                if (onRevertToTentative) {
                  actionItems.push({
                    key: 'revert-to-tentative',
                    label: '仮承認に戻す',
                    onSelect: () => setRevertingToTentativeId(shift.id),
                    tone: 'danger'
                  });
                }
                actionItems.push({
                  key: 'delete',
                  label: '削除',
                  onSelect: () => setDeletingId(shift.id),
                  tone: 'danger'
                });
              } else if (shift.status === 'rejected') {
                actionItems = [
                  { key: 'delete', label: '削除', onSelect: () => setDeletingId(shift.id), tone: 'danger' }
                ];
              } else if (shift.status === 'modified') {
                actionItems = [
                  { key: 'modify', label: '再修正', onSelect: () => handleModifyStart(shift), tone: 'primary' },
                  { key: 'reject', label: '却下', onSelect: () => setConfirmingId({ id: shift.id, action: 'reject' }), tone: 'danger' },
                  { key: 'delete', label: '削除', onSelect: () => setDeletingId(shift.id), tone: 'danger' }
                ];
              }
            }

            return (
              <div key={shift.id} className="px-4 sm:px-6 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-700 motion-safe:transition-colors duration-120 ease-out-expo">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {memberMap.get(shift.user_id) || '不明'}
                    </span>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                    {showStoreBadge && shift.store_id && (
                      <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-info-50 text-info-700 dark:bg-info-900/30 dark:text-info-300">
                        {storeMap.get(shift.store_id) ?? '不明店舗'}
                      </span>
                    )}
                    <span className="text-xs text-neutral-500 dark:text-neutral-300 ml-auto sm:ml-2">{shift.date}</span>
                  </div>
                </div>
                
                <div className="mt-1 flex items-center justify-between gap-2">
                  {isModifying ? (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-2">
                        <select
                          value={modStart}
                          onChange={(e) => setModStart(e.target.value)}
                          className="px-2 py-1 text-sm border border-primary-400 rounded bg-primary-50 dark:bg-primary-900 dark:text-white dark:border-neutral-600"
                        >
                          {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <span className="text-neutral-400 dark:text-neutral-500 hidden sm:inline">-</span>
                        <select
                          value={modEnd}
                          onChange={(e) => setModEnd(e.target.value)}
                          className="px-2 py-1 text-sm border border-primary-400 rounded bg-primary-50 dark:bg-primary-900 dark:text-white dark:border-neutral-600"
                        >
                          {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-2">
                        <button
                          onClick={() => handleModifySubmit(shift.id)}
                          disabled={processing}
                          className="px-2 py-1 min-h-[44px] text-xs font-medium text-white bg-primary-600 rounded hover:bg-primary-700 dark:hover:bg-primary-500 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo"
                        >
                          確定
                        </button>
                        <button
                          onClick={() => setModifyingId(null)}
                          className="px-2 py-1 min-h-[44px] text-xs font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 motion-safe:transition-colors duration-120 ease-out-expo"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-neutral-700 dark:text-neutral-300 tabular-nums">
                      {formatTimeRange(shift.start_time, shift.end_time, { separator: ' - ' })}
                      {shift.original_start_time && shift.original_end_time && (
                        <span className="text-xs text-neutral-400 dark:text-neutral-500 ml-2">
                          (元: {formatTimeRange(shift.original_start_time, shift.original_end_time)})
                        </span>
                      )}
                    </span>
                  )}

                  {!isModifying && canManageRow && shift.status === 'pending' && (
                    <div className="flex items-center gap-2">
                      {confirmingId?.id === shift.id && confirmingId.action === 'reject' ? (
                        <>
                          <button
                            onClick={() => { handleAction(() => onReject(shift.id)); setConfirmingId(null); }}
                            disabled={processing}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-white bg-danger-600 rounded hover:bg-danger-700 dark:hover:bg-danger-500 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            却下する
                          </button>
                          <button
                            onClick={() => setConfirmingId(null)}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            戻す
                          </button>
                        </>
                      ) : confirmingId?.id === shift.id && confirmingId.action === 'tentative' ? (
                        <>
                          <button
                            onClick={() => {
                              if (onTentativeApprove) {
                                handleAction(() => onTentativeApprove(shift.id));
                              }
                              setConfirmingId(null);
                            }}
                            disabled={processing || !onTentativeApprove}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-white bg-success-600 rounded hover:bg-success-700 dark:hover:bg-success-500 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            仮承認する
                          </button>
                          <button
                            onClick={() => setConfirmingId(null)}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            戻す
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setConfirmingId({ id: shift.id, action: 'tentative' })}
                            disabled={processing || !onTentativeApprove}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-white bg-success-600 rounded hover:bg-success-700 dark:hover:bg-success-500 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            仮承認
                          </button>
                          <ActionMenu items={actionItems} align="end" bottomSheetTitle={menuTitle} />
                        </>
                      )}
                    </div>
                  )}

                  {!isModifying && canManageRow && shift.status === 'tentative' && (
                    <div className="flex items-center gap-2">
                      {cancelingTentativeId === shift.id ? (
                        <>
                          <button
                            onClick={() => {
                              if (onCancelTentative) {
                                handleAction(() => onCancelTentative(shift.id));
                              }
                              setCancelingTentativeId(null);
                            }}
                            disabled={processing || !onCancelTentative}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-white bg-danger-600 rounded hover:bg-danger-700 dark:hover:bg-danger-500 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            差し戻す
                          </button>
                          <button
                            onClick={() => setCancelingTentativeId(null)}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            戻す
                          </button>
                        </>
                      ) : confirmingId?.id === shift.id && confirmingId.action === 'reject' ? (
                        <>
                          <button
                            onClick={() => { handleAction(() => onReject(shift.id)); setConfirmingId(null); }}
                            disabled={processing}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-white bg-danger-600 rounded hover:bg-danger-700 dark:hover:bg-danger-500 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            却下する
                          </button>
                          <button
                            onClick={() => setConfirmingId(null)}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            戻す
                          </button>
                        </>
                      ) : confirmingId?.id === shift.id && confirmingId.action === 'final-approve' ? (
                        <>
                          <button
                            onClick={() => { handleAction(() => onApprove(shift.id)); setConfirmingId(null); }}
                            disabled={processing}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-white bg-success-700 rounded hover:bg-success-800 dark:hover:bg-success-600 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            本承認する
                          </button>
                          <button
                            onClick={() => setConfirmingId(null)}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            戻す
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setConfirmingId({ id: shift.id, action: 'final-approve' })}
                            disabled={processing}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-white bg-success-700 rounded hover:bg-success-800 dark:hover:bg-success-600 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            本承認
                          </button>
                          <ActionMenu items={actionItems} align="end" bottomSheetTitle={menuTitle} />
                        </>
                      )}
                    </div>
                  )}

                  {!isModifying && canManageRow && shift.status === 'approved' && (
                    <div className="flex items-center gap-2">
                      {deletingId === shift.id ? (
                        <>
                          <button
                            onClick={() => { handleAction(() => onDelete(shift.id)); setDeletingId(null); }}
                            disabled={processing}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-white bg-danger-600 rounded hover:bg-danger-700 dark:hover:bg-danger-500 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            削除する
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            戻す
                          </button>
                        </>
                      ) : revertingToTentativeId === shift.id ? (
                        <>
                          <button
                            onClick={() => {
                              if (onRevertToTentative) {
                                handleAction(() => onRevertToTentative(shift.id));
                              }
                              setRevertingToTentativeId(null);
                            }}
                            disabled={processing || !onRevertToTentative}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-white bg-warning-600 rounded hover:bg-warning-700 dark:hover:bg-warning-500 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            仮承認に戻す
                          </button>
                          <button
                            onClick={() => setRevertingToTentativeId(null)}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            戻す
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            disabled
                            title="本承認後は修正不可"
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 rounded opacity-50 cursor-not-allowed"
                          >
                            修正
                          </button>
                          <ActionMenu items={actionItems} align="end" bottomSheetTitle={menuTitle} />
                        </>
                      )}
                    </div>
                  )}

                  {!isModifying && canManageRow && shift.status === 'rejected' && (
                    <div className="flex items-center gap-2">
                      {deletingId === shift.id ? (
                        <>
                          <button
                            onClick={() => { handleAction(() => onDelete(shift.id)); setDeletingId(null); }}
                            disabled={processing}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-white bg-danger-600 rounded hover:bg-danger-700 dark:hover:bg-danger-500 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            削除する
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            戻す
                          </button>
                        </>
                      ) : confirmingId?.id === shift.id && confirmingId.action === 'restore' ? (
                        <>
                          <button
                            onClick={() => { handleAction(async () => { if (onRestore) await onRestore(shift.id); }); setConfirmingId(null); }}
                            disabled={processing || !onRestore}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-white bg-success-600 rounded hover:bg-success-700 dark:hover:bg-success-500 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            復活承認する
                          </button>
                          <button
                            onClick={() => setConfirmingId(null)}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            戻す
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setConfirmingId({ id: shift.id, action: 'restore' })}
                            disabled={processing}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-white bg-success-600 rounded hover:bg-success-700 dark:hover:bg-success-500 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            復活承認
                          </button>
                          <ActionMenu items={actionItems} align="end" bottomSheetTitle={menuTitle} />
                        </>
                      )}
                    </div>
                  )}

                  {!isModifying && canManageRow && shift.status === 'modified' && (
                    <div className="flex items-center gap-2">
                      {deletingId === shift.id ? (
                        <>
                          <button
                            onClick={() => { handleAction(() => onDelete(shift.id)); setDeletingId(null); }}
                            disabled={processing}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-white bg-danger-600 rounded hover:bg-danger-700 dark:hover:bg-danger-500 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            削除する
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            戻す
                          </button>
                        </>
                      ) : confirmingId?.id === shift.id && confirmingId.action === 'tentative' ? (
                        <>
                          <button
                            onClick={() => {
                              if (onTentativeApprove) {
                                handleAction(() => onTentativeApprove(shift.id));
                              }
                              setConfirmingId(null);
                            }}
                            disabled={processing || !onTentativeApprove}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-white bg-success-600 rounded hover:bg-success-700 dark:hover:bg-success-500 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            仮承認する
                          </button>
                          <button
                            onClick={() => setConfirmingId(null)}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            戻す
                          </button>
                        </>
                      ) : confirmingId?.id === shift.id && confirmingId.action === 'reject' ? (
                        <>
                          <button
                            onClick={() => { handleAction(() => onReject(shift.id)); setConfirmingId(null); }}
                            disabled={processing}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-white bg-danger-600 rounded hover:bg-danger-700 dark:hover:bg-danger-500 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            却下する
                          </button>
                          <button
                            onClick={() => setConfirmingId(null)}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            戻す
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setConfirmingId({ id: shift.id, action: 'tentative' })}
                            disabled={processing || !onTentativeApprove}
                            className="px-3 py-2 min-h-[44px] text-sm font-medium text-white bg-success-600 rounded hover:bg-success-700 dark:hover:bg-success-500 disabled:opacity-50 motion-safe:transition-colors duration-120 ease-out-expo"
                          >
                            仮承認
                          </button>
                          <ActionMenu items={actionItems} align="end" bottomSheetTitle={menuTitle} />
                        </>
                      )}
                    </div>
                  )}

                  {!isModifying && !canManageRow && (
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">権限なし</span>
                  )}
                </div>

                {shift.note && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-300 mt-1">{shift.note}</p>
                )}
              </div>
            );
          })
        )}
      </div>

      {displayedShifts.length > PAGE_SIZE && (
        <div className="px-6 py-3 border-t border-neutral-200 dark:border-neutral-700 flex items-center justify-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
          <button
            type="button"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1 text-xs font-medium border border-neutral-300 dark:border-neutral-600 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-colors duration-120 ease-out-expo"
          >
            前
          </button>
          <span className="font-medium tabular-nums">
            {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-3 py-1 text-xs font-medium border border-neutral-300 dark:border-neutral-600 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-colors duration-120 ease-out-expo"
          >
            次
          </button>
        </div>
      )}
    </div>
  );
}
