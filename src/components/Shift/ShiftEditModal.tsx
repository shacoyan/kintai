import { useState } from 'react';
import type { Shift } from '../../types';

interface ShiftEditModalProps {
  shift: Shift;
  memberName?: string;
  isAdmin: boolean;
  onModify: (shiftId: string, startTime: string, endTime: string) => Promise<void>;
  onDelete: (shiftId: string) => Promise<void>;
  onApprove?: (shiftId: string) => Promise<void>;
  onReject?: (shiftId: string) => Promise<void>;
  onClose: () => void;
  onRefresh: () => void;
}

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '15', '30', '45']) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`);
  }
}

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  pending: { text: '申請中', className: 'bg-yellow-100 text-yellow-800' },
  approved: { text: '承認済', className: 'bg-green-100 text-green-800' },
  rejected: { text: '却下', className: 'bg-red-100 text-red-800' },
  modified: { text: '修正済', className: 'bg-blue-100 text-blue-800' },
  cancelled: { text: '取消', className: 'bg-gray-100 text-gray-500' },
};

export function ShiftEditModal({ shift, memberName, isAdmin, onModify, onDelete, onApprove, onReject, onClose, onRefresh }: ShiftEditModalProps) {
  const [startTime, setStartTime] = useState(shift.start_time.slice(0, 5));
  const [endTime, setEndTime] = useState(shift.end_time.slice(0, 5));
  const [mode, setMode] = useState<'view' | 'edit' | 'confirmDelete'>('view');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAction = async (action: () => Promise<void>) => {
    setProcessing(true);
    setError(null);
    try {
      await action();
      onRefresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作に失敗しました');
    } finally {
      setProcessing(false);
    }
  };

  const status = STATUS_LABEL[shift.status] || STATUS_LABEL.pending;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-sm mx-4 bg-white rounded-lg shadow-xl" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">{shift.date} のシフト</h3>
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
              {status.text}
            </span>
          </div>
          {memberName && (
            <p className="text-xs text-gray-500 mt-1">{memberName}</p>
          )}
        </div>

        {error && (
          <div className="mx-5 mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">{error}</div>
        )}

        <div className="px-5 py-4 space-y-4">
          {mode === 'view' && (
            <>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-xs text-gray-500">開始</p>
                  <p className="text-lg font-semibold text-gray-900">{shift.start_time.slice(0, 5)}</p>
                </div>
                <span className="text-gray-400">→</span>
                <div className="flex-1">
                  <p className="text-xs text-gray-500">終了</p>
                  <p className="text-lg font-semibold text-gray-900">{shift.end_time.slice(0, 5)}</p>
                </div>
              </div>
              {shift.note && (
                <p className="text-xs text-gray-500">メモ: {shift.note}</p>
              )}

              <div className="flex flex-wrap gap-2">
                {isAdmin && shift.status === 'pending' && onApprove && (
                  <button
                    onClick={() => handleAction(() => onApprove(shift.id))}
                    disabled={processing}
                    className="flex-1 px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 transition"
                  >
                    承認
                  </button>
                )}
                {isAdmin && shift.status === 'pending' && onReject && (
                  <button
                    onClick={() => handleAction(() => onReject(shift.id))}
                    disabled={processing}
                    className="px-3 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 disabled:opacity-50 transition"
                  >
                    却下
                  </button>
                )}
                {isAdmin && (
                  <button
                    onClick={() => setMode('edit')}
                    className="px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition"
                  >
                    修正
                  </button>
                )}
                {isAdmin && (
                  <button
                    onClick={() => setMode('confirmDelete')}
                    className="px-3 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition"
                  >
                    削除
                  </button>
                )}
              </div>
            </>
          )}

          {mode === 'edit' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">開始時刻</label>
                  <select
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">終了時刻</label>
                  <select
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleAction(() => onModify(shift.id, startTime, endTime))}
                  disabled={processing}
                  className="flex-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  {processing ? '処理中...' : '修正を確定'}
                </button>
                <button
                  onClick={() => setMode('view')}
                  className="px-3 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition"
                >
                  戻る
                </button>
              </div>
            </>
          )}

          {mode === 'confirmDelete' && (
            <>
              <p className="text-sm text-gray-700">このシフトを削除しますか？この操作は元に戻せません。</p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleAction(() => onDelete(shift.id))}
                  disabled={processing}
                  className="flex-1 px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 transition"
                >
                  {processing ? '処理中...' : '削除する'}
                </button>
                <button
                  onClick={() => setMode('view')}
                  className="px-3 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition"
                >
                  戻る
                </button>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <button
            onClick={onClose}
            className="w-full px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
