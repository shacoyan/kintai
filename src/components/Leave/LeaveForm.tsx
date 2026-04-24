import { useState } from 'react';
import { format } from 'date-fns';
import type { LeaveType } from '../../types';
import { ErrorBanner } from '../ui/ErrorBanner';

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
    <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/30 border border-transparent dark:border-gray-700 p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">休暇申請</h3>

      {error && (
        <ErrorBanner message={error} />
      )}

      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">日付</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="休暇申請日"
          className="block w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 dark:placeholder-gray-400"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">種類</label>
        <select
          value={leaveType}
          onChange={(e) => setLeaveType(e.target.value as LeaveType)}
          aria-label="休暇種類"
          className="block w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
        >
          {LEAVE_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">理由（任意）</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="休暇理由（任意）"
          className="block w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 placeholder-gray-400 dark:placeholder-gray-500"
          placeholder="理由があれば入力"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="btn-primary flex-1 disabled:opacity-50"
        >
          {submitting ? '送信中...' : '申請'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-ghost"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
