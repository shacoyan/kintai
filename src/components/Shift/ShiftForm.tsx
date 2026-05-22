import { useState } from 'react';
import { Clock } from 'lucide-react';
import type { ShiftPreset, Store } from '../../types';
import { formatSupabaseError } from '../../lib/errors';
import { Button } from '../ui/Button';
import { Heading } from '../ui/Heading';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { ErrorBanner } from '../ui/ErrorBanner';
import { messages } from '../../lib/messages';
import { validateShiftTimeRange } from '../../utils/timeRange';
import { formatTimeRange } from '../../utils/formatTimeRange';

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
    const v = validateShiftTimeRange(startTime, endTime);
    if (!v.ok) {
      setError(v.message);
      return;
    }
    if (!storeId) {
      setError(messages.validation.selectRequired('店舗'));
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
    <form onSubmit={handleSubmit} className="bg-white dark:bg-stone-800 rounded-lg shadow p-4 space-y-4">
      <Heading level={4}>{date} のシフト申請</Heading>

      {error && (
        <ErrorBanner message={error} />
      )}

      {presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setStartTime(p.start_time.slice(0, 5)); setEndTime(p.end_time.slice(0, 5)); }}
              className="inline-flex items-center px-3 py-2 text-xs font-medium bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900 motion-safe:transition-colors duration-150 ease-out"
            >
              <Clock className="w-3.5 h-3.5 mr-1" />
              {p.name} ({formatTimeRange(p.start_time, p.end_time)})
            </button>
          ))}
        </div>
      )}

      {selectableStores.length >= 1 && (
        <Select label="店舗" value={storeId ?? ''} onChange={(e) => setStoreId(e.target.value || null)}>
          {selectableStores.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Select label="開始時刻" value={startTime} onChange={(e) => setStartTime(e.target.value)}>
          {TIME_OPTIONS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </Select>
        <Select label="終了時刻" value={endTime} onChange={(e) => setEndTime(e.target.value)}>
          {TIME_OPTIONS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </Select>
      </div>

      <Input label="メモ（任意）" placeholder="備考があれば入力" value={note} onChange={(e) => setNote(e.target.value)} />

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={submitting}
          loading={submitting}
          variant="primary"
          className="flex-1"
        >
          申請
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
