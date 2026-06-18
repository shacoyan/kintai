import type { Shift, ShiftPreference, TenantMember } from '../../types';
import { getRoleColorHex } from '../../utils/getRoleColor';

interface CalShiftBarProps {
  shift?: Shift;
  preference?: ShiftPreference;
  member?: TenantMember;
  isMine?: boolean;
}

export function getRoleColor(member: TenantMember | undefined): string {
  return getRoleColorHex(member);
}

export function isHourlyMember(member: TenantMember | undefined): boolean {
  return member?.pay_type === 'hourly';
}

interface StatusVisual {
  bg: string;
  bar: string;
}

export function statusVisual(status: string): StatusVisual {
  if (status === 'approved') return { bg: 'rgba(5, 150, 105, 0.10)', bar: '#059669' };
  if (status === 'tentative') return { bg: 'rgba(249, 115, 22, 0.10)', bar: '#f97316' };
  if (status === 'pending') return { bg: 'rgba(37, 99, 235, 0.10)', bar: '#2563eb' };
  return { bg: 'rgba(120,113,108,0.08)', bar: '#78716c' };
}

export function CalShiftBar({ shift, preference, member, isMine }: CalShiftBarProps) {
  const status = shift?.status ?? (preference ? 'pending' : 'tentative');
  const start = shift?.start_time ?? preference?.start_time ?? '';
  const end = shift?.end_time ?? preference?.end_time ?? '';
  const isUnavailable = !!preference && preference.preference_type === 'unavailable';
  const visual = isUnavailable
    ? { bg: 'rgba(220, 38, 38, 0.08)', bar: '#dc2626' }
    : statusVisual(status);
  const rc = getRoleColor(member);
  const hourly = isHourlyMember(member);
  const fmt = (t: string) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    return m === '00' ? h : `${h}:${m}`;
  };
  const isPreference = !!preference && !shift;
  const timeLabel = isUnavailable
    ? '出勤不可'
    : `${fmt(start)}–${fmt(end)}`;

  return (
    <div
      title={member?.display_name ?? ''}
      aria-label={`${member?.display_name ?? ''} ${timeLabel} ${isUnavailable ? '出勤不可' : isPreference ? '申請中' : status === 'approved' ? '本承認' : status === 'tentative' ? '仮承認' : '申請中'}${isMine ? ' (自分)' : ''}`}
      className={`group flex flex-col min-w-0 rounded-[3px] ${
        isMine ? 'ring-1 ring-blue-500 dark:ring-blue-400 ring-inset' : ''
      }`}
      style={{
        padding: '2px 3px 2px 5px',
        background: visual.bg,
        borderLeft: `2px solid ${isUnavailable ? '#dc2626' : rc}`,
        borderTop: hourly && !isUnavailable ? `1px dashed ${rc}88` : undefined,
        borderBottom: hourly && !isUnavailable ? `1px dashed ${rc}88` : undefined,
      }}
    >
      <span className={`text-[10px] leading-[1.2] truncate font-medium ${isUnavailable ? 'text-red-700 dark:text-red-300 line-through' : 'text-stone-900 dark:text-stone-100'}`}>
        {member?.display_name ?? '?'}
      </span>
      <div className="flex items-center gap-1">
        <span
          className={`text-[9px] tabular-nums leading-[1.2] truncate flex-shrink-0 ${isUnavailable ? 'text-red-700 dark:text-red-300 font-semibold' : 'text-stone-700 dark:text-stone-200'}`}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {timeLabel}
        </span>
        {/* approved 以外は右端に status dot 1 個 (出勤不可は赤 dot で識別) */}
        {(status !== 'approved' || isUnavailable) && (
          <span
            className="ml-auto inline-block w-1 h-1 rounded-full flex-shrink-0"
            style={{ background: visual.bar }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
