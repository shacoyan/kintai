import { useState, useMemo, useEffect } from 'react';
import { BottomSheet, Button, ErrorBanner, Input } from '../ui';
import { useShiftSubmissionDeadline } from '../../hooks/useShiftSubmissionDeadline';
import { formatSupabaseError } from '../../lib/errors';
import { format, startOfMonth } from 'date-fns';

export interface ShiftDeadlineSettingsModalProps {
  open: boolean;
  onClose: () => void;
  targetMonth: Date;
}

export function ShiftDeadlineSettingsModal(props: ShiftDeadlineSettingsModalProps): JSX.Element {
  const { open, onClose, targetMonth } = props;
  const { deadline, loading, error, canEdit, setDeadline, clearDeadline, applyDefaultDeadline, getDefaultDeadlineForMonth } = useShiftSubmissionDeadline(targetMonth);

  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [defaultPreview, setDefaultPreview] = useState<Date | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // 開いた時に tenants.default_deadline_day からプレビューを取得
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreviewLoading(true);
    getDefaultDeadlineForMonth()
      .then((d) => {
        if (!cancelled) setDefaultPreview(d);
      })
      .catch(() => {
        if (!cancelled) setDefaultPreview(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, getDefaultDeadlineForMonth]);

  const handleApplyDefault = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await applyDefaultDeadline();
      onClose();
    } catch (e: unknown) {
      const f = formatSupabaseError(e);
      setSubmitError(f.message);
    } finally {
      setSubmitting(false);
    }
  };

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
      const f = formatSupabaseError(e);
      setSubmitError(f.message);
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
      const f = formatSupabaseError(e);
      setSubmitError(f.message);
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

        {canEdit && (
          <div className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/40 p-3 text-sm">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-xs text-neutral-500 dark:text-neutral-300">テナント既定の締切日</p>
                <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                  {previewLoading
                    ? '読み込み中...'
                    : defaultPreview
                      ? format(defaultPreview, 'yyyy年M月d日 HH:mm')
                      : '未設定'}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={!defaultPreview || submitting}
                onClick={handleApplyDefault}
              >
                デフォルトを適用
              </Button>
            </div>
          </div>
        )}

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
