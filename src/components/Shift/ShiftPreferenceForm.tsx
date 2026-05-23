import { useState } from 'react';
import type { FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import type { ShiftPreference, ShiftPreferenceType, ShiftPreset, Store } from '../../types';
import { formatSupabaseError } from '../../lib/errors';
import { PREFERENCE_THEME_LIST } from '../../lib/preferenceTheme';
import { Button, Select, Textarea, ErrorBanner } from '../ui';
import { messages } from '../../lib/messages';
import { validateShiftTimeRange } from '../../utils/timeRange';
import { formatTimeRange } from '../../utils/formatTimeRange';

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
    existingPreference?.preference_type ?? 'preferred',
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
  // 承認済みガード: approved & non-unavailable → 変更・削除不可（B-2）
  const lockedByApproval =
    existingPreference?.status === 'approved' && existingPreference.preference_type !== 'unavailable';
  // 承認済み unavailable → 編集可能だが警告表示（解除すると pending に戻る）
  const isUnavailableApproved =
    existingPreference?.status === 'approved' && existingPreference.preference_type === 'unavailable';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (lockedByApproval) {
      setError(messages.shiftPreference.approvedLockedTitle);
      return;
    }
    if (lockedByDeadline) {
      setError(messages.validation.deadlinePassed);
      return;
    }
    if (showTimeFields) {
      const v = validateShiftTimeRange(startTime, endTime);
      if (!v.ok) {
        setFieldErrors({ start: v.message, end: v.message });
        setError(v.message ?? '時刻が不正です');
        return;
      }
      setFieldErrors({});
    }
    if (!storeId) {
      setError(messages.validation.selectRequired('店舗'));
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
    if (lockedByApproval) {
      setError(messages.shiftPreference.approvedLockedTitle);
      return;
    }
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
  const submitDisabled = busy || lockedByDeadline || lockedByApproval;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-busy={busy || undefined} aria-describedby="shift-pref-form-help">
      <div
        id="shift-pref-form-help"
        role="note"
        className="text-sm text-stone-600 dark:text-stone-300 bg-stone-50 dark:bg-stone-900 p-3 rounded-md"
      >
        シフト申請は、希望日と時刻を選んで登録してください。締切前なら何度でも変更できます。
      </div>

      <p className="text-sm font-semibold text-stone-700 dark:text-stone-300 tabular-nums">{date}</p>

      {error && <ErrorBanner message={error} />}

      {lockedByDeadline && (
        <div
          role="alert"
          className="rounded-md border border-red-100 dark:border-red-700 bg-red-50 dark:bg-red-800/30 px-3 py-2 text-sm leading-relaxed sm:text-xs sm:leading-normal text-red-700 dark:text-red-100"
        >
          提出締切を過ぎています。新規登録・更新には管理者の代理入力が必要です。
        </div>
      )}

      {lockedByApproval && (
        <div
          role="alert"
          className="rounded-md border border-red-100 dark:border-red-700 bg-red-50 dark:bg-red-800/30 px-3 py-2 text-xs text-red-700 dark:text-red-100"
        >
          <p className="font-semibold">{messages.shiftPreference.approvedLockedTitle}</p>
          <p>{messages.shiftPreference.approvedLockedDescription}</p>
        </div>
      )}

      {isUnavailableApproved && (
        <div
          role="status"
          className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 px-3 py-2 text-xs text-blue-800 dark:text-blue-200"
        >
          {messages.shiftPreference.unavailableApprovedNotice}
        </div>
      )}

      {existingPreference && !lockedByApproval && !isUnavailableApproved && (
        <div
          role="status"
          className="rounded-md border border-orange-100 dark:border-orange-700 bg-orange-50 dark:bg-orange-800/30 px-3 py-2 text-xs text-orange-700 dark:text-orange-200"
        >
          この日付には既にシフト申請が登録されています。送信すると上書きされます。
        </div>
      )}

      {/* 希望タイプ選択 */}
      <div>
        <span className="block text-label text-stone-700 dark:text-stone-300 mb-2">希望タイプ</span>
        <div role="group" aria-label="希望タイプ" className="grid grid-cols-2 gap-2">
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
                  'motion-safe:transition-colors duration-150 ease-out focus-ring ' +
                  (isSelected
                    ? `${t.cellClass} ring-2`
                    : 'bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800')
                }
              >
                <Icon className="w-5 h-5" aria-hidden="true" />
                <span className="text-xs font-semibold">{t.label}</span>
                <span id={`pref-type-${t.type}-desc`} className="text-xs text-stone-500 dark:text-stone-300 mt-1 block">{t.description}</span>
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
          <span className="block text-label text-stone-700 dark:text-stone-300 mb-2">プリセット</span>
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
                {`${p.name} (${formatTimeRange(p.start_time, p.end_time)})`}
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
          <p role="alert" className="text-xs text-red-700 dark:text-red-200">入力時刻にエラーがあります。修正してください。</p>
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
        {lockedByApproval && (
          <p className="text-xs text-stone-500 dark:text-stone-300 text-center">
            承認済みの申請は変更できません
          </p>
        )}
        {lockedByDeadline && (
          <p className="text-xs text-stone-500 dark:text-stone-300 text-center">
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
            disabled={busy || lockedByApproval}
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
