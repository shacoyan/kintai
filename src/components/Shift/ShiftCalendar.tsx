import { useState, useMemo, useEffect } from 'react';
import { format, startOfWeek, addDays, startOfMonth, endOfMonth, isAfter, startOfDay, parseISO } from 'date-fns';
import type { Shift, LeaveRequest, ShiftPreference, TenantMember } from '../../types';
import type { StatusFilterValue } from './unifiedShiftTypes';
import { EmptyState } from '../ui';
import { ChevronRight } from 'lucide-react';
import { isJapaneseHoliday, getJapaneseHolidayName } from '../../lib/holidays';
import { getInitialShiftMonth } from '../../utils/initialShiftMonth';
import { CalShiftBar } from './CalShiftBar';

type ViewMode = 'week' | '2week' | 'month';

const WEEK_LABELS = ['月曜', '火曜', '水曜', '木曜', '金曜', '土曜', '日曜'];

const LEAVE_TYPE_DOT: Record<string, string> = {
  paid: 'bg-emerald-500',
  half_am: 'bg-leave-type-half-am-500',
  half_pm: 'bg-leave-type-half-pm-500',
  special: 'bg-leave-type-special-500',
  maternity: 'bg-leave-type-maternity-500',
  paternity: 'bg-leave-type-paternity-500',
  compassionate: 'bg-stone-500',
  comp_holiday: 'bg-leave-type-comp-holiday-500',
  absence: 'bg-stone-400',
  other: 'bg-blue-500',
};

const LEAVE_TYPE_LABEL: Record<string, string> = {
  paid: '有給',
  half_am: '半休(午前)',
  half_pm: '半休(午後)',
  special: '慶弔',
  maternity: '産休',
  paternity: '育休',
  compassionate: '忌引',
  comp_holiday: '振休',
  absence: '欠勤',
  other: 'その他',
};

interface ShiftCalendarProps {
  shifts: Shift[];
  onDateClick: (date: string) => void;
  onShiftClick?: (shift: Shift) => void;
  memberNames?: Map<string, string>;
  onViewMonthChange?: (date: Date) => void;
  leaves?: LeaveRequest[];
  preferences?: ShiftPreference[];
  onPreferenceClick?: (pref: ShiftPreference) => void;
  statusFilter?: Set<StatusFilterValue>;
  showPreferenceStatus?: boolean;
  currentUserId?: string | null;
  selectedBulkDates?: Set<string>;
  viewMode?: ViewMode;
  onViewModeChange?: (v: ViewMode) => void;
  baseDate?: Date;
  membersById?: Map<string, TenantMember>;
}

