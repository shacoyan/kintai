import { useState } from 'react';
import type { FormEvent } from 'react';
import { CheckCircle2, Circle, XCircle, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ShiftPreference, ShiftPreferenceType, ShiftPreset, Store } from '../../types';
import { Button, Select, Textarea, ErrorBanner } from '../ui';

interface ShiftPreferenceFormProps {
  date: string;
  existingPreference?: ShiftPreference;
  onSubmit: (
    date: string,
    type: ShiftPreferenceType,
    startTime?: string,
    endTime?: string,
    note?: string,
    storeId?: string,
  ) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onCancel: () => void;
  presets?: ShiftPreset[];
  selectableStores: Store[];
  defaultStoreId: string | null;
}

const TIME_OPTIONS: string[] = (() => {
  const arr: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of ['00', '15', '30', '45']) {
      arr.push(`${String(h).padStart(2, '0')}:${m}`);
    }
  }
  return arr;
})();

interface PrefConfig {
  value: ShiftPreferenceType;
  label: string;
  Icon: LucideIcon;
}

const PREF_CONFIGS: PrefConfig[] = [
  { value: 'preferred', label: '希望', Icon: CheckCircle2 },
  { value: 'available', label: '出勤可能', Icon: Circle },
  { value: 'unavailable', label: '出勤不可', Icon: XCircle },
];

export function ShiftPreferenceForm({
  date,
  existingPreference,
  onSubmit,
  onDelete,
  onCancel,
  presets,
  selectableStores,
  defaultStoreId,
}: ShiftPreferenceFormProps) {
  const [preferenceType, setPreferenceType] = useState<ShiftPreferenceType>(
    existingPreference?.preference_type ?? 'available',
  );
  const [startTime, setStartTime] = useState<string>(
    existingPreference?.start_time?.slice(0, 5) ?? '09:00',
  );
  const [endTime, setEndTime] = useState<string>(
    existingPreference?.end_time?.slice(0, 5) ?? '18:00',
  );
  const [note, setNote] = useState<string>(existingPreference?.note ?? '');
  const [storeId, setStoreId] = useState<string | null>(
    existingPreference?.store_id ?? defaultStoreId,
  );
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showTimeFields = preferenceType !== 'unavailable';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (showTimeFields && startTime === endTime) {
      setError('開始と終了時刻が同じです');
      return;
    }
    if (!storeId) {
      setError('店舗を選択してください');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(
        date,
        preferenceType,
        showTimeFields ? startTime : undefined,
        showTimeFields ? endTime : undefined,
        note.trim() || undefined,
        storeId,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'シフト希望の登録に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!existingPreference || !onDelete) return;
    setError(null);
    setDeleting(true);
    try {
      await onDelete(existingPreference.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました');
    } finally {
      setDeleting(false);
    }
  };

  const busy = submitting || deleting;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-busy={busy || undefined}>
      <p className="text-sm font-semibold text-neutral-700 tabular-nums">{date}</p>

      {error && <ErrorBanner message={error} />}

      {/* 希望タイプ選択 */}
      <div>
        <span className="block text-label text-neutral-700 mb-2">希望タイプ</span>
        <div role="group" aria-label="希望タイプ" className="grid grid-cols-3 gap-2">
          {PREF_CONFIGS.map((cfg) => {
            const isSelected = preferenceType === cfg.value;
            const Icon = cfg.Icon;
            return (
              <button
                key={cfg.value}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setPreferenceType(cfg.value)}
                className={
                  'flex flex-col items-center justify-center gap-1 h-16 rounded-lg ' +
                  'transition-colors duration-120 focus-ring ' +
                  (isSelected
                    ? 'bg-primary-50 ring-2 ring-primary-500 text-primary-700'
                    : 'bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50')
                }
              >
                <Icon className="w-5 h-5" aria-hidden="true" />
                <span className="text-xs font-semibold">{cfg.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 店舗 */}
      {selectableStores.length >= 1 && (
        <Select
          label="店舗"
          value={storeId ?? ''}
          onChange={(e) => setStoreId(e.target.value || null)}
        >
          {selectableStores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      )}

      {/* プリセット */}
      {showTimeFields && presets && presets.length > 0 && (
        <div>
          <span className="block text-label text-neutral-700 mb-2">プリセット</span>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <Button
                key={p.id}
                type="button"
                variant="tertiary"
                size="sm"
                onClick={() => {
                  setStartTime(p.start_time.slice(0, 5));
                  setEndTime(p.end_time.slice(0, 5));
                }}
              >
                {`${p.name} (${p.start_time.slice(0, 5)}-${p.end_time.slice(0, 5)})`}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* 開始/終了 */}
      {showTimeFields && (
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="開始時刻"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          >
            {TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Select
            label="終了時刻"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          >
            {TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
      )}

      {/* メモ */}
      <Textarea
        label="メモ（任意）"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="特記事項があれば入力"
      />

      {/* アクション */}
      <div className="flex flex-col gap-2 pt-1">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={submitting}
          disabled={busy}
        >
          {existingPreference ? '更新する' : '登録する'}
        </Button>
        {existingPreference && onDelete && (
          <Button
            type="button"
            variant="danger"
            size="md"
            fullWidth
            loading={deleting}
            disabled={busy}
            iconLeft={<Trash2 className="w-4 h-4" />}
            onClick={handleDelete}
          >
            削除する
          </Button>
        )}
        <Button
          type="button"
          variant="tertiary"
          size="md"
          fullWidth
          disabled={busy}
          onClick={onCancel}
        >
          キャンセル
        </Button>
      </div>
    </form>
  );
}
