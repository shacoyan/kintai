import { useState } from 'react';
import { format } from 'date-fns';
import type { LeaveType } from '../../types';

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
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-900">休暇申請</h3>

      {error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">{error}</div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">日付</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">種類</label>
        <select
          value={leaveType}
          onChange={(e) => setLeaveType(e.target.value as LeaveType)}
          className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          {LEAVE_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">理由（任意）</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="理由があれば入力"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition"
        >
          {submitting ? '送信中...' : '申請'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
