import { useState, useEffect } from 'react';
import { useCorrection } from '../../hooks/useCorrection';
import { format, parseISO } from 'date-fns';

interface CorrectionFormProps {
  isOpen: boolean;
  onClose: () => void;
  date: string;
  tenantId: string;
  attendanceRecordId?: string;
  existingClockIn?: string;
  existingClockOut?: string;
  mode?: 'correction' | 'delete';
}

export function CorrectionForm({
  isOpen,
  onClose,
  date,
  tenantId,
  attendanceRecordId,
  existingClockIn,
  existingClockOut,
  mode = 'correction',
}: CorrectionFormProps) {
  const { submitRequest } = useCorrection(tenantId);

  const toTimeValue = (iso: string | undefined) => {
    if (!iso) return '';
    try {
      return format(parseISO(iso), 'HH:mm');
    } catch {
      return '';
    }
  };

  const [requestedClockIn, setRequestedClockIn] = useState('');
  const [requestedClockOut, setRequestedClockOut] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens with new props
  useEffect(() => {
    if (isOpen) {
      setRequestedClockIn(toTimeValue(existingClockIn));
      setRequestedClockOut(toTimeValue(existingClockOut));
      setReason('');
      setError(null);
    }
  }, [isOpen, existingClockIn, existingClockOut]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, submitting, onClose]);

  if (!isOpen) return null;

  const isDelete = mode === 'delete';

  const buildTimestamps = () => {
    if (!requestedClockIn && !requestedClockOut) return { clockIn: undefined, clockOut: undefined };

    const clockInISO = requestedClockIn
      ? new Date(`${date}T${requestedClockIn}:00+09:00`).toISOString()
      : undefined;

    let clockOutISO: string | undefined;
    if (requestedClockOut) {
      const outDate = new Date(`${date}T${requestedClockOut}:00+09:00`);
      // 退勤時刻が出勤時刻より前なら翌日とみなす（例: 出勤22:00 → 退勤05:00）
      if (requestedClockIn && requestedClockOut < requestedClockIn) {
        outDate.setDate(outDate.getDate() + 1);
      }
      clockOutISO = outDate.toISOString();
    }

    return { clockIn: clockInISO, clockOut: clockOutISO };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('理由を入力してください');
      return;
    }

    if (!isDelete && !requestedClockIn && !requestedClockOut) {
      setError('出勤時刻または退勤時刻を入力してください');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const { clockIn, clockOut } = isDelete
        ? { clockIn: undefined, clockOut: undefined }
        : buildTimestamps();

      await submitRequest({
        date,
        attendance_record_id: attendanceRecordId,
        requested_clock_in: clockIn,
        requested_clock_out: clockOut,
        reason: reason.trim(),
        request_type: mode,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '申請の送信に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={submitting ? undefined : onClose} aria-hidden="false">
      <div role="dialog" aria-modal="true" aria-label={isDelete ? '勤怠削除依頼' : '勤怠修正申請'} className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">
            {isDelete ? '勤怠削除依頼' : '勤怠修正申請'}
          </h2>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label="閉じる"
            className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600">
            対象日: <span className="font-medium text-gray-900">{date}</span>
          </p>
          {isDelete && (
            <p className="text-sm text-red-600 mt-1">
              この勤怠記録の削除を管理者に依頼します
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isDelete && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">出勤時刻</label>
                <input
                  type="time"
                  value={requestedClockIn}
                  onChange={(e) => setRequestedClockIn(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  退勤時刻
                  {requestedClockIn && requestedClockOut && requestedClockOut < requestedClockIn && (
                    <span className="ml-2 text-xs text-amber-600 font-normal">（翌日）</span>
                  )}
                </label>
                <input
                  type="time"
                  value={requestedClockOut}
                  onChange={(e) => setRequestedClockOut(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isDelete ? '削除理由' : '修正理由'} <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              required
              placeholder={isDelete ? '削除理由を入力してください' : '修正理由を入力してください'}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`flex-1 px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                isDelete
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {submitting ? '送信中...' : isDelete ? '削除依頼する' : '申請する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
