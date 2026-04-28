import { useState } from 'react';
import { Check, X, Loader2, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import type { ShiftPreference } from '../../types';
import { formatSupabaseError } from '../../lib/errors';
import { getPreferenceTheme } from '../../lib/preferenceTheme';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { abbreviateName } from '../../utils/displayNameAbbrev';

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
  pending: 'bg-warning-500 dark:bg-warning-400',
  approved: 'bg-success-500 dark:bg-success-400',
  rejected: 'bg-danger-500 dark:bg-danger-400',
  modified: 'bg-primary-500 dark:bg-primary-400',
  cancelled: 'bg-neutral-400 dark:bg-neutral-500',
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
    const abbreviation = memberName ? abbreviateName(memberName) : '?';
    const statusDotClass = STATUS_DOT_CLASS[preference.status] || STATUS_DOT_CLASS.pending;
    const theme = getPreferenceTheme(preference.preference_type);
    const timeLabel = !isUnavailable && preference.start_time ? preference.start_time.slice(0, 5) : '';
    const memberTitle = `${memberName ?? '不明'} (${preference.preference_type})`;

    if (isUnavailable) {
      return (
        <div className={`flex items-center gap-1 py-0.5 text-[10px] leading-tight text-neutral-900 dark:text-neutral-100 ${isRejected ? 'opacity-60 line-through' : ''}`} title={state.error ?? memberTitle}>
          <span className={`flex-shrink-0 w-2 h-2 rounded-full ${statusDotClass}`} />
          <span className={`flex-shrink-0 w-2 h-2 rounded-sm ${memberDotClass ?? 'bg-neutral-300'}`} aria-hidden="true" />
          <span className="font-medium">{abbreviation}</span>
          <span className="text-neutral-600 dark:text-neutral-400">不可</span>
        </div>
      );
    }

    return (
      <div className={`flex flex-col py-0.5 ${isRejected ? 'opacity-60 line-through' : ''}`} title={state.error ?? memberTitle}>
        <div className="flex items-center gap-1 text-[10px] leading-tight text-neutral-900 dark:text-neutral-100">
          <span className={`flex-shrink-0 w-2 h-2 rounded-full ${statusDotClass}`} />
          <span className={`flex-shrink-0 w-2 h-2 rounded-sm ${memberDotClass ?? 'bg-neutral-300'}`} aria-hidden="true" />
          <span className="font-medium truncate">{abbreviation}</span>
          <span className="text-neutral-600 dark:text-neutral-400 flex-shrink-0">
            {theme.label}
          </span>
          {timeLabel && (
            <span className="text-neutral-500 dark:text-neutral-400 tabular-nums flex-shrink-0">
              {timeLabel}
            </span>
          )}
        </div>
        
        {isPending && canManage && showInlineActions && (
          <div className="flex items-center justify-end gap-1 mt-0.5">
            {state.loading && <Loader2 className="w-3 h-3 motion-safe:animate-spin text-neutral-500 dark:text-neutral-400" />}
            
            {!state.loading && (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleApprove(); }}
                  className="inline-flex items-center justify-center w-6 h-6 rounded-md text-success-700 bg-success-50 hover:bg-success-100 dark:text-success-300 dark:bg-success-900 dark:hover:bg-success-800 motion-safe:transition"
                  aria-label="承認"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleReject(); }}
                  className="inline-flex items-center justify-center w-6 h-6 rounded-md text-danger-700 bg-danger-50 hover:bg-danger-100 dark:text-danger-300 dark:bg-danger-900 dark:hover:bg-danger-800 motion-safe:transition"
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
              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full text-[9px] font-medium bg-success-100 text-success-700 dark:bg-success-800 dark:text-success-200">
                <CheckCircle2 className="w-2.5 h-2.5" />承認済
              </span>
            )}
            {!isApproved && (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full text-[9px] font-medium bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
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
      className={`rounded-lg border p-3 space-y-2 motion-safe:transition ${
        isPending
          ? 'border-warning-200 bg-warning-50 dark:border-warning-700 dark:bg-warning-950'
          : isApproved
          ? 'border-success-200 bg-success-50 dark:border-success-700 dark:bg-success-950'
          : 'border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800'
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
                aria-label={`${memberName ?? '不明'} の希望を選択`}
                className="mt-1 w-4 h-4 rounded border-neutral-300 dark:border-neutral-600 text-primary-600 dark:text-primary-400 focus:ring-primary-500 dark:bg-neutral-800 cursor-pointer"
              />
            )}
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {memberName ?? '不明'}
            </span>
            {showStoreBadge && storeName && (
              <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-info-50 text-info-700 dark:bg-info-900/30 dark:text-info-300">
                {storeName}
              </span>
            )}
            <span className="text-xs text-neutral-500 dark:text-neutral-400">{preference.date}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`text-base leading-none font-bold ${theme.iconColorClass}`}>
              <Ic className="w-4 h-4" />
            </span>
            <span className="text-xs text-neutral-600 dark:text-neutral-300">
              {theme.label}
            </span>
            {preference.preference_type !== 'unavailable' && preference.start_time && preference.end_time && (
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {preference.start_time.slice(0, 5)} 〜 {preference.end_time.slice(0, 5)}
              </span>
            )}
          </div>
          {preference.note && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{preference.note}</p>
          )}
        </div>

        <div className="flex-shrink-0">
          {isApproved && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-success-100 text-success-700 dark:bg-success-800 dark:text-success-200">
              <CheckCircle2 className="w-3 h-3" />承認済
            </span>
          )}
          {isRejected && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
              <XCircle className="w-3 h-3" />却下済
            </span>
          )}
          {isPending && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-700 dark:bg-warning-800 dark:text-warning-200">
              未対応
            </span>
          )}
        </div>
      </div>

      {state.error && <p className="text-xs text-danger-600 dark:text-danger-400">{state.error}</p>}

      {isPending && isUnavailable && (
        <Badge tone="neutral">出勤不可（承認不要）</Badge>
      )}

      {state.showTimeEditor && isPending && canManage && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1">
              開始時刻
            </label>
            <select
              value={state.editStart}
              onChange={(e) => setState((prev) => ({ ...prev, editStart: e.target.value }))}
              className="block w-full px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-neutral-700 dark:text-neutral-100"
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1">
              終了時刻
            </label>
            <select
              value={state.editEnd}
              onChange={(e) => setState((prev) => ({ ...prev, editEnd: e.target.value }))}
              className="block w-full px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-neutral-700 dark:text-neutral-100"
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
          <span className="text-xs text-neutral-400 dark:text-neutral-500">権限なし</span>
        </div>
      )}

      {isPending && canManage && !isUnavailable && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {confirming === null && !state.showTimeEditor && (
            <>
              <Button
                type="button"
                disabled={state.loading}
                onClick={(e) => { e.stopPropagation(); setConfirming('approve'); }}
                variant="primary"
                className="h-auto px-3 py-1 text-xs bg-success-600 hover:bg-success-700 dark:bg-success-700 dark:hover:bg-success-600"
              >
                {state.loading ? '処理中...' : '承認'}
              </Button>
              <Button
                type="button"
                disabled={state.loading}
                onClick={(e) => { e.stopPropagation(); setState((prev) => ({ ...prev, showTimeEditor: true })); }}
                variant="tertiary"
                className="h-auto px-3 py-1 text-xs text-primary-700 bg-primary-50 border border-primary-200 hover:bg-primary-100 dark:text-primary-300 dark:bg-primary-900 dark:border-primary-700 dark:hover:bg-primary-800"
              >
                時間指定承認
              </Button>
              <Button
                type="button"
                disabled={state.loading}
                onClick={(e) => { e.stopPropagation(); setConfirming('reject'); }}
                variant="danger"
                className="h-auto px-3 py-1 text-xs text-danger-700 bg-danger-50 border border-danger-200 hover:bg-danger-100 dark:text-danger-300 dark:bg-danger-900 dark:border-danger-700 dark:hover:bg-danger-800"
              >
                {state.loading ? '処理中...' : '却下'}
              </Button>
            </>
          )}

          {confirming === null && state.showTimeEditor && (
            <>
              <Button
                type="button"
                disabled={state.loading}
                onClick={(e) => { e.stopPropagation(); setConfirming('approveWithTime'); }}
                variant="primary"
                className="h-auto px-3 py-1 text-xs bg-success-600 hover:bg-success-700 dark:bg-success-700 dark:hover:bg-success-600"
              >
                {state.loading ? '処理中...' : '時間指定で承認'}
              </Button>
              <Button
                type="button"
                disabled={state.loading}
                onClick={(e) => { e.stopPropagation(); setState((prev) => ({ ...prev, showTimeEditor: false })); }}
                variant="tertiary"
                className="h-auto px-3 py-1 text-xs text-neutral-600 bg-neutral-100 hover:bg-neutral-200 dark:text-neutral-300 dark:bg-neutral-700 dark:hover:bg-neutral-600"
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
                className="h-auto px-3 py-1 text-xs rounded text-white bg-success-600 dark:bg-success-500 hover:bg-success-700 disabled:opacity-50"
              >
                {state.loading ? '処理中...' : '承認する'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="h-auto px-3 py-1 text-xs rounded text-neutral-700 bg-neutral-100 hover:bg-neutral-200 dark:text-neutral-200 dark:bg-neutral-700 dark:hover:bg-neutral-600"
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
                className="h-auto px-3 py-1 text-xs rounded text-white bg-danger-600 dark:bg-danger-500 hover:bg-danger-700 disabled:opacity-50"
              >
                {state.loading ? '処理中...' : '却下する'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="h-auto px-3 py-1 text-xs rounded text-neutral-700 bg-neutral-100 hover:bg-neutral-200 dark:text-neutral-200 dark:bg-neutral-700 dark:hover:bg-neutral-600"
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
                className="h-auto px-3 py-1 text-xs rounded text-white bg-success-600 dark:bg-success-500 hover:bg-success-700 disabled:opacity-50"
              >
                {state.loading ? '処理中...' : 'この時刻で承認する'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="h-auto px-3 py-1 text-xs rounded text-neutral-700 bg-neutral-100 hover:bg-neutral-200 dark:text-neutral-200 dark:bg-neutral-700 dark:hover:bg-neutral-600"
              >
                戻す
              </button>
            </>
          )}
        </div>
      )}

      {(isApproved || isRejected) && canManage && onRevert && (
        <div className="pt-1 flex items-center gap-1.5">
          {confirming === 'revert' ? (
            <>
              <button
                type="button"
                disabled={state.loading}
                onClick={(e) => { e.stopPropagation(); handleRevertConfirm(); }}
                className="px-2 py-1 text-xs rounded bg-warning-600 dark:bg-warning-500 text-white hover:bg-warning-700"
              >
                {state.loading ? '処理中...' : '未対応に戻す'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="px-2 py-1 text-xs rounded bg-neutral-100 dark:bg-neutral-700"
              >
                戻す
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirming('revert'); }}
              className="px-2 py-1 text-xs rounded text-warning-700 bg-warning-50 hover:bg-warning-100 dark:text-warning-300 dark:bg-warning-900 dark:hover:bg-warning-800 inline-flex items-center gap-1"
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
