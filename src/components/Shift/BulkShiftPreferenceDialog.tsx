import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button, Select, ErrorBanner } from '../ui';
import { PREFERENCE_THEME_LIST } from '../../lib/preferenceTheme';
import { validateShiftTimeRange } from '../../utils/timeRange';
import { formatTimeRange } from '../../utils/formatTimeRange';
import { formatSupabaseError } from '../../lib/errors';
import { messages } from '../../lib/messages';
import type {
  BulkSubmitPreferenceArgs,
  BulkSubmitResult,
  ShiftPreferenceType,
  ShiftPreset,
} from '../../types';

interface BulkShiftPreferenceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** ソート済の選択日 (YYYY-MM-DD) */
  selectedDates: string[];
  /** 既存申請がある日付集合 (上書き警告表示用) */
  existingPreferenceDates: Set<string>;
  /** 承認済み preferred の日付集合 (スキップ警告表示用) */
  lockedDates?: Set<string>;
  presets: ShiftPreset[];
  onSubmit: (args: BulkSubmitPreferenceArgs) => Promise<BulkSubmitResult>;
  isDeadlinePassed?: boolean;
  canBypassDeadline?: boolean;
}

const PRESET_CUSTOM_VALUE = 'custom';
const PRESET_EMPTY_VALUE = '';

const MAX_CHIP_DISPLAY = 12;

