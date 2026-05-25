import { useMemo } from 'react';
import { addDays, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import type { Shift, ShiftPreference } from '../../types';
import type { StatusFilterValue } from './unifiedShiftTypes';

const WEEK_LABELS = ['月', '火', '水', '木', '金', '土', '日'];

interface Props {
  shiftViewMonth: Date;
  shifts: Shift[];
  preferences: ShiftPreference[];
  currentUserId: string | null;
  selectedDate: string | null;
  selectedBulkDates?: Set<string>;
  isBulkMode: boolean;
  statusFilter?: Set<StatusFilterValue>;
  onDateClick: (date: string) => void;
}

export function ShiftMobileCalendar({
  shiftViewMonth,
  shifts,
  preferences,
  currentUserId,
  selectedDate,
  selectedBulkDates,
  isBulkMode,
  statusFilter,
  onDateClick,
}: Props) {
  const days = useMemo(() => {
    const monthStart = startOfMonth(shiftViewMonth);
    const monthEnd = endOfMonth(shiftViewMonth);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const result: Date[] = [];
    let d = gridStart;
    while (d <= gridEnd) {
      result.push(d);
      d = addDays(d, 1);
    }
    return result;
  }, [shiftViewMonth]);

  const dayInfo = useMemo(() => {
    const map = new Map<string, { count: number; isMine: boolean }>();
    for (const shift of shifts) {
      const passesFilter = !statusFilter || statusFilter.has(shift.status as StatusFilterValue);
      if (!passesFilter) continue;
      const entry = map.get(shift.date) ?? { count: 0, isMine: false };
      entry.count += 1;
      if (currentUserId && shift.user_id === currentUserId) entry.isMine = true;
      map.set(shift.date, entry);
    }
    for (const preference of preferences) {
      if (preference.preference_type !== 'preferred') continue;
      if (currentUserId && preference.user_id === currentUserId) {
        // 自分の preferred は常時表示 (PC と同じ「自分マーカー」)
        const entry = map.get(preference.date) ?? { count: 0, isMine: false };
        entry.isMine = true;
        map.set(preference.date, entry);
      }
    }
    return map;
  }, [shifts, preferences, currentUserId, statusFilter]);

  const today = new Date();

  return (
    <div className="lg:hidden">
      <div className="grid grid-cols-7 gap-px mb-px">
        {WEEK_LABELS.map((label, i) => (
          <div
            key={label}
            className={`py-1 text-center text-[11px] font-semibold tracking-[0.04em] ${
              i === 5 ? 'text-blue-600' : i === 6 ? 'text-red-700' : 'text-stone-500 dark:text-stone-400'
            }`}
          >
            {label}
          </div>
        ))}
      </div>
      <div
        role="grid"
        aria-label="シフトカレンダー (モバイル)"
        className="grid grid-cols-7 gap-px bg-stone-200/70 dark:bg-stone-700/70 rounded-[8px] overflow-hidden border border-stone-200/70 dark:border-stone-700/70"
      >
        {days.map((d) => {
          const dateStr = format(d, 'yyyy-MM-dd');
          const otherMonth = !isSameMonth(d, shiftViewMonth);
          const isToday = isSameDay(d, today);
          const info = dayInfo.get(dateStr);
          const count = info?.count ?? 0;
          const isMine = !!info?.isMine;
          const isSelected = !isBulkMode && selectedDate === dateStr;
          const isBulkSelected = isBulkMode && selectedBulkDates?.has(dateStr);

          return (
            <div
              key={dateStr}
              role="button"
              tabIndex={0}
              aria-label={`${format(d, 'M月d日')}${count > 0 ? ` ${count}人` : ''}${isToday ? ' (今日)' : ''}`}
              onClick={() => onDateClick(dateStr)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onDateClick(dateStr);
                }
              }}
              className={[
                'min-h-[60px] p-1 flex flex-col items-center gap-[2px]',
                'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset',
                'motion-safe:transition-colors duration-150',
                otherMonth ? 'bg-stone-50 dark:bg-stone-900' : 'bg-white dark:bg-stone-800',
                isToday ? 'border-t-2 border-blue-600' : '',
                isSelected ? 'bg-blue-50 dark:bg-blue-900/30' : '',
                isBulkSelected ? 'ring-2 ring-blue-600 ring-inset bg-blue-50 dark:bg-blue-900/30' : '',
              ].join(' ')}
            >
              <div className="flex flex-col items-center leading-none">
                <span
                  className={[
                    'text-[12px] tabular-nums',
                    isSelected
                      ? 'font-bold text-blue-600'
                      : isToday
                        ? 'font-bold text-stone-900 dark:text-stone-50'
                        : otherMonth
                          ? 'text-stone-400 dark:text-stone-500'
                          : 'font-medium text-stone-700 dark:text-stone-300',
                  ].join(' ')}
                >
                  {d.getDate()}
                </span>
                {isSelected && <div className="w-full h-[2px] bg-blue-600 mt-0.5 rounded-sm" aria-hidden="true" />}
              </div>
              {!otherMonth && count > 0 && (
                <div
                  className={`w-6 h-[3px] rounded-sm ${
                    isMine ? 'bg-blue-600' : 'bg-stone-300 dark:bg-stone-600'
                  }`}
                  aria-hidden="true"
                />
              )}
              {!otherMonth && count > 0 && (
                <div className="text-[10px] font-medium text-stone-500 dark:text-stone-400 tabular-nums leading-none">
                  {count}人
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
