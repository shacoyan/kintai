import { useState, useMemo, useEffect } from 'react';
import { BottomSheet, Button, ErrorBanner, Input } from '../ui';
import { useShiftSubmissionDeadline } from '../../hooks/useShiftSubmissionDeadline';
import { format, startOfMonth } from 'date-fns';

export interface ShiftDeadlineSettingsModalProps {
  open: boolean;
  onClose: () => void;
  targetMonth: Date;
}

export function ShiftDeadlineSettingsModal(props: ShiftDeadlineSettingsModalProps): JSX.Element {
  const { open, onClose, targetMonth } = props;
  const { deadline, loading, error, canEdit, setDeadline, clearDeadline } = useShiftSubmissionDeadline(targetMonth);

  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    if (deadline) {
      setDateStr(format(deadline, 'yyyy-MM-dd'));
      setTimeStr(format(deadline, 'HH:mm'));
    } else {
      const prevMonth = new Date(startOfMonth(targetMonth));
      prevMonth.setMonth(prevMonth.getMonth() - 1);
      prevMonth.setDate(25);
      prevMonth.setHours(23, 59, 0, 0);
      setDateStr(format(prevMonth, 'yyyy-MM-dd'));
      setTimeStr(format(prevMonth, 'HH:mm'));
    }

    setSubmitError(null);
  }, [open, deadline, targetMonth]);

  const handleSubmit = async () => {
    const combinedDate = new Date(`${dateStr}T${timeStr}:00`);
    if (isNaN(combinedDate.getTime())) {
      setSubmitError('無効な日付または時刻が入力されています。');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await setDeadline(combinedDate);
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '保存に失敗しました。';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm('シフト提出期限を削除しますか？')) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await clearDeadline();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '削除に失敗しました。';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const footerContent = (
    <div className="flex justify-between gap-2">
      <div>
        {deadline && (
          <Button variant="danger" onClick={handleClear} disabled={!canEdit || submitting}>
            削除
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="tertiary" onClick={onClose}>
          キャンセル
        </Button>
        <Button variant="primary" onClick={handleSubmit} loading={submitting} disabled={!canEdit || loading}>
          保存
        </Button>
      </div>
    </div>
  );

  const displayError = useMemo(() => error?.message || submitError, [error, submitError]);

  return (
    <BottomSheet
      isOpen={open}
      onClose={onClose}
      title="シフト提出期限設定"
      description="対象月のシフト提出期限を設定します。"
      footer={footerContent}
    >
      <div className="space-y-4">
        {displayError && (
          <ErrorBanner message={displayError} />
        )}

        {!canEdit && (
          <div className="text-warning-700 bg-warning-50 dark:bg-warning-900/20 p-3 rounded-md text-sm">
            権限がありません。この設定を編集するには管理者権限が必要です。
          </div>
        )}

        <div className="text-lg font-bold text-neutral-800 dark:text-neutral-200">
          対象月: {format(targetMonth, 'yyyy年M月')}
        </div>

        <div className="flex flex-col gap-3">
          <Input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            disabled={!canEdit}
            className="w-full"
          />
          <Input
            type="time"
            value={timeStr}
            onChange={(e) => setTimeStr(e.target.value)}
            disabled={!canEdit}
            className="w-full"
          />
        </div>
      </div>
    </BottomSheet>
  );
}