export function BulkShiftPreferenceDialog({
  isOpen,
  onClose,
  selectedDates,
  existingPreferenceDates,
  lockedDates,
  presets,
  onSubmit,
  isDeadlinePassed = false,
  canBypassDeadline = false,
}: BulkShiftPreferenceDialogProps): JSX.Element | null {
  const [preferenceType, setPreferenceType] = useState<ShiftPreferenceType>('preferred');
  const [presetId, setPresetId] = useState<string>(PRESET_EMPTY_VALUE);
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const total = selectedDates.length;
  const overwriteCount = useMemo(
    () => selectedDates.filter((d) => existingPreferenceDates.has(d)).length,
    [selectedDates, existingPreferenceDates],
  );
  const lockedCount = useMemo(() => {
    if (!lockedDates || lockedDates.size === 0) return 0;
    return selectedDates.filter((d) => lockedDates.has(d)).length;
  }, [selectedDates, lockedDates]);

  const lockedByDeadline = isDeadlinePassed && !canBypassDeadline;
  const showTimeFields = preferenceType !== 'unavailable';
  const isCustomPreset = presetId === PRESET_CUSTOM_VALUE;

  // カスタム時刻の検証 (preferred かつ custom 時のみ評価)
  const customValidation = useMemo(() => {
    if (!showTimeFields || !isCustomPreset) return { ok: true as const };
    if (!customStart || !customEnd) {
      return { ok: false as const, message: messages.shiftPreference.bulk.timeRequired };
    }
    return validateShiftTimeRange(customStart, customEnd);
  }, [showTimeFields, isCustomPreset, customStart, customEnd]);

  const submitDisabled = useMemo(() => {
    if (submitting) return true;
    if (total === 0) return true;
    if (lockedByDeadline) return true;
    if (showTimeFields) {
      if (!presetId) return true;
      if (isCustomPreset && !customValidation.ok) return true;
    }
    return false;
  }, [
    submitting,
    total,
    lockedByDeadline,
    showTimeFields,
    presetId,
    isCustomPreset,
    customValidation,
  ]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitDisabled) return;
    setError(null);

    if (lockedByDeadline) {
      setError(messages.shiftPreference.bulk.deadlinePassed);
      return;
    }

    let startTime: string | null = null;
    let endTime: string | null = null;
    let usedPresetId: string | null = null;
    if (showTimeFields) {
      if (isCustomPreset) {
        if (!customValidation.ok) {
          setError(customValidation.message ?? messages.shiftPreference.bulk.validationError);
          return;
        }
        startTime = customStart;
        endTime = customEnd;
      } else {
        const preset = presets.find((p) => p.id === presetId);
        if (!preset) {
          setError(messages.shiftPreference.bulk.validationError);
          return;
        }
        startTime = preset.start_time.slice(0, 5);
        endTime = preset.end_time.slice(0, 5);
        usedPresetId = preset.id;
      }
    }

    setSubmitting(true);
    try {
      await onSubmit({
        dates: selectedDates,
        type: preferenceType,
        startTime,
        endTime,
        presetId: usedPresetId,
      });
      // 成功 / partial failure / locked の toast は親側 (ShiftPage) が担当
      onClose();
    } catch (err) {
      setError(formatSupabaseError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  // 日付プレビュー (overflow は +N で省略表示)
  const visibleDates = selectedDates.slice(0, MAX_CHIP_DISPLAY);
  const remainingCount = Math.max(0, total - visibleDates.length);
  const allDatesLabel = selectedDates.join(', ');

  const footer = (
    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
      <Button
        type="button"
        variant="tertiary"
        size="md"
        onClick={handleClose}
        disabled={submitting}
      >
        {messages.shiftPreference.bulk.cancelButton}
      </Button>
      <Button
        type="button"
        variant="primary"
        size="md"
        loading={submitting}
        disabled={submitDisabled}
        onClick={(e) => handleSubmit(e as unknown as FormEvent)}
      >
        {submitting
          ? messages.shiftPreference.bulk.submitting
          : messages.shiftPreference.bulk.submitButton}
      </Button>
    </div>
  );

  if (!isOpen) return null;

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title={messages.shiftPreference.bulk.dialogTitle}
      description={messages.shiftPreference.bulk.dateCount(total)}
      footer={footer}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-busy={submitting || undefined}>
        {/* エラーバナー */}
        {error && <ErrorBanner message={error} />}

        {/* 締切ロック警告 */}
        {lockedByDeadline && (
          <div
            role="alert"
            className="rounded-md border border-red-100 dark:border-red-700 bg-red-50 dark:bg-red-800/30 px-3 py-2 text-xs text-red-700 dark:text-red-100"
          >
            {messages.shiftPreference.bulk.deadlinePassed}
          </div>
        )}

        {/* 日付プレビュー chips */}
        <div>
          <span className="block text-label text-stone-700 dark:text-stone-300 mb-2">
            {messages.shiftPreference.bulk.dateCount(total)}
          </span>
          <ul
            aria-label={allDatesLabel}
            className="flex flex-wrap gap-1.5"
          >
            {visibleDates.map((d) => (
              <li
                key={d}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-700 tabular-nums"
              >
                {d}
              </li>
            ))}
            {remainingCount > 0 && (
              <li className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                +{remainingCount}日
              </li>
            )}
          </ul>
        </div>

        {/* 上書き警告 */}
        {overwriteCount > 0 && (
          <div
            role="status"
            className="rounded-md border border-orange-100 dark:border-orange-700 bg-orange-50 dark:bg-orange-800/30 px-3 py-2 text-xs text-orange-700 dark:text-orange-200"
          >
            {messages.shiftPreference.bulk.overwriteWarning(total, overwriteCount)}
          </div>
        )}

        {/* locked スキップ警告 */}
        {lockedCount > 0 && (
          <div
            role="status"
            className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 px-3 py-2 text-xs text-blue-800 dark:text-blue-200"
          >
            {messages.shiftPreference.bulk.lockedWarning(total, lockedCount)}
          </div>
        )}

        {/* 希望種別ラジオ (PREFERENCE_THEME を流用) */}
        <div>
          <span className="block text-label text-stone-700 dark:text-stone-300 mb-2">
            {messages.shiftPreference.bulk.typeLabel}
          </span>
          <div
            role="radiogroup"
            aria-label={messages.shiftPreference.bulk.typeLabel}
            className="grid grid-cols-2 gap-2"
          >
            {PREFERENCE_THEME_LIST.map((t) => {
              const isSelected = preferenceType === t.type;
              const Icon = t.Icon;
              const labelText =
                t.type === 'preferred'
                  ? messages.shiftPreference.bulk.typePreferred
                  : messages.shiftPreference.bulk.typeUnavailable;
              return (
                <button
                  key={t.type}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
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
                  <span className="text-xs font-semibold">{labelText}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* プリセット Select (preferred のみ) */}
        {showTimeFields && (
          <>
            {presets.length === 0 && (
              <div
                role="status"
                className="rounded-md border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 px-3 py-2 text-xs text-stone-700 dark:text-stone-300"
              >
                {messages.shiftPreference.bulk.presetEmpty}
              </div>
            )}
            <Select
              label={messages.shiftPreference.bulk.presetLabel}
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
            >
              <option value={PRESET_EMPTY_VALUE}>
                {messages.shiftPreference.bulk.presetPlaceholder}
              </option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {`${p.name} (${formatTimeRange(p.start_time, p.end_time)})`}
                </option>
              ))}
              <option value={PRESET_CUSTOM_VALUE}>
                {messages.shiftPreference.bulk.presetCustom}
              </option>
            </Select>

            {/* カスタム時刻入力 */}
            {isCustomPreset && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-label text-stone-700 dark:text-stone-300 mb-2">
                    {messages.shiftPreference.bulk.customStartLabel}
                  </label>
                  <input
                    type="time"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="w-full h-12 md:h-10 border border-stone-300 dark:border-stone-600 rounded-md bg-white dark:bg-stone-800 dark:text-stone-100 px-3 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400"
                    aria-label={messages.shiftPreference.bulk.customStartLabel}
                  />
                </div>
                <div>
                  <label className="block text-label text-stone-700 dark:text-stone-300 mb-2">
                    {messages.shiftPreference.bulk.customEndLabel}
                  </label>
                  <input
                    type="time"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="w-full h-12 md:h-10 border border-stone-300 dark:border-stone-600 rounded-md bg-white dark:bg-stone-800 dark:text-stone-100 px-3 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400"
                    aria-label={messages.shiftPreference.bulk.customEndLabel}
                  />
                </div>
              </div>
            )}

            {isCustomPreset && !customValidation.ok && (
              <p role="alert" className="text-xs text-red-700 dark:text-red-200">
                {customValidation.message ?? messages.shiftPreference.bulk.validationError}
              </p>
            )}
          </>
        )}

        {/* unavailable 時のヒント */}
        {!showTimeFields && (
          <div
            role="status"
            className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 px-3 py-2 text-xs text-blue-800 dark:text-blue-200"
          >
            {messages.shiftPreference.bulk.unavailableHint}
          </div>
        )}
      </form>
    </BottomSheet>
  );
}
