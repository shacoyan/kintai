import { useState } from 'react';
import type { ShiftPreference, ShiftPreferenceType } from '../../types';

interface ShiftPreferenceFormProps {
  date: string;
  existingPreference?: ShiftPreference;
  onSubmit: (
    date: string,
    type: ShiftPreferenceType,
    startTime?: string,
    endTime?: string,
    note?: string,
  ) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onCancel: () => void;
}

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '15', '30', '45']) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`);
  }
}

const PREFERENCE_OPTIONS: { value: ShiftPreferenceType; label: string; icon: string; colorClass: string }[] = [
  { value: 'preferred', label: '希望', icon: '◎', colorClass: 'border-blue-400 bg-blue-50 text-blue-700' },
  { value: 'available', label: '出勤可能', icon: '○', colorClass: 'border-green-400 bg-green-50 text-green-700' },
  { value: 'unavailable', label: '出勤不可', icon: '✕', colorClass: 'border-red-400 bg-red-50 text-red-700' },
];

export function ShiftPreferenceForm({
  date,
  existingPreference,
  onSubmit,
  onDelete,
  onCancel,
}: ShiftPreferenceFormProps) {
  const [preferenceType, setPreferenceType] = useState<ShiftPreferenceType>(
    existingPreference?.preference_type ?? 'available',
  );
  const [startTime, setStartTime] = useState(
    existingPreference?.start_time?.slice(0, 5) ?? '09:00',
  );
  const [endTime, setEndTime] = useState(
    existingPreference?.end_time?.slice(0, 5) ?? '18:00',
  );
  const [note, setNote] = useState(existingPreference?.note ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showTimeFields = preferenceType !== 'unavailable';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (showTimeFields && startTime === endTime) {
      setError('開始と終了時刻が同じです');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(
        date,
        preferenceType,
        showTimeFields ? startTime : undefined,
        showTimeFields ? endTime : undefined,
        note.trim() || undefined,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'シフト希望の登録に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!existingPreference || !onDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(existingPreference.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-900">{date} のシフト希望</h3>

      {error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">
          {error}
        </div>
      )}

      {/* 希望タイプ選択 */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">希望タイプ</label>
        <div className="grid grid-cols-3 gap-2">
          {PREFERENCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPreferenceType(opt.value)}
              className={`flex flex-col items-center gap-1 px-3 py-3 rounded-lg border-2 text-sm font-medium transition ${
                preferenceType === opt.value
                  ? opt.colorClass + ' border-opacity-100'
                  : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              <span className="text-lg leading-none">{opt.icon}</span>
              <span className="text-xs">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 時刻フィールド（出勤不可以外） */}
      {showTimeFields && (
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
      )}

      {/* メモ */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">メモ（任意）</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          placeholder="備考があれば入力"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || deleting}
          className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition"
        >
          {submitting ? '送信中...' : existingPreference ? '更新' : '登録'}
        </button>
        {existingPreference && onDelete && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={submitting || deleting}
            className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 disabled:opacity-50 transition"
          >
            {deleting ? '削除中...' : '削除'}
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting || deleting}
          className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50 transition"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
