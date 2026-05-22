import { useState, useEffect } from 'react';
import { useCorrection } from '../../hooks/useCorrection';
import { formatSupabaseError } from '../../lib/errors';
import { useStoreContext } from '../../contexts/StoreContext';
import { format, parseISO } from 'date-fns';
import { BottomSheet } from '../ui/BottomSheet';
import { ErrorBanner } from '../ui/ErrorBanner';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { messages } from '../../lib/messages';

interface CorrectionFormProps {
  isOpen: boolean;
  onClose: () => void;
  date: string;
  tenantId: string;
  attendanceRecordId?: string;
  existingClockIn?: string;
  existingClockOut?: string;
  mode?: 'correction' | 'delete';
  memberName?: string;
  storeName?: string;
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
  memberName,
  storeName,
}: CorrectionFormProps) {
  const { submitRequest } = useCorrection(tenantId);
  const { currentStore } = useStoreContext();

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

  let description = `対象日: ${date}`;
  if (memberName) {
    description += ` / 対象メンバー: ${memberName}`;
  }
  if (storeName) {
    description += ` / 店舗: ${storeName}`;
  }
  if (isDelete) {
    description += '（削除）';
  }

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
      setError(messages.validation.required('理由'));
      return;
    }

    if (!isDelete && !requestedClockIn && !requestedClockOut) {
      setError('出勤時刻または退勤時刻を入力してください');
      return;
    }

    if (!isDelete && existingClockIn) {
      if (toTimeValue(existingClockIn) === requestedClockIn && toTimeValue(existingClockOut) === requestedClockOut) {
        setError(messages.validation.timeNoChange);
        return;
      }
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
        store_id: currentStore?.id,
      });
      onClose();
    } catch (err) {
      setError(formatSupabaseError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={isDelete ? '勤怠削除依頼' : '勤怠修正申請'}
      description={description}
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
            loading={submitting}
            variant={isDelete ? 'danger' : 'primary'}
            className="flex-1"
          >
            {isDelete ? '削除依頼する' : '申請する'}
          </Button>
        </div>
      }
    >
      <form id="correction-form" onSubmit={handleSubmit} className="space-y-4">
        {isDelete && (
          <div className="mb-4 p-3 bg-stone-50 dark:bg-stone-900 rounded-lg">
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
              この勤怠記録の削除を店長 or オーナーに依頼します
            </p>
          </div>
        )}

        {!isDelete && (
          <>
            {existingClockIn && (
              <div className="text-sm text-stone-600 dark:text-stone-300">
                現在の打刻: {toTimeValue(existingClockIn)} - {toTimeValue(existingClockOut)}
              </div>
            )}

            <Input
              type="time"
              label="出勤時刻"
              value={requestedClockIn}
              onChange={(e) => setRequestedClockIn(e.target.value)}
            />

            <Input
              type="time"
              label={isOvernight ? '退勤時刻（翌日）' : '退勤時刻'}
              value={requestedClockOut}
              onChange={(e) => setRequestedClockOut(e.target.value)}
            />
          </>
        )}

        <Textarea
          label={isDelete ? '削除理由' : '修正理由'}
          required
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={isDelete ? '削除理由を入力してください' : '修正理由を入力してください'}
        />

        {error && (
          <ErrorBanner message={error} />
        )}

        {isOvernight && (
          <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-orange-50 dark:bg-orange-800/30 border border-orange-100 dark:border-orange-700">
            <AlertTriangle className="w-4 h-4 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
            <p className="text-xs text-orange-700 dark:text-orange-200">退勤時刻が出勤より前のため、<strong>翌日として扱います</strong>（夜勤シフト）</p>
          </div>
        )}
      </form>
    </BottomSheet>
  );
}
