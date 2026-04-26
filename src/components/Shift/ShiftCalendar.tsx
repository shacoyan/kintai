import { useState, useMemo } from 'react';
import { format, startOfWeek, addDays, startOfMonth, endOfMonth, addWeeks } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Shift } from '../../types';

type ViewMode = 'week' | '2week' | 'month';

interface ShiftCalendarProps {
  shifts: Shift[];
  onDateClick: (date: string) => void;
  onShiftClick?: (shift: Shift) => void;
  /** member display_name map for admin view */
  memberNames?: Map<string, string>;
}

const MEMBER_COLORS = [
  'bg-primary-100 border-primary-300 text-primary-800 dark:bg-primary-900/30 dark:border-primary-700 dark:text-primary-300',
  'bg-emerald-100 border-emerald-300 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300',
  'bg-info-100 border-info-300 text-info-800 dark:bg-info-900/30 dark:border-info-700 dark:text-info-300',
  'bg-orange-100 border-orange-300 text-orange-800 dark:bg-orange-900/30 dark:border-orange-700 dark:text-orange-300',
  'bg-rose-100 border-rose-300 text-rose-800 dark:bg-rose-900/30 dark:border-rose-700 dark:text-rose-300',
  'bg-cyan-100 border-cyan-300 text-cyan-800 dark:bg-cyan-900/30 dark:border-cyan-700 dark:text-cyan-300',
  'bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300',
  'bg-lime-100 border-lime-300 text-lime-800 dark:bg-lime-900/30 dark:border-lime-700 dark:text-lime-300',
  'bg-sky-100 border-sky-300 text-sky-800 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-300',
  'bg-teal-100 border-teal-300 text-teal-800 dark:bg-teal-900/30 dark:border-teal-700 dark:text-teal-300',
];

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-warning-100 border-warning-300 text-warning-800 dark:bg-warning-900/30 dark:border-warning-700 dark:text-warning-300',
  approved: 'bg-success-100 border-success-300 text-success-800 dark:bg-success-900/30 dark:border-success-700 dark:text-success-300',
  rejected: 'bg-danger-100 border-danger-300 text-danger-800 dark:bg-danger-900/30 dark:border-danger-700 dark:text-danger-300',
  modified: 'bg-primary-100 border-primary-300 text-primary-800 dark:bg-primary-900/30 dark:border-primary-700 dark:text-primary-300',
  cancelled: 'bg-neutral-100 border-neutral-300 text-neutral-500 dark:bg-neutral-700 dark:border-neutral-600 dark:text-neutral-400',
};

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-warning-400',
  approved: 'bg-success-400',
  rejected: 'bg-danger-400',
  modified: 'bg-primary-400',
  cancelled: 'bg-neutral-400',
};

