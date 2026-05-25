import type { KeyboardEvent, MouseEvent } from 'react';
import type { Shift, ShiftPreference, TenantMember } from '../../types';
import { getRoleColorHex } from '../../utils/getRoleColor';

interface CalShiftBarProps {
  shift?: Shift;
  preference?: ShiftPreference;
  member?: TenantMember;
  isMine?: boolean;
  onClick?: (e: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => void;
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

export function CalShiftBar({ shift, preference, member, isMine, onClick }: CalShiftBarProps) {
  const status = shift?.status ?? (preference ? 'pending' : 'tentative');
  const start = shift?.start_time ?? preference?.start_time ?? '';
  const end = shift?.end_time ?? preference?.end_time ?? '';
  const visual = statusVisual(status);
  const rc = getRoleColor(member);
  const hourly = isHourlyMember(member);
  const fmt = (t: string) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    return m === '00' ? h : `${h}:${m}`;
  };
  const isPreference = !!preference && !shift;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.(e);
        }
      }}
      title={member?.display_name ?? ''}
      aria-label={`${member?.display_name ?? ''} ${fmt(start)}-${fmt(end)} ${isPreference ? '申請中' : status === 'approved' ? '本承認' : status === 'tentative' ? '仮承認' : '申請中'}${isMine ? ' (自分)' : ''}`}
      className={`group flex items-center gap-1 cursor-pointer hover:opacity-80 motion-safe:transition-opacity duration-150 min-w-0 rounded-[3px] ${
        isMine ? 'ring-1 ring-blue-500 dark:ring-blue-400 ring-inset' : ''
      }`}
      style={{
        padding: '1px 3px 1px 5px',
        background: visual.bg,
        borderLeft: `2px solid ${rc}`,
        borderTop: hourly ? `1px dashed ${rc}88` : undefined,
        borderBottom: hourly ? `1px dashed ${rc}88` : undefined,
      }}
    >
      <span
        className="text-[9.5px] font-semibold tabular-nums shrink-0"
        style={{ color: rc }}
      >
        {(member?.display_name ?? '?').charAt(0).toUpperCase()}
      </span>
      <span
        className="text-[9px] tabular-nums text-stone-700 dark:text-stone-200 leading-[1.25] truncate flex-shrink-0"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {fmt(start)}–{fmt(end)}
      </span>
      {/* 正典: approved 以外は右端に status dot 1 個 */}
      {status !== 'approved' && (
        <span
          className="ml-auto inline-block w-1 h-1 rounded-full flex-shrink-0"
          style={{ background: visual.bar }}
          aria-hidden
        />
      )}
    </div>
  );
}
