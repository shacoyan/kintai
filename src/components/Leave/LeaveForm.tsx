import { useState, useMemo } from 'react';
import { format, differenceInDays, eachDayOfInterval, parseISO } from 'date-fns';
import type { LeaveType } from '../../types';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Button } from '../ui/Button';
import { RadioGroup, Radio } from '../ui/Radio';
import { formatSupabaseError } from '../../lib/errors';

interface LeaveFormProps {
  onSubmit: (dates: string[], leaveType: LeaveType, reason?: string) => Promise<void>;
  onCancel: () => void;
  remainingPaidLeave: number;
}

const LEAVE_TYPE_OPTIONS: { value: LeaveType; label: string }[] = [
  { value: 'paid',          label: '有給休暇' },
  { value: 'half_am',       label: '午前半休（有給）' },
  { value: 'half_pm',       label: '午後半休（有給）' },
  { value: 'special',       label: '慶弔休暇' },
  { value: 'maternity',     label: '産前産後休暇' },
  { value: 'paternity',     label: '育児休業' },
  { value: 'compassionate', label: '忌引' },
  { value: 'comp_holiday',  label: '振替休日' },
  { value: 'absence',       label: '欠勤' },
  { value: 'other',         label: 'その他' },
];

export function LeaveForm({ onSubmit, onCancel, remainingPaidLeave }: LeaveFormProps) {
  const [mode, setMode] = useState<'single' | 'range'>('single');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [leaveType, setLeaveType] = useState<LeaveType>('paid');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rangeDays = useMemo(() => {
    if (mode === 'single') return 1;
    const diff = differenceInDays(parseISO(endDate), parseISO(startDate)) + 1;
    return diff > 0 ? diff : 0;
  }, [mode, startDate, endDate]);

  const requiredDays = useMemo(() => {
    if (leaveType === 'half_am' || leaveType === 'half_pm') {
      return rangeDays * 0.5;
    }
    return rangeDays;
  }, [leaveType, rangeDays]);

  const validationError = useMemo(() => {
    if (mode === 'range') {
      const diff = differenceInDays(parseISO(endDate), parseISO(startDate));
      if (diff < 0) return '終了日は開始日以降にしてください';
      if (rangeDays > 31) return '一度の申請は31日以内にしてください';
    }

    if (leaveType === 'half_am' || leaveType === 'half_pm') {
      if (mode === 'range' && rangeDays > 1) {
        return '半休（午前・午後）の複数日申請はできません。単日で申請してください。';
      }
    }

    if (leaveType === 'paid' || leaveType === 'half_am' || leaveType === 'half_pm') {
      if (remainingPaidLeave < requiredDays) {
        return `有給休暇の残日数が不足しています（残: ${remainingPaidLeave}日 / 必要: ${requiredDays}日）`;
      }
    }

    return null;
  }, [mode, startDate, endDate, leaveType, remainingPaidLeave, rangeDays, requiredDays]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const currentError = validationError;
    if (currentError) {
      setError(currentError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      let dates: string[];
      if (mode === 'single') {
        dates = [date];
      } else {
        dates = eachDayOfInterval({
          start: parseISO(startDate),
          end: parseISO(endDate),
        }).map(d => format(d, 'yyyy-MM-dd'));
      }
      await onSubmit(dates, leaveType, reason || undefined);
    } catch (err) {
      setError(formatSupabaseError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const isDisabled = submitting || !!validationError;

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-neutral-800 rounded-lg shadow dark:shadow-neutral-900/30 border border-transparent dark:border-neutral-700 p-4 space-y-4">
      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">休暇申請</h3>

      {(error || validationError) && (
        <ErrorBanner message={error || validationError || ''} />
      )}

      <div>
        <RadioGroup
          name="leave-mode"
          label="申請モード"
          orientation="horizontal"
          value={mode}
          onChange={(val) => setMode(val as 'single' | 'range')}
        >
          <Radio value="single" label="単日" />
          <Radio value="range" label="期間" />
        </RadioGroup>
      </div>

      {mode === 'single' ? (
        <div>
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1">日付</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="休暇申請日"
            className="block w-full px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-400 dark:placeholder-neutral-400"
          />
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1">開始日</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              aria-label="休暇開始日"
              className="block w-full px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-400 dark:placeholder-neutral-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1">終了日</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-label="休暇終了日"
              className="block w-full px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-400 dark:placeholder-neutral-400"
            />
          </div>
          {rangeDays > 0 && (
            <p className="text-xs text-neutral-500 dark:text-neutral-300">
              {startDate} 〜 {endDate}（{rangeDays}日間）
            </p>
          )}
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1">種類</label>
        <select
          value={leaveType}
          onChange={(e) => setLeaveType(e.target.value as LeaveType)}
          aria-label="休暇種類"
          className="block w-full px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-400"
        >
          {LEAVE_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <p className="text-xs text-neutral-500 dark:text-neutral-300">
        現在の有給残: {remainingPaidLeave} 日
      </p>

      <div>
        <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1">理由（任意）</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="休暇理由（任意）"
          className="block w-full px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-400 placeholder-neutral-400 dark:placeholder-neutral-500"
          placeholder="理由があれば入力"
        />
      </div>

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={isDisabled}
          variant="primary"
          className="flex-1"
        >
          {submitting ? '送信中...' : '申請'}
        </Button>
        <Button
          type="button"
          onClick={onCancel}
          variant="tertiary"
        >
          キャンセル
        </Button>
      </div>
    </form>
  );
}
