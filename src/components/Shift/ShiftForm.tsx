import { useState } from 'react';
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
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-900">{date} のシフト申請</h3>

      {error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">{error}</div>
      )}

      {presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setStartTime(p.start_time.slice(0, 5)); setEndTime(p.end_time.slice(0, 5)); }}
              className="px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-full hover:bg-blue-100 transition"
            >
              {p.name} ({p.start_time.slice(0, 5)}-{p.end_time.slice(0, 5)})
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">開始時刻</label>
          <select
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">終了時刻</label>
          <select
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">メモ（任意）</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="備考があれば入力"
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