export function ShiftCalendar({ shifts, onDateClick, onShiftClick, memberNames }: ShiftCalendarProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [baseDate, setBaseDate] = useState(() => new Date());

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
      for (let i = 0; i < days; i++) {
        result.push(addDays(weekStart, i));
      }
    }
    return result;
  }, [viewMode, baseDate]);

  const userColorMap = useMemo(() => {
    const map = new Map<string, string>();
    const uniqueUsers = [...new Set(shifts.map(s => s.user_id))];
    uniqueUsers.forEach((uid, i) => {
      map.set(uid, MEMBER_COLORS[i % MEMBER_COLORS.length]);
    });
    return map;
  }, [shifts]);

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const s of shifts) {
      const arr = map.get(s.date) || [];
      arr.push(s);
      map.set(s.date, arr);
    }
    return map;
  }, [shifts]);

  const navigate = (dir: number) => {
    if (viewMode === 'month') {
      setBaseDate(prev => new Date(prev.getFullYear(), prev.getMonth() + dir, 1));
    } else if (viewMode === '2week') {
      setBaseDate(prev => addWeeks(prev, dir * 2));
    } else {
      setBaseDate(prev => addWeeks(prev, dir));
    }
  };

  const today = format(new Date(), 'yyyy-MM-dd');
  const weekDays = ['月', '火', '水', '木', '金', '土', '日'];

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} aria-label="前月" className="p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-700 transition">
            <ChevronLeft className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
          </button>
          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 min-w-[120px] text-center">
            {viewMode === 'month'
              ? format(baseDate, 'yyyy年M月', { locale: ja })
              : `${format(dates[0], 'M/d')} - ${format(dates[dates.length - 1], 'M/d')}`
            }
          </span>
          <button onClick={() => navigate(1)} aria-label="次月" className="p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-700 transition">
            <ChevronRight className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
          </button>
          <button
            onClick={() => setBaseDate(new Date())}
            className="px-2 py-1 text-xs font-medium text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 rounded hover:bg-primary-100 dark:hover:bg-primary-900/50 transition"
          >
            今日
          </button>
        </div>

        <div className="flex rounded-md overflow-hidden border border-neutral-300 dark:border-neutral-600" role="tablist">
          {(['week', '2week', 'month'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              role="tab"
              aria-selected={viewMode === mode}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                viewMode === mode
                  ? 'bg-primary-600 text-white'
                  : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700'
              }`}
            >
              {mode === 'week' ? '週' : mode === '2week' ? '2週' : '月'}
            </button>
          ))}
        </div>
      </div>

      {/* Calendar grid */}
      <div className="bg-white dark:bg-neutral-800 rounded-lg shadow overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-7 bg-neutral-50 dark:bg-neutral-700 border-b border-neutral-200 dark:border-neutral-700">
          {weekDays.map((d, i) => (
            <div key={i} className={`text-center py-2 text-xs font-medium ${
              i === 5 ? 'text-primary-600 dark:text-primary-400' : i === 6 ? 'text-danger-600 dark:text-danger-400' : 'text-neutral-500 dark:text-neutral-400'
            }`}>
              {d}
            </div>
          ))}
        </div>

        {/* Cells */}
        <div className="grid grid-cols-7">
          {dates.map((d) => {
            const dateStr = format(d, 'yyyy-MM-dd');
            const isToday = dateStr === today;
            const dayShifts = shiftsByDate.get(dateStr) || [];
            const isCurrentMonth = viewMode === 'month' ? d.getMonth() === baseDate.getMonth() : true;
            const dayOfWeek = d.getDay();

            return (
              <div
                key={dateStr}
                onClick={() => onDateClick(dateStr)}
                className={`min-h-[70px] sm:min-h-[80px] border-b border-r border-neutral-100 dark:border-neutral-700 p-1 cursor-pointer transition ${
                  !isCurrentMonth ? 'bg-neutral-50 dark:bg-neutral-700/50 opacity-50' : ''
                } ${
                  isCurrentMonth && dayOfWeek === 6 ? 'bg-sky-50/40 dark:bg-sky-900/10' : ''
                } ${
                  isCurrentMonth && dayOfWeek === 0 ? 'bg-rose-50/40 dark:bg-rose-900/10' : ''
                } ${
                  isCurrentMonth ? 'hover:bg-neutral-50 dark:hover:bg-neutral-700' : ''
                }`}
              >
                <div className={`text-xs font-medium mb-0.5 ${
                  isToday ? 'bg-primary-600 text-white w-5 h-5 rounded-full flex items-center justify-center' : 'text-neutral-700 dark:text-neutral-300'
                }`}>
                  {format(d, 'd')}
                </div>
                <div className="space-y-0.5">
                  {dayShifts.slice(0, 3).map((s) => {
                    const colorClass = memberNames
                      ? userColorMap.get(s.user_id) || MEMBER_COLORS[0]
                      : STATUS_COLORS[s.status];
                    return (
                      <div
                        key={s.id}
                        onClick={(e) => { e.stopPropagation(); onShiftClick?.(s); }}
                        className={`text-[10px] leading-tight px-1 py-0.5 rounded border truncate cursor-pointer hover:opacity-80 transition ${colorClass}`}
                      >
                        {memberNames ? (
                          <span>{memberNames.get(s.user_id)?.charAt(0) || '?'} {s.start_time.slice(0, 5)}-{s.end_time.slice(0, 5)}</span>
                        ) : (
                          <span>{s.start_time.slice(0, 5)}-{s.end_time.slice(0, 5)}</span>
                        )}
                      </div>
                    );
                  })}
                  {dayShifts.length > 3 && (
                    <div className="text-[10px] text-neutral-500 dark:text-neutral-400">+{dayShifts.length - 3}件</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {memberNames ? (
          [...userColorMap.entries()].map(([uid, colorClass]) => {
            const bgClass = colorClass.split(' ')[0];
            return (
              <div key={uid} className="flex items-center gap-1">
                <div className={`w-2.5 h-2.5 rounded-full ${bgClass.replace('100', '400')}`} />
                <span className="text-neutral-600 dark:text-neutral-400">{memberNames.get(uid) || '不明'}</span>
              </div>
            );
          })
        ) : (
          Object.entries({ pending: '申請中', approved: '承認済', rejected: '却下', modified: '修正', cancelled: '取消' }).map(([key, label]) => (
            <div key={key} className="flex items-center gap-1">
              <div className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[key]}`} />
              <span className="text-neutral-600 dark:text-neutral-400">{label}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
