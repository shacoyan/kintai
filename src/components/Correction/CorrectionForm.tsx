import { useState } from 'react';
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
}

export function CorrectionForm({
  isOpen,
  onClose,
  date,
  tenantId,
  attendanceRecordId,
  existingClockIn,
  existingClockOut,
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

  const [requestedClockIn, setRequestedClockIn] = useState(toTimeValue(existingClockIn));
  const [requestedClockOut, setRequestedClockOut] = useState(toTimeValue(existingClockOut));
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const toISOTimestamp = (timeStr: string, dateStr: string): string | undefined => {
    if (!timeStr) return undefined;
    return `${dateStr}T${timeStr}:00`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('理由を入力してください');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await submitRequest({
        date,
        attendance_record_id: attendanceRecordId,
        requested_clock_in: toISOTimestamp(requestedClockIn, date),
        requested_clock_out: toISOTimestamp(requestedClockOut, date),
        reason: reason.trim(),
      });
      setReason('');
      setRequestedClockIn('');
      setRequestedClockOut('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '申請の送信に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">勤怠修正申請</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
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
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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
            <label className="block text-sm font-medium text-gray-700 mb-1">退勤時刻</label>
            <input
              type="time"
              value={requestedClockOut}
              onChange={(e) => setRequestedClockOut(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              修正理由 <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              required
              placeholder="修正理由を入力してください"
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
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 transition-colors"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? '送信中...' : '申請する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
