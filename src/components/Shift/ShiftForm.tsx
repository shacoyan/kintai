import { useState } from 'react';
import { Clock } from 'lucide-react';
import type { ShiftPreset } from '../../types';

interface ShiftFormProps {
  date: string;
  onSubmit: (date: string, startTime: string, endTime: string, note?: string) => Promise<void>;
  onCancel: () => void;
  initialStartTime?: string;
  initialEndTime?: string;
  presets?: ShiftPreset[];
}

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '15', '30', '45']) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`);
  }
}

export function ShiftForm({ date, onSubmit, onCancel, initialStartTime, initialEndTime, presets }: ShiftFormProps) {
  const [startTime, setStartTime] = useState(initialStartTime || '09:00');
  const [endTime, setEndTime] = useState(initialEndTime || '18:00');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (startTime === endTime) {
      setError('開始と終了時刻が同じです');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(date, startTime, endTime, note || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'シフト申請に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{date} のシフト申請</h3>

      {error && (
        <div className="p-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">{error}</div>
      )}

      {presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setStartTime(p.start_time.slice(0, 5)); setEndTime(p.end_time.slice(0, 5)); }}
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-full hover:bg-blue-100 transition"
            >
              <Clock className="w-3.5 h-3.5 mr-1" />
              {p.name} ({p.start_time.slice(0, 5)}-{p.end_time.slice(0, 5)})
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">開始時刻</label>
          <select
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="block w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">終了時刻</label>
          <select
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="block w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">メモ（任意）</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="block w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="備考があれば入力"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="btn-primary flex-1 disabled:opacity-50 transition"
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
