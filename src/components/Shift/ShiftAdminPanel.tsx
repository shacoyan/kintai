import { useState } from 'react';
import type { Shift, TenantMember } from '../../types';
import { Loader2 } from 'lucide-react';

interface ShiftAdminPanelProps {
  shifts: Shift[];
  members: TenantMember[];
  onApprove: (shiftId: string) => Promise<void>;
  onReject: (shiftId: string) => Promise<void>;
  onModify: (shiftId: string, startTime: string, endTime: string) => Promise<void>;
  onBulkApprove: (shiftIds: string[]) => Promise<void>;
  onDelete: (shiftId: string) => Promise<void>;
  onRefresh: () => void;
}

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '15', '30', '45']) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`);
  }
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: '申請中', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
  approved: { label: '承認済', className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  rejected: { label: '却下', className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  modified: { label: '修正', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
};

export function ShiftAdminPanel({ shifts, members, onApprove, onReject, onModify, onBulkApprove, onDelete, onRefresh }: ShiftAdminPanelProps) {
  const [modifyingId, setModifyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [modStart, setModStart] = useState('');
  const [modEnd, setModEnd] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const memberMap = new Map(members.map(m => [m.user_id, m.display_name]));
  const pendingShifts = shifts.filter(s => s.status === 'pending');

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
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">シフト承認</h2>
          {pendingShifts.length > 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{pendingShifts.length}件の承認待ち</p>
          )}
        </div>
        {pendingShifts.length > 0 && (
          <button
            onClick={() => handleAction(() => onBulkApprove(pendingShifts.map(s => s.id)))}
            disabled={processing}
            className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 transition flex items-center"
          >
            {processing && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
            <span>一括承認</span>
            <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-green-500 rounded-full tabular-nums">{pendingShifts.length}</span>
          </button>
        )}
      </div>

      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-gray-700 rounded-md">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {shifts.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">シフト申請はありません</div>
        ) : (
          shifts.map((shift) => {
            const badge = STATUS_BADGE[shift.status] || STATUS_BADGE.pending;
            const isModifying = modifyingId === shift.id;

            return (
              <div key={shift.id} className="px-6 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {memberMap.get(shift.user_id) || '不明'}
                    </span>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{shift.date}</span>
                </div>

                <div className="flex items-center justify-between">
                  {isModifying ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={modStart}
                        onChange={(e) => setModStart(e.target.value)}
                        className="px-2 py-1 text-sm border border-blue-400 rounded bg-blue-50 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                      >
                        {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <span className="text-gray-400">-</span>
                      <select
                        value={modEnd}
                        onChange={(e) => setModEnd(e.target.value)}
                        className="px-2 py-1 text-sm border border-blue-400 rounded bg-blue-50 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                      >
                        {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <button
                        onClick={() => handleModifySubmit(shift.id)}
                        disabled={processing}
                        className="px-2 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 transition"
                      >
                        確定
                      </button>
                      <button
                        onClick={() => setModifyingId(null)}
                        className="px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <span className="text-sm text-gray-700 dark:text-gray-300 tabular-nums">
                      {shift.start_time.slice(0, 5)} - {shift.end_time.slice(0, 5)}
                      {shift.original_start_time && (
                        <span className="text-xs text-gray-400 ml-2">
                          (元: {shift.original_start_time.slice(0, 5)}-{shift.original_end_time?.slice(0, 5)})
                        </span>
                      )}
                    </span>
                  )}

                  {shift.status === 'pending' && !isModifying && (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleAction(() => onApprove(shift.id))}
                        disabled={processing}
                        className="px-2.5 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50 transition"
                      >
                        承認
                      </button>
                      <button
                        onClick={() => handleModifyStart(shift)}
                        disabled={processing}
                        className="px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50 transition"
                      >
                        修正
                      </button>
                      <button
                        onClick={() => handleAction(() => onReject(shift.id))}
                        disabled={processing}
                        className="px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 transition"
                      >
                        却下
                      </button>
                    </div>
                  )}

                  {shift.status !== 'pending' && !isModifying && (
                    <div className="flex gap-1.5">
                      {deletingId === shift.id ? (
                        <>
                          <button
                            onClick={() => { handleAction(() => onDelete(shift.id)); setDeletingId(null); }}
                            disabled={processing}
                            className="px-2.5 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-50 transition"
                          >
                            削除する
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            className="px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition"
                          >
                            戻す
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setDeletingId(shift.id)}
                          className="px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition"
                        >
                          削除
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {shift.note && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{shift.note}</p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
