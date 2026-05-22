import { useState, useMemo, useEffect } from 'react';
import { format, startOfWeek, addDays, startOfMonth, endOfMonth, addWeeks, isAfter, startOfDay, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Shift, LeaveRequest, ShiftPreference } from '../../types';
import type { StatusFilterValue } from './unifiedShiftTypes';
import { EmptyState } from '../ui';
import { isJapaneseHoliday, getJapaneseHolidayName } from '../../lib/holidays';
import { formatTimeRange } from '../../utils/formatTimeRange';
import { getInitialShiftMonth } from '../../utils/initialShiftMonth';

type ViewMode = 'week' | '2week' | 'month';

interface ShiftCalendarProps {
  shifts: Shift[];
  onDateClick: (date: string) => void;
  onShiftClick?: (shift: Shift) => void;
  /** member display_name map for admin view */
  memberNames?: Map<string, string>;
  onViewMonthChange?: (date: Date) => void;
  /** leave requests */
  leaves?: LeaveRequest[];
  /** shift preferences to display (pending only for separate row display) */
  preferences?: ShiftPreference[];
  onPreferenceClick?: (pref: ShiftPreference) => void;
  statusFilter?: Set<StatusFilterValue>;
  /**
   * pending_preference の表示制御。
   * - true: statusFilter の pending_preference エントリに従う（admin 全員モード）
   * - false (default): UI に control が無いコンテキスト（self モード等）→ statusFilter の
   *   pending_preference 設定を無視し、常に pending 申請を表示する。
   */
  showPreferenceStatus?: boolean;
  currentUserId?: string | null;
}

const MEMBER_COLORS = [
  'bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300',
  'bg-member-3-100 border-member-3-300 text-member-3-800 dark:bg-member-3-100/20 dark:border-member-3-300/40 dark:text-member-3-100',
  'bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300',
  'bg-member-4-100 border-member-4-300 text-member-4-800 dark:bg-member-4-100/20 dark:border-member-4-300/40 dark:text-member-4-100',
  'bg-member-6-100 border-member-6-300 text-member-6-800 dark:bg-member-6-100/20 dark:border-member-6-300/40 dark:text-member-6-100',
  'bg-member-2-100 border-member-2-300 text-member-2-800 dark:bg-member-2-100/20 dark:border-member-2-300/40 dark:text-member-2-100',
  'bg-member-1-100 border-member-1-300 text-member-1-800 dark:bg-member-1-100/20 dark:border-member-1-300/40 dark:text-member-1-100',
  'bg-member-9-100 border-member-9-300 text-member-9-800 dark:bg-member-9-100/20 dark:border-member-9-300/40 dark:text-member-9-100',
  'bg-member-5-100 border-member-5-300 text-member-5-800 dark:bg-member-5-100/20 dark:border-member-5-300/40 dark:text-member-5-100',
  'bg-member-8-100 border-member-8-300 text-member-8-800 dark:bg-member-8-100/20 dark:border-member-8-300/40 dark:text-member-8-100',
];

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-warning-100 border-warning-300 text-warning-800 dark:bg-warning-900/30 dark:border-warning-700 dark:text-warning-300',
  tentative: 'bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300',
  approved: 'bg-success-100 border-success-300 text-success-800 dark:bg-success-900/30 dark:border-success-700 dark:text-success-300',
  rejected: 'bg-danger-100 border-danger-300 text-danger-800 dark:bg-danger-900/30 dark:border-danger-700 dark:text-danger-300',
  modified: 'bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300',
  cancelled: 'bg-stone-100 border-stone-300 text-stone-500 dark:bg-stone-700 dark:border-stone-600 dark:text-stone-300',
};

