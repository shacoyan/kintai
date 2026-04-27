import { useState, useMemo, useEffect } from 'react';
import type { Shift, TenantMember } from '../../types';
import { formatSupabaseError } from '../../lib/errors';
import { Loader2 } from 'lucide-react';

interface ShiftAdminPanelProps {
  shifts: Shift[];
  members: TenantMember[];
  onApprove: (shiftId: string) => Promise<void>;
  onReject: (shiftId: string) => Promise<void>;
  onModify: (shiftId: string, startTime: string, endTime: string, storeId?: string) => Promise<void>;
  onBulkApprove: (shiftIds: string[]) => Promise<void>;
  onDelete: (shiftId: string) => Promise<void>;
  onRefresh: () => void;
  canManageStore: (storeId: string | null) => boolean;
  stores?: { id: string; name: string }[];
}

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '15', '30', '45']) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`);
  }
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: '申請中', className: 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-300' },
  approved: { label: '承認済', className: 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300' },
  rejected: { label: '却下', className: 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-300' },
  modified: { label: '修正', className: 'bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-300' },
};

type SortKey = 'date_asc' | 'date_desc' | 'created_asc' | 'created_desc';

export function ShiftAdminPanel({ shifts, members, onApprove, onReject, onModify, onBulkApprove, onDelete, onRefresh, canManageStore, stores }: ShiftAdminPanelProps) {
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'all'>('pending');
  const [modifyingId, setModifyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [modStart, setModStart] = useState('');
  const [modEnd, setModEnd] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('date_desc');
  const [confirmingId, setConfirmingId] = useState<{ id: string; action: 'approve' | 'reject' | 'restore' } | null>(null);
  const [bulkConfirming, setBulkConfirming] = useState(false);

  const memberMap = new Map(members.map(m => [m.user_id, m.display_name]));
  const storeMap = useMemo(() => new Map((stores ?? []).map(s => [s.id, s.name])), [stores]);
  const showStoreBadge = (stores?.length ?? 0) >= 2;

  const manageableShifts = shifts.filter(s => canManageStore(s.store_id));

  const approvedShifts = useMemo(() => manageableShifts.filter(s => s.status === 'approved'), [manageableShifts]);
  const allShifts = useMemo(() => manageableShifts.filter(s => s.status !== 'cancelled'), [manageableShifts]);
  const pendingShifts = manageableShifts.filter(s => s.status === 'pending');

  const displayedShifts = useMemo(() => {
    const filtered = shifts.filter(s =>
      statusFilter === 'pending'
        ? s.status === 'pending'
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
  }, [shifts, statusFilter, sortKey]);

  const PAGE_SIZE = 25;
  const [currentPage, setCurrentPage] = useState(1);
  
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, sortKey]);

  const totalPages = Math.ceil(displayedShifts.length / PAGE_SIZE);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const visibleShifts = displayedShifts.slice(startIndex, startIndex + PAGE_SIZE);

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

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">シフト承認</h2>
          {pendingShifts.length > 0 && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">{pendingShifts.length}件の承認待ち</p>
          )}
        </div>
        {pendingShifts.length > 0 && (
          bulkConfirming ? (
            <div className="flex gap-1.5">
              <button
                onClick={() => { handleAction(() => onBulkApprove(pendingShifts.map(s => s.id))); setBulkConfirming(false); }}
                disabled={processing}
                className="px-3 py-1.5 text-xs font-medium text-white bg-success-700 rounded-md hover:bg-success-800 disabled:opacity-50 transition flex items-center"
              >
                {processing && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                <span>{pendingShifts.length}件 承認する</span>
              </button>
              <button
                onClick={() => setBulkConfirming(false)}
                className="px-3 py-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-600 transition"
              >
                戻す
              </button>
            </div>
          ) : (
            <button
              onClick={() => setBulkConfirming(true)}
              disabled={processing}
              className="px-3 py-1.5 text-xs font-medium text-white bg-success-600 rounded-md hover:bg-success-700 disabled:opacity-50 transition flex items-center"
            >
              {processing && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              <span>一括承認</span>
              <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-success-500 rounded-full tabular-nums">{pendingShifts.length}</span>
            </button>
          )
        )}
      </div>

      <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-700">
        <div role="tablist" className="flex flex-1">
          <button
            onClick={() => setStatusFilter('pending')}
            aria-pressed={statusFilter === 'pending'}
            className={`flex-1 px-4 py-2 text-sm font-medium text-center transition-colors focus:outline-none ${
              statusFilter === 'pending'
                ? 'text-primary-600 border-b-2 border-primary-600 dark:text-primary-400 dark:border-primary-400'
                : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            申請中 ({pendingShifts.length})
          </button>
          <button
            onClick={() => setStatusFilter('approved')}
            aria-pressed={statusFilter === 'approved'}
            className={`flex-1 px-4 py-2 text-sm font-medium text-center transition-colors focus:outline-none ${
              statusFilter === 'approved'
                ? 'text-primary-600 border-b-2 border-primary-600 dark:text-primary-400 dark:border-primary-400'
                : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            承認済 ({approvedShifts.length})
          </button>
          <button
            onClick={() => setStatusFilter('all')}
            aria-pressed={statusFilter === 'all'}
            className={`flex-1 px-4 py-2 text-sm font-medium text-center transition-colors focus:outline-none ${
              statusFilter === 'all'
                ? 'text-primary-600 border-b-2 border-primary-600 dark:text-primary-400 dark:border-primary-400'
                : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
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
        <div className="mx-6 mt-4 p-3 bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-neutral-700 rounded-md">
          <p className="text-sm text-danger-600 dark:text-danger-400">{error}</p>
        </div>
      )}

      <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
        {displayedShifts.length === 0 ? (
          <div className="px-6 py-8 text-center text-neutral-500 dark:text-neutral-400">シフト申請はありません</div>
        ) : (
          visibleShifts.map((shift) => {
            const badge = STATUS_BADGE[shift.status] || STATUS_BADGE.pending;
            const isModifying = modifyingId === shift.id;
            const canManageRow = canManageStore(shift.store_id);

            return (
              <div key={shift.id} className="px-4 sm:px-6 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors">
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
                    <span className="text-xs text-neutral-500 dark:text-neutral-400 ml-auto sm:ml-2">{shift.date}</span>
                  </div>
                </div>
                
                <div className="mt-1 flex items-center justify-between gap-2">
                  {isModifying ? (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-2">
                        <select
                          value={modStart}
                          onChange={(e) => setModStart(e.target.value)}
                          className="px-2 py-1 text-sm border border-primary-400 rounded bg-primary-50 dark:bg-neutral-700 dark:text-white dark:border-neutral-600"
                        >
                          {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <span className="text-neutral-400 hidden sm:inline">-</span>
                        <select
                          value={modEnd}
                          onChange={(e) => setModEnd(e.target.value)}
                          className="px-2 py-1 text-sm border border-primary-400 rounded bg-primary-50 dark:bg-neutral-700 dark:text-white dark:border-neutral-600"
                        >
                          {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-2">
                        <button
                          onClick={() => handleModifySubmit(shift.id)}
                          disabled={processing}
                          className="px-2 py-1 min-h-[44px] text-xs font-medium text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50 transition"
                        >
                          確定
                        </button>
                        <button
                          onClick={() => setModifyingId(null)}
                          className="px-2 py-1 min-h-[44px] text-xs font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 transition"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-neutral-700 dark:text-neutral-300 tabular-nums">
                      {shift.start_time.slice(0, 5)} - {shift.end_time.slice(0, 5)}
                      {shift.original_start_time && (
                        <span className="text-xs text-neutral-400 ml-2">
                          (元: {shift.original_start_time.slice(0, 5)}-{shift.original_end_time?.slice(0, 5)})
                        </span>
                      )}
                    </span>
                  )}

                  {!isModifying && canManageRow && shift.status === 'pending' && (
                    <div className="flex gap-1.5">
                      {confirmingId?.id === shift.id && confirmingId.action === 'approve' ? (
                        <>
                          <button
                            onClick={() => { handleAction(() => onApprove(shift.id)); setConfirmingId(null); }}
                            disabled={processing}
                            className="px-2.5 py-1 text-xs font-medium text-white bg-success-600 rounded hover:bg-success-700 disabled:opacity-50 transition"
                          >
                            承認する
                          </button>
                          <button
                            onClick={() => setConfirmingId(null)}
                            className="px-2.5 py-1 text-xs font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 transition"
                          >
                            戻す
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmingId({ id: shift.id, action: 'approve' })}
                          disabled={processing}
                          className="px-2.5 py-1 text-xs font-medium text-white bg-success-600 rounded hover:bg-success-700 disabled:opacity-50 transition"
                        >
                          承認
                        </button>
                      )}
                      <button
                        onClick={() => handleModifyStart(shift)}
                        disabled={processing}
                        className="px-2.5 py-1 text-xs font-medium text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 rounded hover:bg-primary-100 dark:hover:bg-primary-900/50 disabled:opacity-50 transition"
                      >
                        修正
                      </button>
                      {confirmingId?.id === shift.id && confirmingId.action === 'reject' ? (
                        <>
                          <button
                            onClick={() => { handleAction(() => onReject(shift.id)); setConfirmingId(null); }}
                            disabled={processing}
                            className="px-2.5 py-1 text-xs font-medium text-white bg-danger-600 rounded hover:bg-danger-700 disabled:opacity-50 transition"
                          >
                            却下する
                          </button>
                          <button
                            onClick={() => setConfirmingId(null)}
                            className="px-2.5 py-1 text-xs font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 transition"
                          >
                            戻す
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmingId({ id: shift.id, action: 'reject' })}
                          disabled={processing}
                          className="px-2.5 py-1 text-xs font-medium text-danger-600 dark:text-danger-400 bg-danger-50 dark:bg-danger-900/20 rounded hover:bg-danger-100 dark:hover:bg-danger-900/30 disabled:opacity-50 transition"
                        >
                          却下
                        </button>
                      )}
                    </div>
                  )}

                  {!isModifying && canManageRow && shift.status === 'approved' && (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleModifyStart(shift)}
                        disabled={processing}
                        className="px-2.5 py-1 text-xs font-medium text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 rounded hover:bg-primary-100 dark:hover:bg-primary-900/50 disabled:opacity-50 transition"
                      >
                        修正
                      </button>
                      {deletingId === shift.id ? (
                        <>
                          <button
                            onClick={() => { handleAction(() => onDelete(shift.id)); setDeletingId(null); }}
                            disabled={processing}
                            className="px-2.5 py-1 text-xs font-medium text-white bg-danger-600 rounded hover:bg-danger-700 disabled:opacity-50 transition"
                          >
                            削除する
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            className="px-2.5 py-1 text-xs font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 transition"
                          >
                            戻す
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setDeletingId(shift.id)}
                          className="px-2.5 py-1 text-xs font-medium text-danger-600 dark:text-danger-400 bg-danger-50 dark:bg-danger-900/20 rounded hover:bg-danger-100 dark:hover:bg-danger-900/30 transition"
                        >
                          削除
                        </button>
                      )}
                    </div>
                  )}

                  {!isModifying && canManageRow && shift.status === 'rejected' && (
                    <div className="flex gap-1.5">
                      {confirmingId?.id === shift.id && confirmingId.action === 'restore' ? (
                        <>
                          <button
                            onClick={() => { handleAction(() => onApprove(shift.id)); setConfirmingId(null); }}
                            disabled={processing}
                            className="px-2.5 py-1 text-xs font-medium text-white bg-success-600 rounded hover:bg-success-700 disabled:opacity-50 transition"
                          >
                            復活承認する
                          </button>
                          <button
                            onClick={() => setConfirmingId(null)}
                            className="px-2.5 py-1 text-xs font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 transition"
                          >
                            戻す
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmingId({ id: shift.id, action: 'restore' })}
                          disabled={processing}
                          className="px-2.5 py-1 text-xs font-medium text-white bg-success-600 rounded hover:bg-success-700 disabled:opacity-50 transition"
                        >
                          復活承認
                        </button>
                      )}
                      {deletingId === shift.id ? (
                        <>
                          <button
                            onClick={() => { handleAction(() => onDelete(shift.id)); setDeletingId(null); }}
                            disabled={processing}
                            className="px-2.5 py-1 text-xs font-medium text-white bg-danger-600 rounded hover:bg-danger-700 disabled:opacity-50 transition"
                          >
                            削除する
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            className="px-2.5 py-1 text-xs font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 transition"
                          >
                            戻す
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setDeletingId(shift.id)}
                          className="px-2.5 py-1 text-xs font-medium text-danger-600 dark:text-danger-400 bg-danger-50 dark:bg-danger-900/20 rounded hover:bg-danger-100 dark:hover:bg-danger-900/30 transition"
                        >
                          削除
                        </button>
                      )}
                    </div>
                  )}

                  {!isModifying && canManageRow && shift.status === 'modified' && (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleModifyStart(shift)}
                        disabled={processing}
                        className="px-2.5 py-1 text-xs font-medium text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 rounded hover:bg-primary-100 dark:hover:bg-primary-900/50 disabled:opacity-50 transition"
                      >
                        再修正
                      </button>
                      {deletingId === shift.id ? (
                        <>
                          <button
                            onClick={() => { handleAction(() => onDelete(shift.id)); setDeletingId(null); }}
                            disabled={processing}
                            className="px-2.5 py-1 text-xs font-medium text-white bg-danger-600 rounded hover:bg-danger-700 disabled:opacity-50 transition"
                          >
                            削除する
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            className="px-2.5 py-1 text-xs font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 transition"
                          >
                            戻す
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setDeletingId(shift.id)}
                          className="px-2.5 py-1 text-xs font-medium text-danger-600 dark:text-danger-400 bg-danger-50 dark:bg-danger-900/20 rounded hover:bg-danger-100 dark:hover:bg-danger-900/30 transition"
                        >
                          削除
                        </button>
                      )}
                    </div>
                  )}

                  {!isModifying && !canManageRow && (
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">権限なし</span>
                  )}
                </div>

                {shift.note && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">{shift.note}</p>
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
            className="px-3 py-1 text-xs font-medium border border-neutral-300 dark:border-neutral-600 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
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
            className="px-3 py-1 text-xs font-medium border border-neutral-300 dark:border-neutral-600 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            次
          </button>
        </div>
      )}
    </div>
  );
}
