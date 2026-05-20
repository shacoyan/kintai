import { formatTimeRange, formatTimeRangeA11y } from '../../utils/formatTimeRange';
import { abbreviateName } from '../../utils/displayNameAbbrev';
import { getPreferenceBarTheme } from '../../lib/preferenceBarTheme';
import type { ShiftPreference } from '../../types';

interface PreferenceBarProps {
  preference: ShiftPreference;
  memberName?: string;
  showMemberName?: boolean;
  compact?: boolean;
  effectiveStart?: string;
  effectiveEnd?: string;
  isOverridden?: boolean;
}

function formatBarLabel(start: string, end: string): string {
  const raw = formatTimeRange(start, end, { separator: '-', compactNextDay: true });
  return raw.replace(/:00\b/g, '');
}

export function PreferenceBar(props: PreferenceBarProps): JSX.Element | null {
  const { preference, memberName, showMemberName, compact = false, effectiveStart, effectiveEnd, isOverridden = false } = props;

  if (preference.preference_type !== 'preferred') return null;
  if (!preference.start_time || !preference.end_time) return null;

  const displayStart = effectiveStart ?? preference.start_time;
  const displayEnd = effectiveEnd ?? preference.end_time;

  const theme = getPreferenceBarTheme(preference.status);

  let label = formatBarLabel(displayStart, displayEnd);
  if (showMemberName && memberName) {
    label += ` ${abbreviateName(memberName)}`;
  }

  let title: string;
  if (isOverridden && preference.start_time && preference.end_time) {
    const originalRange = formatTimeRange(preference.start_time, preference.end_time, { separator: ' 〜 ' });
    const effectiveRange = formatTimeRange(displayStart, displayEnd, { separator: ' 〜 ' });
    const memberSuffix = showMemberName && memberName ? ` / ${memberName}` : '';
    title = `申請: ${originalRange} / 承認: ${effectiveRange}${memberSuffix} (${theme.statusLabelJa})`;
  } else {
    const timeFull = formatTimeRange(displayStart, displayEnd, { separator: ' 〜 ' });
    if (showMemberName && memberName) {
      title = `${timeFull} / ${memberName} (${theme.statusLabelJa})`;
    } else {
      title = `${timeFull} (${theme.statusLabelJa})`;
    }
  }

  let ariaLabel: string;
  if (showMemberName && memberName) {
    ariaLabel = `${memberName}の希望: ${formatTimeRangeA11y(displayStart, displayEnd)} (${theme.statusLabelJa})`;
  } else {
    ariaLabel = `希望: ${formatTimeRangeA11y(displayStart, displayEnd)} (${theme.statusLabelJa})`;
  }
  if (isOverridden) {
    ariaLabel += ' 時間変更後';
  }

  const sizeClass = compact ? 'h-3 text-[9px] px-0.5' : 'h-4 text-[10px] px-1';
  const baseClass = 'rounded-sm font-semibold tabular-nums overflow-hidden whitespace-nowrap truncate leading-none flex items-center';
  const overrideClass = isOverridden && displayStart && displayEnd ? ' border-l-2 border-warning-500' : '';

  return (
    <div
      className={`${baseClass} ${sizeClass} ${theme.containerClass}${overrideClass}`}
      title={title}
      aria-label={ariaLabel}
    >
      {label}
    </div>
  );
}