const LEAVE_TYPE_DOT: Record<string, string> = {
  paid: 'bg-success-500',
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

export function ShiftCalendar({ shifts, onDateClick, onShiftClick, memberNames, onViewMonthChange, leaves = [], preferences, onPreferenceClick, statusFilter, showPreferenceStatus = false, currentUserId }: ShiftCalendarProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [baseDate, setBaseDate] = useState(getInitialShiftMonth);
  useEffect(() => { onViewMonthChange?.(baseDate); }, [baseDate, onViewMonthChange]);

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
    const pendingPrefs = (preferences ?? []).filter(p => p.status === 'pending');
    const uniqueUsers = [...new Set([...shifts.map(s => s.user_id), ...pendingPrefs.map(p => p.user_id)])];
    uniqueUsers.forEach((uid, i) => {
      map.set(uid, MEMBER_COLORS[i % MEMBER_COLORS.length]);
    });
    return map;
  }, [shifts, preferences]);

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const s of shifts) {
      const passesFilter =
        s.status === 'pending' ||
        !statusFilter ||
        statusFilter.has(s.status as StatusFilterValue);
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

  const navigate = (dir: number) => {
    if (viewMode === 'month') {
      setBaseDate(prev => new Date(prev.getFullYear(), prev.getMonth() + dir, 1));
    } else if (viewMode === '2week') {
      setBaseDate(prev => addWeeks(prev, dir * 2));
    } else {
      setBaseDate(prev => addWeeks(prev, dir));
    }
  };

  const isCurrentMonthEmpty = useMemo(() => {
    if (viewMode !== 'month') return false;
    const monthStart = startOfMonth(baseDate);
    const monthEnd = endOfMonth(baseDate);
    return !shifts.some(s => {
      const shiftDate = parseISO(s.date);
      return !isAfter(monthStart, shiftDate) && !isAfter(shiftDate, monthEnd);
    });
  }, [viewMode, baseDate, shifts]);

  const navigateToNextShiftMonth = () => {
    const baseDateStart = startOfDay(baseDate);
    const futureShifts = shifts.filter(s => isAfter(parseISO(s.date), baseDateStart));
    if (futureShifts.length === 0) return;
    const nearestShift = futureShifts.reduce((nearest, current) => {
      const currentDate = parseISO(current.date);
      const nearestDate = parseISO(nearest.date);
      return isAfter(nearestDate, currentDate) ? current : nearest;
    });
    const nextDate = parseISO(nearestShift.date);
    setBaseDate(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
  };

  const today = format(new Date(), 'yyyy-MM-dd');
  const weekDays = ['月', '火', '水', '木', '金', '土', '日'];

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} aria-label="前月" className="p-2 rounded-md hover:bg-stone-100 dark:hover:bg-stone-700 motion-safe:transition-colors duration-150 ease-out">
            <ChevronLeft className="w-5 h-5 text-stone-600 dark:text-stone-300" />
          </button>
          <span className="text-sm font-semibold text-stone-900 dark:text-stone-100 min-w-[120px] text-center">
            {viewMode === 'month'
              ? format(baseDate, 'yyyy年M月', { locale: ja })
              : `${format(dates[0], 'M/d')} - ${format(dates[dates.length - 1], 'M/d')}`
            }
          </span>
          <button onClick={() => navigate(1)} aria-label="次月" className="p-2 rounded-md hover:bg-stone-100 dark:hover:bg-stone-700 motion-safe:transition-colors duration-150 ease-out">
            <ChevronRight className="w-5 h-5 text-stone-600 dark:text-stone-300" />
          </button>
          <button
            onClick={() => setBaseDate(new Date())}
            className="px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 motion-safe:transition-colors duration-150 ease-out"
          >
            今日
          </button>
        </div>

        {/* 理由: ViewMode タブ切替の装飾。border 削除し shadow で枠を表現 */}
        <div className="flex rounded-md overflow-hidden shadow-sm" role="tablist">
          {(['week', '2week', 'month'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              role="tab"
              aria-selected={viewMode === mode}
              className={`px-3 py-1 text-xs font-medium motion-safe:transition-colors duration-150 ease-out ${
                viewMode === mode
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700'
              }`}
            >
              {mode === 'week' ? '週' : mode === '2week' ? '2週' : '月'}
            </button>
          ))}
        </div>
      </div>

      {/* Loop16-A: メンバー一覧凡例は削除。userColorMap はカレンダー内アイテムの色付けで継続利用。 */}

      {/* Empty state banner */}
      {isCurrentMonthEmpty && (
        <EmptyState
          tone="info"
          title="今月のシフトはまだありません"
          action={shifts.some(s => isAfter(parseISO(s.date), startOfDay(baseDate))) ? { label: '次のシフトがある月へ', onClick: navigateToNextShiftMonth, iconRight: <ChevronRight className="w-4 h-4" />, variant: 'tertiary' } : undefined}
        />
      )}

      {/* Calendar grid */}
      <div className="bg-white dark:bg-stone-800 rounded-lg shadow overflow-hidden">
        {/* 理由: 曜日ヘッダーとセル領域の divider */}
        {/* Header */}
        <div className="grid grid-cols-7 bg-stone-50 dark:bg-stone-700 border-b border-stone-200 dark:border-stone-700">
          {weekDays.map((d, i) => (
            <div key={i} className={`text-center py-2 text-xs font-medium ${
              i === 5 ? 'text-blue-600 dark:text-blue-400' : i === 6 ? 'text-danger-600 dark:text-danger-400' : 'text-stone-500 dark:text-stone-300'
            }`}>
              {d}
            </div>
          ))}
        </div>

        {/* Cells */}
        {/* 理由: カレンダーセル間の divider grid */}
        <div className="grid grid-cols-7" role="grid" aria-label="シフトカレンダー">
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

            const leaveTooltip = dayLeaves.map(l => {
              const typeLabel = LEAVE_TYPE_LABEL[l.leave_type] || 'その他';
              const name = memberNames?.get(l.user_id) || '';
              return name ? `${typeLabel} - ${name}` : typeLabel;
            }).join('\n');

            return (
              <div
                key={dateStr}
                role="button"
                tabIndex={0}
                aria-label={`${dateStr} の詳細${holidayName ? ` (${holidayName})` : ''}`}
                onClick={() => onDateClick(dateStr)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onDateClick(dateStr);
                  }
                }}
                className={`relative min-h-[70px] sm:min-h-[80px] border-b border-r border-stone-100 dark:border-stone-700 p-1 cursor-pointer motion-safe:transition-colors duration-150 ease-out ${
                  !isCurrentMonth ? 'bg-stone-50 dark:bg-stone-700/50 opacity-50' : ''
                } ${
                  isCurrentMonth && isHoliday ? 'bg-weekend-holiday-50 dark:bg-weekend-holiday-900/30' : ''
                } ${
                  isCurrentMonth && !isHoliday && dayOfWeek === 6 ? 'bg-weekend-saturday-50 dark:bg-weekend-saturday-900/30' : ''
                } ${
                  isCurrentMonth && !isHoliday && dayOfWeek === 0 ? 'bg-weekend-sunday-50 dark:bg-weekend-sunday-900/30' : ''
                } ${
                  isCurrentMonth ? 'hover:bg-stone-50 dark:hover:bg-stone-700' : ''
                }`}
              >
                <div className={`text-xs font-medium mb-0.5 ${
                  isToday
                    ? 'bg-blue-600 text-white w-5 h-5 rounded-full flex items-center justify-center'
                    : isHoliday && isCurrentMonth
                      ? 'text-weekend-holiday-700 dark:text-weekend-holiday-100'
                      : 'text-stone-700 dark:text-stone-300'
                }`}>
                  {format(d, 'd')}
                </div>
                <div className="space-y-0.5">
                  {dayShifts.map((s) => {
                    const colorClass = memberNames
                      ? userColorMap.get(s.user_id) || MEMBER_COLORS[0]
                      : STATUS_COLORS[s.status];
                    const isMine = !!currentUserId && !!memberNames && s.user_id === currentUserId;
                    // 理由: shift バーの rounded border は member 色チップの枠線（MEMBER_COLORS の border 色とセット）
                    return (
                      <div
                        key={s.id}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); onShiftClick?.(s); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            e.preventDefault();
                            onShiftClick?.(s);
                          }
                        }}
                        className={`text-[11px] sm:text-[10px] leading-tight min-h-[24px] sm:min-h-0 px-1.5 sm:px-1 py-1 sm:py-0.5 rounded border truncate cursor-pointer hover:opacity-80 motion-safe:transition-opacity duration-150 ease-out ${colorClass} ${isMine ? 'border-l-4 border-l-blue-600 dark:border-l-blue-400 font-semibold' : ''}`}
                      >
                        {memberNames ? (
                          <span title={memberNames.get(s.user_id) ?? ''}>
                            {memberNames.get(s.user_id) ?? '不明'} {formatTimeRange(s.start_time, s.end_time, { compactNextDay: true })}
                          </span>
                        ) : (
                          <span>{formatTimeRange(s.start_time, s.end_time, { compactNextDay: true })}</span>
                        )}
                        {/* 理由: 自分のシフト/preference を他メンバーと視覚的に区別するため左ボーダー強調 (§4.3.2) */}
                        {isMine && (
                          <span className="ml-1 inline-block bg-blue-600 text-white text-[8px] px-1 rounded" aria-label="自分のシフト">あなた</span>
                        )}
                      </div>
                    );
                  })}
                  {dayPendingPreferences.map((p) => {
                    const colorBase = userColorMap.get(p.user_id) || MEMBER_COLORS[0];
                    const timeDisplay = (p.start_time && p.end_time)
                      ? formatTimeRange(p.start_time, p.end_time, { compactNextDay: true })
                      : '終日';
                    const isMine = !!currentUserId && !!memberNames && p.user_id === currentUserId;
                    // 理由: preference バーの border border-dashed は申請の視覚識別（pending）に使用
                    return (
                      <div
                        key={'pref-' + p.id}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); onPreferenceClick?.(p); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            e.preventDefault();
                            onPreferenceClick?.(p);
                          }
                        }}
                        className={`text-[11px] sm:text-[10px] leading-tight min-h-[24px] sm:min-h-0 px-1.5 sm:px-1 py-1 sm:py-0.5 rounded border border-dashed truncate cursor-pointer hover:opacity-80 motion-safe:transition-opacity duration-150 ease-out ${colorBase} ${isMine ? 'border-l-4 border-l-blue-600 dark:border-l-blue-400 font-semibold' : ''}`}
                      >
                        {memberNames ? (
                          <span title={memberNames.get(p.user_id) ?? ''}>
                            {memberNames.get(p.user_id) ?? '不明'} {timeDisplay}
                          </span>
                        ) : (
                          <span>{timeDisplay}</span>
                        )}
                        {/* 理由: 自分のシフト/preference を他メンバーと視覚的に区別するため左ボーダー強調 (§4.3.2) */}
                        {isMine && (
                          <span className="ml-1 inline-block bg-blue-600 text-white text-[8px] px-1 rounded" aria-label="自分の申請">あなた</span>
                        )}
                        <span className="ml-1 inline-block bg-warning-50 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300 text-[8px] px-1 rounded">申請</span>
                      </div>
                    );
                  })}
                </div>
                {dayLeaves.length > 0 && (
                  <div title={leaveTooltip} className="absolute bottom-1 right-1 flex items-center gap-0.5">
                    {dayLeaves.slice(0, 4).map((l) => (
                      <span
                        key={l.id}
                        className={`w-1.5 h-1.5 rounded-full ${LEAVE_TYPE_DOT[l.leave_type] || 'bg-blue-500'} ${
                          l.status === 'pending' ? 'ring-1 ring-warning-400' : ''
                        }`}
                      />
                    ))}
                    {dayLeaves.length > 4 && (
                      <span className="text-[8px] text-stone-500 dark:text-stone-300 leading-none">
                        +{dayLeaves.length - 4}
                      </span>
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
