import { memo } from 'react';
import type { Shift, ShiftPreference, TenantMember } from '../../types';
import { getRoleColorHex } from '../../utils/getRoleColor';

interface CalShiftBarProps {
  shift?: Shift;
  preference?: ShiftPreference;
  member?: TenantMember;
  isMine?: boolean;
  onClick?: () => void;
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

function CalShiftBarImpl({ shift, preference, member, isMine, onClick }: CalShiftBarProps) {
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
    <button
      type="button"
      onClick={onClick}
      title={member?.display_name ?? ''}
      aria-label={`${member?.display_name ?? ''} ${timeLabel} ${isUnavailable ? '出勤不可' : isPreference ? '申請中' : status === 'approved' ? '本承認' : status === 'tentative' ? '仮承認' : '申請中'}${isMine ? ' (自分)' : ''}`}
      className={`group flex flex-col min-w-0 w-full text-left appearance-none bg-transparent cursor-pointer rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset ${
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
    </button>
  );
}

// ShiftCalendar 側は `onClick={() => onShiftClick?.(s)}` のインライン arrow を毎 render 生成するため、
// onClick の identity は比較対象から除外する。クロージャは同一 shift/preference と安定な onShiftClick を
// 捕捉しており、表示に効くフィールドが変われば下記比較で検知され再 render される（クリック挙動は不変）。
function arePropsEqual(prev: CalShiftBarProps, next: CalShiftBarProps): boolean {
  if (prev.isMine !== next.isMine) return false;
  if (prev.member !== next.member) return false;

  const ps = prev.shift;
  const ns = next.shift;
  if (!!ps !== !!ns) return false;
  if (ps && ns) {
    if (
      ps.id !== ns.id ||
      ps.status !== ns.status ||
      ps.start_time !== ns.start_time ||
      ps.end_time !== ns.end_time ||
      ps.store_id !== ns.store_id ||
      ps.user_id !== ns.user_id
    ) {
      return false;
    }
  }

  const pp = prev.preference;
  const np = next.preference;
  if (!!pp !== !!np) return false;
  if (pp && np) {
    if (
      pp.id !== np.id ||
      pp.preference_type !== np.preference_type ||
      pp.start_time !== np.start_time ||
      pp.end_time !== np.end_time ||
      pp.store_id !== np.store_id ||
      pp.user_id !== np.user_id
    ) {
      return false;
    }
  }

  return true;
}

export const CalShiftBar = memo(CalShiftBarImpl, arePropsEqual);
