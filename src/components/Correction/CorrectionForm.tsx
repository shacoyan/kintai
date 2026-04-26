import { useState, useEffect } from 'react';
import { useCorrection } from '../../hooks/useCorrection';
import { format, parseISO } from 'date-fns';
import { BottomSheet } from '../ui/BottomSheet';
import { ErrorBanner } from '../ui/ErrorBanner';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../ui/Button';

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

  useEffect(() => {
    if (isOpen) {
      setRequestedClockIn(toTimeValue(existingClockIn));
      setRequestedClockOut(toTimeValue(existingClockOut));
      setReason('');
      setError(null);
    }
  }, [isOpen, existingClockIn, existingClockOut]);

  if (!isOpen) return null;

  const isDelete = mode === 'delete';
  const isOvernight = !!(requestedClockIn && requestedClockOut && requestedClockOut < requestedClockIn);

  const buildTimestamps = () => {
    if (!requestedClockIn && !requestedClockOut) return { clockIn: undefined, clockOut: undefined };

    const clockInISO = requestedClockIn
      ? new Date(`${date}T${requestedClockIn}:00+09:00`).toISOString()
      : undefined;

    let clockOutISO: string | undefined;
    if (requestedClockOut) {
      const outDate = new Date(`${date}T${requestedClockOut}:00+09:00`);
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
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={isDelete ? '勤怠削除依頼' : '勤怠修正申請'}
      description={`対象日: ${date}${isDelete ? '（削除）' : ''}`}
      footer={
        <div className="flex gap-3">
          <Button
            type="button"
            onClick={onClose}
            disabled={submitting}
            variant="tertiary"
            className="flex-1"
          >
            キャンセル
          </Button>
          <Button
            type="submit"
            form="correction-form"
            disabled={submitting}
            variant={isDelete ? 'danger' : 'primary'}
            className="flex-1"
          >
            {submitting ? '送信中...' : isDelete ? '削除依頼する' : '申請する'}
          </Button>
        </div>
      }
    >
      <form id="correction-form" onSubmit={handleSubmit} className="space-y-4">
        {isDelete && (
          <div className="mb-4 p-3 bg-neutral-50 dark:bg-neutral-900 rounded-lg">
            <p className="text-sm text-danger-600 dark:text-danger-400 mt-1">
              この勤怠記録の削除を店長 or オーナーに依頼します
            </p>
          </div>
        )}

        {!isDelete && (
          <>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">出勤時刻</label>
              <input
                type="time"
                value={requestedClockIn}
                onChange={(e) => setRequestedClockIn(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-neutral-900 dark:text-neutral-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                退勤時刻
                {isOvernight && (
                  <span className="ml-2 text-xs text-amber-600 dark:text-amber-400 font-normal">（翌日）</span>
                )}
              </label>
              <input
                type="time"
                value={requestedClockOut}
                onChange={(e) => setRequestedClockOut(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-neutral-900 dark:text-neutral-100"
              />
            </div>
          </>
        )}

        <div>
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
            {isDelete ? '削除理由' : '修正理由'} <span className="text-danger-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            required
            placeholder={isDelete ? '削除理由を入力してください' : '修正理由を入力してください'}
            className="w-full px-3 py-2 bg-white dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none text-neutral-900 dark:text-neutral-100"
          />
        </div>

        {error && (
          <ErrorBanner message={error} />
        )}

        {isOvernight && (
          <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-700 dark:text-amber-300">退勤時刻が出勤より前のため、<strong>翌日として扱います</strong>（夜勤シフト）</p>
          </div>
        )}
      </form>
    </BottomSheet>
  );
}
