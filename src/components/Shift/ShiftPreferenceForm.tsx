import { useState } from 'react';
import type { FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import type { ShiftPreference, ShiftPreferenceType, ShiftPreset, Store } from '../../types';
import { formatSupabaseError } from '../../lib/errors';
import { PREFERENCE_THEME_LIST } from '../../lib/preferenceTheme';
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
  /** 締切を過ぎている場合 true（バナー側で判定して渡す） */
  isDeadlinePassed?: boolean;
  /** owner/manager は締切後もバイパスできる */
  canBypassDeadline?: boolean;
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

function validateTimeRange(start: string, end: string): { ok: boolean; message?: string } {
  if (start === end) return { ok: false, message: '開始と終了が同じ時刻です' };
  if (start > end) return { ok: false, message: '終了は開始より後にしてください（夜勤跨ぎは未対応）' };
  return { ok: true };
}

export function ShiftPreferenceForm({
  date,
  existingPreference,
  onSubmit,
  onDelete,
  onCancel,
  presets,
  selectableStores,
  defaultStoreId,
  isDeadlinePassed = false,
  canBypassDeadline = false,
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
  const [fieldErrors, setFieldErrors] = useState<{ start?: string; end?: string }>({});

  const showTimeFields = preferenceType !== 'unavailable';
  // 締切ガード: 締切後かつバイパス権限なし → 送信不可（client guard。RLS でも二重ガードされる）
  const lockedByDeadline = isDeadlinePassed && !canBypassDeadline;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (lockedByDeadline) {
      setError('提出締切を過ぎています。管理者にお問い合わせください。');
      return;
    }
    if (showTimeFields) {
      const v = validateTimeRange(startTime, endTime);
      if (!v.ok) {
        setFieldErrors({ start: v.message, end: v.message });
        setError(v.message ?? '時刻が不正です');
        return;
      }
      setFieldErrors({});
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
      setError(formatSupabaseError(err).message);
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
      setError(formatSupabaseError(err).message);
    } finally {
      setDeleting(false);
    }
  };

  const busy = submitting || deleting;
  const submitDisabled = busy || lockedByDeadline;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-busy={busy || undefined} aria-describedby="shift-pref-form-help">
      <div
        id="shift-pref-form-help"
        role="note"
        className="text-sm text-neutral-600 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900 p-3 rounded-md"
      >
        シフト希望は、希望日と時刻を選んで登録してください。締切前なら何度でも変更できます。
      </div>

      <p className="text-sm font-semibold text-neutral-700 tabular-nums">{date}</p>

      {error && <ErrorBanner message={error} />}

      {lockedByDeadline && (
        <div
          role="alert"
          className="rounded-md border border-danger-200 bg-danger-50 dark:bg-danger-900/30 px-3 py-2 text-xs text-danger-800 dark:text-danger-200"
        >
          提出締切を過ぎています。新規登録・更新には管理者の代理入力が必要です。
        </div>
      )}

      {existingPreference && (
        <div
          role="status"
          className="rounded-md border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
        >
          この日付には既に希望が登録されています。送信すると上書きされます。
        </div>
      )}

      {/* 希望タイプ選択 */}
      <div>
        <span className="block text-label text-neutral-700 mb-2">希望タイプ</span>
        <div role="group" aria-label="希望タイプ" className="grid grid-cols-3 gap-2">
          {PREFERENCE_THEME_LIST.map((t) => {
            const isSelected = preferenceType === t.type;
            const Icon = t.Icon;
            return (
              <button
                key={t.type}
                id={`pref-type-${t.type}-btn`}
                type="button"
                aria-pressed={isSelected}
                aria-describedby={`pref-type-${t.type}-desc`}
                onClick={() => setPreferenceType(t.type)}
                className={
                  'flex flex-col items-center justify-center gap-1 h-16 rounded-lg ' +
                  'motion-safe:transition-colors duration-120 focus-ring ' +
                  (isSelected
                    ? `${t.cellClass} ring-2`
                    : 'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800')
                }
              >
                <Icon className="w-5 h-5" aria-hidden="true" />
                <span className="text-xs font-semibold">{t.label}</span>
                <span id={`pref-type-${t.type}-desc`} className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 block">{t.description}</span>
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
            error={fieldErrors.start}
            onChange={(e) => { setStartTime(e.target.value); setFieldErrors(prev => ({ ...prev, start: undefined, end: undefined })); }}
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
            error={fieldErrors.end}
            onChange={(e) => { setEndTime(e.target.value); setFieldErrors(prev => ({ ...prev, start: undefined, end: undefined })); }}
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
        {Object.values(fieldErrors).filter(Boolean).length > 0 && (
          <p role="alert" className="text-xs text-danger-700 dark:text-danger-300">入力時刻にエラーがあります。修正してください。</p>
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={submitting}
          disabled={submitDisabled}
        >
          {existingPreference ? '上書きする' : '登録する'}
        </Button>
        {lockedByDeadline && (
          <p className="text-xs text-neutral-500 text-center">
            締切後のため送信できません
          </p>
        )}
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
