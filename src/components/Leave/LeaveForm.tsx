import { useState } from 'react';
import { format } from 'date-fns';
import type { LeaveType } from '../../types';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Button } from '../ui/Button';

interface LeaveFormProps {
  onSubmit: (date: string, leaveType: LeaveType, reason?: string) => Promise<void>;
  onCancel: () => void;
}

const LEAVE_TYPE_OPTIONS: { value: LeaveType; label: string }[] = [
  { value: 'paid', label: '有給休暇' },
  { value: 'half_paid', label: '半休（有給）' },
  { value: 'absence', label: '欠勤' },
  { value: 'other', label: 'その他' },
];

export function LeaveForm({ onSubmit, onCancel }: LeaveFormProps) {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [leaveType, setLeaveType] = useState<LeaveType>('paid');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(date, leaveType, reason || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : '休暇申請に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-neutral-800 rounded-lg shadow dark:shadow-neutral-900/30 border border-transparent dark:border-neutral-700 p-4 space-y-4">
      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">休暇申請</h3>

      {error && (
        <ErrorBanner message={error} />
      )}

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
          disabled={submitting}
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
