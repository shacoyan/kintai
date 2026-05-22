import { useState } from 'react';
import { Check, X, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import type { ShiftPreference } from '../../types';
import { formatSupabaseError } from '../../lib/errors';
import { getPreferenceTheme } from '../../lib/preferenceTheme';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import { formatTimeRange } from '../../utils/formatTimeRange';

export interface PreferenceActionRowProps {
  preference: ShiftPreference;
  memberName?: string;
  onApprove: (id: string, startTime?: string, endTime?: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onRevert?: (id: string) => Promise<void>;
  canManage: boolean;
  variant?: 'compact' | 'full';
  onMutated?: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  storeName?: string;
  showStoreBadge?: boolean;
  memberDotClass?: string;
  showInlineActions?: boolean;
}

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '15', '30', '45']) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`);
  }
}

const STATUS_DOT_CLASS: Record<string, string> = {
  pending: 'bg-orange-500 dark:bg-orange-400',
  approved: 'bg-emerald-500 dark:bg-emerald-400',
  rejected: 'bg-red-500 dark:bg-red-400',
  modified: 'bg-blue-500 dark:bg-blue-400',
  cancelled: 'bg-stone-400 dark:bg-stone-500',
};

interface CardState {
  loading: boolean;
  error: string | null;
  showTimeEditor: boolean;
  editStart: string;
  editEnd: string;
}

export function PreferenceActionRow({
  preference,
  memberName,
  onApprove,
  onReject,
  onRevert,
  canManage,
  variant = 'full',
  onMutated,
  selectable,
  selected,
  onToggleSelect,
  storeName,
  showStoreBadge,
  memberDotClass,
  showInlineActions = false,
}: PreferenceActionRowProps) {
  const [state, setState] = useState<CardState>({
    loading: false,
    error: null,
    showTimeEditor: false,
    editStart: preference.start_time?.slice(0, 5) ?? '09:00',
    editEnd: preference.end_time?.slice(0, 5) ?? '18:00',
  });

  const [confirming, setConfirming] = useState<'approve' | 'reject' | 'approveWithTime' | 'revert' | null>(null);

  const handleApprove = async (withTime?: boolean) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      if (withTime) {
        await onApprove(preference.id, state.editStart, state.editEnd);
      } else {
        await onApprove(preference.id);
      }
      onMutated?.();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: formatSupabaseError(err).message,
      }));
      return;
    }
    setState((prev) => ({ ...prev, loading: false, showTimeEditor: false }));
    setConfirming(null);
  };

  const handleReject = async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      await onReject(preference.id);
      onMutated?.();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: formatSupabaseError(err).message,
      }));
      return;
    }
    setState((prev) => ({ ...prev, loading: false }));
    setConfirming(null);
  };

  const handleRevertConfirm = async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      await onRevert?.(preference.id);
      onMutated?.();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: formatSupabaseError(err).message,
      }));
      return;
    }
    setState((prev) => ({ ...prev, loading: false }));
    setConfirming(null);
  };

  const isPending = preference.status === 'pending';
  const isApproved = preference.status === 'approved';
  const isRejected = preference.status === 'rejected';
  const isUnavailable = preference.preference_type === 'unavailable';

  if (variant === 'compact') {
    const fullName = memberName ?? '?';
    const statusDotClass = STATUS_DOT_CLASS[preference.status] || STATUS_DOT_CLASS.pending;
    const theme = getPreferenceTheme(preference.preference_type);
    const timeLabel = !isUnavailable && preference.start_time ? preference.start_time.slice(0, 5) : '';
    const memberTitle = `${memberName ?? '不明'} (${preference.preference_type})`;

    if (isUnavailable) {
      return (
        <div className={`flex items-center gap-1 py-0.5 text-[10px] leading-tight text-stone-900 dark:text-stone-100 ${isRejected ? 'opacity-60 line-through' : ''}`} title={state.error ?? memberTitle}>
          <span className={`flex-shrink-0 w-2 h-2 rounded-full ${statusDotClass}`} />
          <span className={`flex-shrink-0 w-2 h-2 rounded-sm ${memberDotClass ?? 'bg-stone-300'}`} aria-hidden="true" />
          <span className="font-medium">{fullName}</span>
          <span className="text-stone-600 dark:text-stone-300">
            {isApproved ? '不可（自動）' : '不可'}
          </span>
        </div>
      );
    }

    return (
      <div className={`flex flex-col py-0.5 ${isRejected ? 'opacity-60 line-through' : ''}`} title={state.error ?? memberTitle}>
        <div className="flex items-center gap-1 text-[10px] leading-tight text-stone-900 dark:text-stone-100">
          <span className={`flex-shrink-0 w-2 h-2 rounded-full ${statusDotClass}`} />
          <span className={`flex-shrink-0 w-2 h-2 rounded-sm ${memberDotClass ?? 'bg-stone-300'}`} aria-hidden="true" />
          <span className="font-medium truncate">{fullName}</span>
          <span className="text-stone-600 dark:text-stone-300 flex-shrink-0">
            {theme.label}
          </span>
          {timeLabel && (
            <span className="text-stone-500 dark:text-stone-300 tabular-nums flex-shrink-0">
              {timeLabel}
            </span>
          )}
        </div>
        
        {isPending && canManage && showInlineActions && (
          <div className="flex items-center justify-end gap-1 mt-0.5">
            {state.loading && <Spinner size="sm" inline className="text-stone-500 dark:text-stone-300" />}
            
            {!state.loading && (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleApprove(); }}
                  className="inline-flex items-center justify-center w-6 h-6 rounded-md text-emerald-700 bg-emerald-50 hover:bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-800 dark:hover:bg-emerald-700 motion-safe:transition-colors duration-150 ease-out"
                  aria-label="承認"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleReject(); }}
                  className="inline-flex items-center justify-center w-6 h-6 rounded-md text-red-700 bg-red-50 hover:bg-red-50 dark:text-red-200 dark:bg-red-800 dark:hover:bg-red-700 motion-safe:transition-colors duration-150 ease-out"
                  aria-label="却下"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        )}

        {!isPending && !isUnavailable && !state.loading && (
          <div className="flex items-center justify-end mt-0.5">
            {isApproved && (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full text-[9px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-700 dark:text-emerald-100">
                <CheckCircle2 className="w-2.5 h-2.5" />承認済
              </span>
            )}
            {!isApproved && (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full text-[9px] font-medium bg-stone-100 text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                <XCircle className="w-2.5 h-2.5" />却下
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  const theme = getPreferenceTheme(preference.preference_type);
  const Ic = theme.Icon;

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 motion-safe:transition-colors duration-150 ease-out ${
        isPending
          ? 'border-orange-100 bg-orange-50 dark:border-orange-700 dark:bg-orange-900'
          : isApproved
          ? 'border-emerald-100 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900'
          : 'border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-800'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            {selectable && isPending && canManage && (
              <input
                type="checkbox"
                checked={!!selected}
                onChange={(e) => {
                  e.stopPropagation();
                  onToggleSelect?.(preference.id);
                }}
                aria-label={`${memberName ?? '不明'} のシフト申請を選択`}
                className="mt-1 w-4 h-4 rounded-md border-stone-300 dark:border-stone-600 text-blue-600 dark:text-blue-400 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-stone-800 cursor-pointer"
              />
            )}
            <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              {memberName ?? '不明'}
            </span>
            {showStoreBadge && storeName && (
              <span className="inline-flex px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                {storeName}
              </span>
            )}
            <span className="text-xs text-stone-500 dark:text-stone-300">{preference.date}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-base leading-none font-bold ${theme.iconColorClass}`}>
              <Ic className="w-4 h-4" />
            </span>
            <span className="text-xs text-stone-600 dark:text-stone-300">
              {theme.label}
            </span>
            {preference.preference_type !== 'unavailable' && preference.start_time && preference.end_time && (
              <span className="text-xs text-stone-500 dark:text-stone-300">
                {formatTimeRange(preference.start_time, preference.end_time, { separator: ' 〜 ' })}
              </span>
            )}
          </div>
          {preference.note && (
            <p className="text-xs text-stone-500 dark:text-stone-300 mt-0.5">{preference.note}</p>
          )}
        </div>

        <div className="flex-shrink-0">
          {isApproved && isUnavailable && (
            <Badge tone="neutral">出勤不可（自動承認）</Badge>
          )}
          {isApproved && !isUnavailable && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-700 dark:text-emerald-100">
              <CheckCircle2 className="w-3 h-3" />承認済
            </span>
          )}
          {isRejected && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600 dark:bg-stone-700 dark:text-stone-300">
              <XCircle className="w-3 h-3" />却下済
            </span>
          )}
          {isPending && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-700 dark:bg-orange-700 dark:text-orange-100">
              未対応
            </span>
          )}
        </div>
      </div>

      {state.error && <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>}

      {isPending && isUnavailable && (
        <Badge tone="neutral">出勤不可（承認不要）</Badge>
      )}

      {state.showTimeEditor && isPending && canManage && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">
              開始時刻
            </label>
            <select
              value={state.editStart}
              onChange={(e) => setState((prev) => ({ ...prev, editStart: e.target.value }))}
              className="block w-full px-2 py-2 text-sm border border-stone-300 dark:border-stone-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 bg-white dark:bg-stone-700 dark:text-stone-100"
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">
              終了時刻
            </label>
            <select
              value={state.editEnd}
              onChange={(e) => setState((prev) => ({ ...prev, editEnd: e.target.value }))}
              className="block w-full px-2 py-2 text-sm border border-stone-300 dark:border-stone-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 bg-white dark:bg-stone-700 dark:text-stone-100"
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {isPending && !canManage && !isUnavailable && (
        <div className="pt-1">
          <span className="text-xs text-stone-400 dark:text-stone-500">権限なし</span>
        </div>
      )}

      {isPending && canManage && !isUnavailable && (
        <div className="flex flex-wrap gap-2 pt-1">
          {confirming === null && !state.showTimeEditor && (
            <>
              <Button
                type="button"
                loading={state.loading}
                onClick={(e) => { e.stopPropagation(); setConfirming('approve'); }}
                variant="primary"
                className="h-auto px-3 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600"
              >
                仮承認
              </Button>
              <Button
                type="button"
                disabled={state.loading}
                onClick={(e) => { e.stopPropagation(); setState((prev) => ({ ...prev, showTimeEditor: true })); }}
                variant="tertiary"
                className="h-auto px-3 py-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 dark:text-blue-300 dark:bg-blue-900 dark:border-blue-700 dark:hover:bg-blue-800"
              >
                時間指定で仮承認
              </Button>
              <Button
                type="button"
                loading={state.loading}
                onClick={(e) => { e.stopPropagation(); setConfirming('reject'); }}
                variant="danger"
                className="h-auto px-3 py-1 text-xs text-red-700 bg-red-50 border border-red-100 hover:bg-red-50 dark:text-red-200 dark:bg-red-800 dark:border-red-700 dark:hover:bg-red-700"
              >
                却下
              </Button>
            </>
          )}

          {confirming === null && state.showTimeEditor && (
            <>
              <Button
                type="button"
                loading={state.loading}
                onClick={(e) => { e.stopPropagation(); setConfirming('approveWithTime'); }}
                variant="primary"
                className="h-auto px-3 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600"
              >
                時間指定で仮承認
              </Button>
              <Button
                type="button"
                disabled={state.loading}
                onClick={(e) => { e.stopPropagation(); setState((prev) => ({ ...prev, showTimeEditor: false })); }}
                variant="tertiary"
                className="h-auto px-3 py-1 text-xs text-stone-600 bg-stone-100 hover:bg-stone-200 dark:text-stone-300 dark:bg-stone-700 dark:hover:bg-stone-600"
              >
                キャンセル
              </Button>
            </>
          )}

          {confirming === 'approve' && (
            <>
              <button
                type="button"
                disabled={state.loading}
                onClick={(e) => { e.stopPropagation(); handleApprove(); }}
                className="h-auto px-3 py-1 text-xs rounded-md text-white bg-emerald-600 dark:bg-emerald-500 hover:bg-emerald-700 dark:hover:bg-emerald-400 disabled:opacity-50"
              >
                {state.loading && <Spinner size="sm" inline className="mr-1" />}仮承認する
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="h-auto px-3 py-1 text-xs rounded-md text-stone-700 bg-stone-100 hover:bg-stone-200 dark:text-stone-200 dark:bg-stone-700 dark:hover:bg-stone-600"
              >
                戻す
              </button>
            </>
          )}

          {confirming === 'reject' && (
            <>
              <button
                type="button"
                disabled={state.loading}
                onClick={(e) => { e.stopPropagation(); handleReject(); }}
                className="h-auto px-3 py-1 text-xs rounded-md text-white bg-red-600 dark:bg-red-500 hover:bg-red-700 dark:hover:bg-red-400 disabled:opacity-50"
              >
                {state.loading && <Spinner size="sm" inline className="mr-1" />}却下する
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="h-auto px-3 py-1 text-xs rounded-md text-stone-700 bg-stone-100 hover:bg-stone-200 dark:text-stone-200 dark:bg-stone-700 dark:hover:bg-stone-600"
              >
                戻す
              </button>
            </>
          )}

          {confirming === 'approveWithTime' && (
            <>
              <button
                type="button"
                disabled={state.loading}
                onClick={(e) => { e.stopPropagation(); handleApprove(true); }}
                className="h-auto px-3 py-1 text-xs rounded-md text-white bg-emerald-600 dark:bg-emerald-500 hover:bg-emerald-700 dark:hover:bg-emerald-400 disabled:opacity-50"
              >
                {state.loading && <Spinner size="sm" inline className="mr-1" />}この時刻で仮承認する
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="h-auto px-3 py-1 text-xs rounded-md text-stone-700 bg-stone-100 hover:bg-stone-200 dark:text-stone-200 dark:bg-stone-700 dark:hover:bg-stone-600"
              >
                戻す
              </button>
            </>
          )}
        </div>
      )}

      {(isApproved || isRejected) && canManage && onRevert && (
        <div className="pt-1 flex items-center gap-2">
          {confirming === 'revert' ? (
            <>
              <button
                type="button"
                disabled={state.loading}
                onClick={(e) => { e.stopPropagation(); handleRevertConfirm(); }}
                className="px-2 py-1 text-xs rounded-md bg-orange-600 dark:bg-orange-500 text-white hover:bg-orange-700 dark:hover:bg-orange-400"
              >
                {state.loading && <Spinner size="sm" inline className="mr-1" />}未対応に戻す
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="px-2 py-1 text-xs rounded-md bg-stone-100 dark:bg-stone-700"
              >
                戻す
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirming('revert'); }}
              className="px-2 py-1 text-xs rounded-md text-orange-700 bg-orange-50 hover:bg-orange-50 dark:text-orange-200 dark:bg-orange-800 dark:hover:bg-orange-700 inline-flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              {isApproved ? '承認を取り消す' : '却下を取り消す'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
