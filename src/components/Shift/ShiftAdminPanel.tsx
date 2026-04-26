import { useState } from 'react';
import type { Shift, TenantMember } from '../../types';
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
  canManage: (storeId: string | null) => boolean;
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

export function ShiftAdminPanel({ shifts, members, onApprove, onReject, onModify, onBulkApprove, onDelete, onRefresh, canManage }: ShiftAdminPanelProps) {
  const [modifyingId, setModifyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [modStart, setModStart] = useState('');
  const [modEnd, setModEnd] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const memberMap = new Map(members.map(m => [m.user_id, m.display_name]));
  const manageableShifts = shifts.filter(s => canManage(s.store_id));
  const pendingShifts = manageableShifts.filter(s => s.status === 'pending');

  const handleAction = async (action: () => Promise<void>) => {
    setProcessing(true);
    setError(null);
    try {
      await action();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作に失敗しました');
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
          <button
            onClick={() => handleAction(() => onBulkApprove(pendingShifts.map(s => s.id)))}
            disabled={processing}
            className="px-3 py-1.5 text-xs font-medium text-white bg-success-600 rounded-md hover:bg-success-700 disabled:opacity-50 transition flex items-center"
          >
            {processing && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
            <span>一括承認</span>
            <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-success-500 rounded-full tabular-nums">{pendingShifts.length}</span>
          </button>
        )}
      </div>

      {error && (
        <div className="mx-6 mt-4 p-3 bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-neutral-700 rounded-md">
          <p className="text-sm text-danger-600 dark:text-danger-400">{error}</p>
        </div>
      )}

      <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
        {shifts.length === 0 ? (
          <div className="px-6 py-8 text-center text-neutral-500 dark:text-neutral-400">シフト申請はありません</div>
        ) : (
          shifts.map((shift) => {
            const badge = STATUS_BADGE[shift.status] || STATUS_BADGE.pending;
            const isModifying = modifyingId === shift.id;
            const canManageRow = canManage(shift.store_id);

            return (
              <div key={shift.id} className="px-6 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {memberMap.get(shift.user_id) || '不明'}
                    </span>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">{shift.date}</span>
                </div>

                <div className="flex items-center justify-between">
                  {isModifying ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={modStart}
                        onChange={(e) => setModStart(e.target.value)}
                        className="px-2 py-1 text-sm border border-primary-400 rounded bg-primary-50 dark:bg-neutral-700 dark:text-white dark:border-neutral-600"
                      >
                        {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <span className="text-neutral-400">-</span>
                      <select
                        value={modEnd}
                        onChange={(e) => setModEnd(e.target.value)}
                        className="px-2 py-1 text-sm border border-primary-400 rounded bg-primary-50 dark:bg-neutral-700 dark:text-white dark:border-neutral-600"
                      >
                        {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <button
                        onClick={() => handleModifySubmit(shift.id)}
                        disabled={processing}
                        className="px-2 py-1 text-xs font-medium text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50 transition"
                      >
                        確定
                      </button>
                      <button
                        onClick={() => setModifyingId(null)}
                        className="px-2 py-1 text-xs font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 transition"
                      >
                        取消
                      </button>
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

                  {shift.status === 'pending' && !isModifying && canManageRow && (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleAction(() => onApprove(shift.id))}
                        disabled={processing}
                        className="px-2.5 py-1 text-xs font-medium text-white bg-success-600 rounded hover:bg-success-700 disabled:opacity-50 transition"
                      >
                        承認
                      </button>
                      <button
                        onClick={() => handleModifyStart(shift)}
                        disabled={processing}
                        className="px-2.5 py-1 text-xs font-medium text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 rounded hover:bg-primary-100 dark:hover:bg-primary-900/50 disabled:opacity-50 transition"
                      >
                        修正
                      </button>
                      <button
                        onClick={() => handleAction(() => onReject(shift.id))}
                        disabled={processing}
                        className="px-2.5 py-1 text-xs font-medium text-danger-600 dark:text-danger-400 bg-danger-50 dark:bg-danger-900/20 rounded hover:bg-danger-100 dark:hover:bg-danger-900/30 disabled:opacity-50 transition"
                      >
                        却下
                      </button>
                    </div>
                  )}

                  {shift.status !== 'pending' && !isModifying && canManageRow && (
                    <div className="flex gap-1.5">
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
    </div>
  );
}
