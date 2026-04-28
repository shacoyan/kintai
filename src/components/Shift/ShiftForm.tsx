import { useState } from 'react';
import { Clock } from 'lucide-react';
import type { ShiftPreset, Store } from '../../types';
import { formatSupabaseError } from '../../lib/errors';
import { Button } from '../ui/Button';

interface ShiftFormProps {
  date: string;
  onSubmit: (date: string, startTime: string, endTime: string, note?: string, storeId?: string) => Promise<void>;
  onCancel: () => void;
  initialStartTime?: string;
  initialEndTime?: string;
  presets?: ShiftPreset[];
  selectableStores: Store[];
  defaultStoreId: string | null;
}

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '15', '30', '45']) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`);
  }
}

export function ShiftForm({ date, onSubmit, onCancel, initialStartTime, initialEndTime, presets, selectableStores, defaultStoreId }: ShiftFormProps) {
  const [startTime, setStartTime] = useState(initialStartTime || '09:00');
  const [endTime, setEndTime] = useState(initialEndTime || '18:00');
  const [note, setNote] = useState('');
  const [storeId, setStoreId] = useState<string | null>(defaultStoreId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (startTime === endTime) {
      setError('開始と終了時刻が同じです');
      return;
    }
    if (!storeId) {
      setError('店舗を選択してください');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(date, startTime, endTime, note || undefined, storeId);
    } catch (err) {
      setError(formatSupabaseError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-neutral-800 rounded-lg shadow p-4 space-y-4">
      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{date} のシフト申請</h3>

      {error && (
        <div className="p-2 bg-danger-50 dark:bg-danger-900/30 border border-danger-200 dark:border-danger-800 rounded text-sm text-danger-600 dark:text-danger-400">{error}</div>
      )}

      {presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setStartTime(p.start_time.slice(0, 5)); setEndTime(p.end_time.slice(0, 5)); }}
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-primary-50 dark:bg-primary-900 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-800 rounded-full hover:bg-primary-100 motion-safe:transition"
            >
              <Clock className="w-3.5 h-3.5 mr-1" />
              {p.name} ({p.start_time.slice(0, 5)}-{p.end_time.slice(0, 5)})
            </button>
          ))}
        </div>
      )}

      {selectableStores.length >= 1 && (
        <div>
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">店舗</label>
          <select
            value={storeId ?? ''}
            onChange={(e) => setStoreId(e.target.value || null)}
            className="block w-full px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
          >
            {selectableStores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">開始時刻</label>
          <select
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="block w-full px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
          >
            {TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">終了時刻</label>
          <select
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="block w-full px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
          >
            {TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">メモ（任意）</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="block w-full px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
          placeholder="備考があれば入力"
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
