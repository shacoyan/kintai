import { formatTimeRange, formatTimeRangeA11y } from '../../utils/formatTimeRange';
import { abbreviateName } from '../../utils/displayNameAbbrev';
import { getPreferenceBarTheme } from '../../lib/preferenceBarTheme';
import type { ShiftPreference } from '../../types';

interface PreferenceBarProps {
  preference: ShiftPreference;
  memberName?: string;
  showMemberName?: boolean;
  compact?: boolean;
}

function formatBarLabel(start: string, end: string): string {
  const raw = formatTimeRange(start, end, { separator: '-', compactNextDay: true });
  return raw.replace(/:00\b/g, '');
}

export function PreferenceBar(props: PreferenceBarProps): JSX.Element | null {
  const { preference, memberName, showMemberName, compact = false } = props;

  if (preference.preference_type !== 'preferred') return null;
  if (!preference.start_time || !preference.end_time) return null;

  const theme = getPreferenceBarTheme(preference.status);

  let label = formatBarLabel(preference.start_time, preference.end_time);
  if (showMemberName && memberName) {
    label += ` ${abbreviateName(memberName)}`;
  }

  const timeFull = formatTimeRange(preference.start_time, preference.end_time, { separator: ' 〜 ' });

  let title: string;
  if (showMemberName && memberName) {
    title = `${timeFull} / ${memberName} (${theme.statusLabelJa})`;
  } else {
    title = `${timeFull} (${theme.statusLabelJa})`;
  }

  let ariaLabel: string;
  if (showMemberName && memberName) {
    ariaLabel = `${memberName}の希望: ${formatTimeRangeA11y(preference.start_time, preference.end_time)} (${theme.statusLabelJa})`;
  } else {
    ariaLabel = `希望: ${formatTimeRangeA11y(preference.start_time, preference.end_time)} (${theme.statusLabelJa})`;
  }

  const sizeClass = compact ? 'h-3 text-[9px] px-0.5' : 'h-4 text-[10px] px-1';
  const baseClass = 'rounded-sm font-semibold tabular-nums overflow-hidden whitespace-nowrap truncate leading-none flex items-center';

  return (
    <div
      className={`${baseClass} ${sizeClass} ${theme.containerClass}`}
      title={title}
      aria-label={ariaLabel}
    >
      {label}
    </div>
  );
}