export function ShiftCalendar({
  shifts,
  onDateClick,
  onShiftClick,
  memberNames,
  onViewMonthChange,
  leaves = [],
  preferences,
  onPreferenceClick,
  statusFilter,
  showPreferenceStatus = false,
  currentUserId,
  selectedBulkDates,
  viewMode: viewModeProp,
  baseDate: baseDateProp,
  membersById,
}: ShiftCalendarProps) {
  const [internalViewMode] = useState<ViewMode>('month');
  const [internalBaseDate, setInternalBaseDate] = useState(getInitialShiftMonth);
  const viewMode = viewModeProp ?? internalViewMode;
  const baseDate = baseDateProp ?? internalBaseDate;

  useEffect(() => {
    onViewMonthChange?.(baseDate);
  }, [baseDate, onViewMonthChange]);

  const dates = useMemo(() => {
    const result: Date[] = [];
    if (viewMode === 'month') {
      const monthStart = startOfMonth(baseDate);
      const monthEnd = endOfMonth(baseDate);
      const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
      let d = calStart;
      while (d <= monthEnd || result.length % 7 !== 0) {
        result.push(d);
        d = addDays(d, 1);
      }
    } else {
      const weekStart = startOfWeek(baseDate, { weekStartsOn: 1 });
      const days = viewMode === 'week' ? 7 : 14;
      for (let i = 0; i < days; i += 1) result.push(addDays(weekStart, i));
    }
    return result;
  }, [viewMode, baseDate]);

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const s of shifts) {
      const passesFilter =
        s.status === 'pending' || !statusFilter || statusFilter.has(s.status as StatusFilterValue);
      if (passesFilter) {
        const arr = map.get(s.date) || [];
        arr.push(s);
        map.set(s.date, arr);
      }
    }
    return map;
  }, [shifts, statusFilter]);

  const preferencesByDate = useMemo(() => {
    const map = new Map<string, ShiftPreference[]>();
    if (!preferences) return map;
    for (const p of preferences) {
      if (p.status !== 'pending') continue;
      const showByFilter = !showPreferenceStatus || !statusFilter || statusFilter.has('pending_preference');
      if (showByFilter) {
        const arr = map.get(p.date) || [];
        arr.push(p);
        map.set(p.date, arr);
      }
    }
    return map;
  }, [preferences, statusFilter, showPreferenceStatus]);

  const leavesByDate = useMemo(() => {
    const map = new Map<string, LeaveRequest[]>();
    for (const l of leaves) {
      if (l.status === 'approved' || l.status === 'pending') {
        const arr = map.get(l.date) || [];
        arr.push(l);
        map.set(l.date, arr);
      }
    }
    return map;
  }, [leaves]);

  const isCurrentMonthEmpty = useMemo(() => {
    if (viewMode !== 'month') return false;
    const monthStart = startOfMonth(baseDate);
    const monthEnd = endOfMonth(baseDate);
    return !shifts.some((s) => {
      const shiftDate = parseISO(s.date);
      return !isAfter(monthStart, shiftDate) && !isAfter(shiftDate, monthEnd);
    });
  }, [viewMode, baseDate, shifts]);

  const navigateToNextShiftMonth = () => {
    const baseDateStart = startOfDay(baseDate);
    const futureShifts = shifts.filter((s) => isAfter(parseISO(s.date), baseDateStart));
    if (futureShifts.length === 0) return;
    const nearestShift = futureShifts.reduce((nearest, current) =>
      isAfter(parseISO(nearest.date), parseISO(current.date)) ? current : nearest,
    );
    const nextDate = parseISO(nearestShift.date);
    const nextMonth = new Date(nextDate.getFullYear(), nextDate.getMonth(), 1);
    if (baseDateProp === undefined) setInternalBaseDate(nextMonth);
    onViewMonthChange?.(nextMonth);
  };

  const today = format(new Date(), 'yyyy-MM-dd');

  return (
    <div className="space-y-3">
      {isCurrentMonthEmpty && (
        <EmptyState
          tone="info"
          title="今月のシフトはまだありません"
          action={
            shifts.some((s) => isAfter(parseISO(s.date), startOfDay(baseDate)))
              ? {
                  label: '次のシフトがある月へ',
                  onClick: navigateToNextShiftMonth,
                  iconRight: <ChevronRight className="w-4 h-4" />,
                  variant: 'tertiary',
                }
              : undefined
          }
        />
      )}

      <div className="rounded-[10px] overflow-hidden border border-stone-200/70 dark:border-stone-700/70 bg-stone-200/70 dark:bg-stone-700/70">
        <div className="grid grid-cols-7 gap-px bg-stone-200/70 dark:bg-stone-700/70">
          {WEEK_LABELS.map((w, i) => (
            <div
              key={w}
              className={`bg-stone-50 dark:bg-stone-800 py-2 px-2.5 text-[11px] font-semibold tracking-[0.04em] ${
                i === 5
                  ? 'text-blue-600 dark:text-blue-400'
                  : i === 6
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-stone-700 dark:text-stone-300'
              }`}
            >
              {w}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-px bg-stone-200/70 dark:bg-stone-700/70" role="grid" aria-label="シフトカレンダー">
          {dates.map((d) => {
            const dateStr = format(d, 'yyyy-MM-dd');
            const isToday = dateStr === today;
            const dayShifts = shiftsByDate.get(dateStr) || [];
            const dayPendingPreferences = preferencesByDate.get(dateStr) || [];
            const dayLeaves = leavesByDate.get(dateStr) || [];
            const isCurrentMonth = viewMode === 'month' ? d.getMonth() === baseDate.getMonth() : true;
            const dayOfWeek = d.getDay();
            const isHoliday = isJapaneseHoliday(d);
            const holidayName = isHoliday ? getJapaneseHolidayName(d) : null;
            const leaveTooltip = dayLeaves
              .map((l) => {
                const typeLabel = LEAVE_TYPE_LABEL[l.leave_type] || 'その他';
                const name = memberNames?.get(l.user_id) || '';
                return name ? `${typeLabel} - ${name}` : typeLabel;
              })
              .join('\n');
            const isBulkSelected = !!selectedBulkDates && selectedBulkDates.has(dateStr);
            const totalItems = dayShifts.length + dayPendingPreferences.length;
            const allItems: Array<{ kind: 'shift'; data: Shift } | { kind: 'pref'; data: ShiftPreference }> = [
              ...dayShifts.map((s) => ({ kind: 'shift' as const, data: s })),
              ...dayPendingPreferences.map((p) => ({ kind: 'pref' as const, data: p })),
            ];
            const visible = allItems.slice(0, 8);
            const overflow = allItems.length - visible.length;
            const cellBg = !isCurrentMonth ? 'bg-stone-50 dark:bg-stone-800' : 'bg-white dark:bg-stone-900';
            const weekendTint =
              isCurrentMonth && isHoliday
                ? 'bg-red-50/40 dark:bg-red-900/15'
                : isCurrentMonth && dayOfWeek === 6
                  ? 'bg-blue-50/30 dark:bg-blue-900/10'
                  : isCurrentMonth && dayOfWeek === 0
                    ? 'bg-red-50/30 dark:bg-red-900/10'
                    : '';

            return (
              <div
                key={dateStr}
                role="button"
                tabIndex={0}
                aria-label={`${dateStr} の詳細${holidayName ? ` (${holidayName})` : ''}`}
                aria-pressed={selectedBulkDates ? isBulkSelected : undefined}
                aria-selected={selectedBulkDates ? isBulkSelected : undefined}
                onClick={() => onDateClick(dateStr)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onDateClick(dateStr);
                  }
                }}
                className={`relative ${cellBg} ${weekendTint} p-1 cursor-pointer motion-safe:transition-colors duration-150 ease-out
                  min-h-[80px] lg:min-h-[130px]
                  ${isToday ? 'border-t-2 border-blue-600 dark:border-blue-400' : ''}
                  ${isCurrentMonth ? 'hover:bg-stone-50 dark:hover:bg-stone-800' : ''}
                  ${isBulkSelected ? 'ring-2 ring-blue-500 ring-inset bg-blue-50/60 dark:bg-blue-900/30' : ''}
                `}
              >
                <div className="flex items-center gap-1 px-0.5 pb-0.5">
                  <span
                    className={`text-[11px] tabular-nums ${
                      !isCurrentMonth
                        ? 'text-stone-400 dark:text-stone-500'
                        : isToday
                          ? 'text-blue-600 dark:text-blue-400 font-bold'
                          : isHoliday
                            ? 'text-red-600 dark:text-red-400 font-medium'
                            : dayOfWeek === 6
                              ? 'text-blue-600 dark:text-blue-400 font-medium'
                              : dayOfWeek === 0
                                ? 'text-red-600 dark:text-red-400 font-medium'
                                : 'text-stone-700 dark:text-stone-300 font-medium'
                    }`}
                  >
                    {format(d, 'd')}
                  </span>
                  {totalItems > 0 && isCurrentMonth && (
                    <span className="ml-auto text-[9px] text-stone-400 dark:text-stone-500 tabular-nums">{totalItems}人</span>
                  )}
                </div>

                <div className="flex flex-col gap-0.5 min-w-0">
                  {visible.map((it) => {
                    if (it.kind === 'shift') {
                      const s = it.data;
                      const member = membersById?.get(s.user_id);
                      const isMine = !!currentUserId && s.user_id === currentUserId;
                      return (
                        <CalShiftBar
                          key={`s-${s.id}`}
                          shift={s}
                          member={member}
                          isMine={isMine}
                          onClick={(e) => {
                            e.stopPropagation();
                            onShiftClick?.(s);
                          }}
                        />
                      );
                    }

                    const p = it.data;
                    const member = membersById?.get(p.user_id);
                    const isMine = !!currentUserId && p.user_id === currentUserId;
                    return (
                      <CalShiftBar
                        key={`p-${p.id}`}
                        preference={p}
                        member={member}
                        isMine={isMine}
                        onClick={(e) => {
                          e.stopPropagation();
                          onPreferenceClick?.(p);
                        }}
                      />
                    );
                  })}
                  {overflow > 0 && (
                    <div className="text-[9px] text-stone-500 dark:text-stone-400 px-1 leading-tight">+ {overflow} 件</div>
                  )}
                </div>

                {dayLeaves.length > 0 && (
                  <div title={leaveTooltip} className="absolute bottom-1 right-1 flex items-center gap-0.5">
                    {dayLeaves.slice(0, 4).map((l) => (
                      <span
                        key={l.id}
                        className={`w-1.5 h-1.5 rounded-full ${LEAVE_TYPE_DOT[l.leave_type] || 'bg-blue-500'} ${
                          l.status === 'pending' ? 'ring-1 ring-orange-400' : ''
                        }`}
                      />
                    ))}
                    {dayLeaves.length > 4 && (
                      <span className="text-[9px] text-stone-500 dark:text-stone-300 leading-none">+{dayLeaves.length - 4}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
