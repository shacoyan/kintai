import { useMemo, useState } from 'react';
import { format, startOfWeek, addDays, startOfMonth, endOfMonth, isSameMonth, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, ChevronRight as NextPrefIcon } from 'lucide-react';
import type { ShiftPreference } from '../../types';
import { PreferenceActionRow } from './PreferenceActionRow';
import { getPreferenceTheme } from '../../lib/preferenceTheme';
import { EmptyState } from '../ui';
import { formatTimeRangeA11y } from '../../utils/formatTimeRange';

interface ShiftPreferenceCalendarProps {
  preferences: ShiftPreference[];
  onDateClick: (date: string) => void;
  memberNames?: Map<string, string>;
  canManageTenant?: boolean;
  onApprovePreference?: (id: string, startTime?: string, endTime?: string) => Promise<void>;
  onRejectPreference?: (id: string) => Promise<void>;
  canManageStore?: (storeId: string | null) => boolean;
  onMutated?: () => void;
}

const MEMBER_TONE_CLASSES = [
  'bg-primary-50 text-primary-700',
  'bg-success-50 text-success-500',
  'bg-info-50 text-info-500',
  'bg-warning-50 text-warning-500',
  'bg-danger-50 text-danger-500',
  'bg-neutral-100 text-neutral-700',
];

export function ShiftPreferenceCalendar({
  preferences,
  onDateClick,
  memberNames,
  canManageTenant,
  onApprovePreference,
  onRejectPreference,
  canManageStore,
  onMutated,
}: ShiftPreferenceCalendarProps) {
  const [baseDate, setBaseDate] = useState(() => new Date());

  const dates = useMemo(() => {
    const result: Date[] = [];
    const monthStart = startOfMonth(baseDate);
    const monthEnd = endOfMonth(baseDate);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    let d = calStart;
    while (d <= monthEnd || result.length % 7 !== 0) {
      result.push(d);
      d = addDays(d, 1);
    }
    return result;
  }, [baseDate]);

  const userToneMap = useMemo(() => {
    const map = new Map<string, string>();
    const uniqueUsers = [...new Set(preferences.map((p) => p.user_id))];
    uniqueUsers.forEach((uid, i) => {
      map.set(uid, MEMBER_TONE_CLASSES[i % MEMBER_TONE_CLASSES.length]);
    });
    return map;
  }, [preferences]);

  const preferencesByDate = useMemo(() => {
    const map = new Map<string, ShiftPreference[]>();
    for (const p of preferences) {
      const arr = map.get(p.date) || [];
      arr.push(p);
      map.set(p.date, arr);
    }
    return map;
  }, [preferences]);

  const navigate = (dir: number) => {
    setBaseDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + dir, 1));
  };

  const isCurrentMonthEmpty = useMemo(() => {
    return !preferences.some((p) => isSameMonth(parseISO(p.date), baseDate));
  }, [preferences, baseDate]);

  const nextPrefMonth = useMemo<Date | null>(() => {
    let nextDate: Date | null = null;
    for (const p of preferences) {
      const pDate = parseISO(p.date);
      if (pDate > endOfMonth(baseDate)) {
        if (!nextDate || pDate < nextDate) {
          nextDate = pDate;
        }
      }
    }
    return nextDate;
  }, [preferences, baseDate]);

  const navigateToNextPrefMonth = () => {
    if (nextPrefMonth) {
      setBaseDate(startOfMonth(nextPrefMonth));
    }
  };

  const today = format(new Date(), 'yyyy-MM-dd');
  const weekDays = ['月', '火', '水', '木', '金', '土', '日'];

  const isAdminView = !!canManageTenant && !!memberNames;

  // SP 用: 当月かつ希望が 1 件以上ある日付のみ抽出（admin view 限定）
  const dailyGroups = useMemo(() => {
    if (!isAdminView) return [] as Array<{ date: Date; dateStr: string; prefs: ShiftPreference[] }>;
    const groups: Array<{ date: Date; dateStr: string; prefs: ShiftPreference[] }> = [];
    for (const d of dates) {
      if (d.getMonth() !== baseDate.getMonth()) continue;
      const dateStr = format(d, 'yyyy-MM-dd');
      const prefs = preferencesByDate.get(dateStr);
      if (!prefs || prefs.length === 0) continue;
      groups.push({ date: d, dateStr, prefs });
    }
    return groups;
  }, [isAdminView, dates, baseDate, preferencesByDate]);

  return (
    <div className="flex flex-col gap-3">
      {/* ナビゲーション */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-10 h-10 inline-flex items-center justify-center rounded-md text-neutral-500 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 focus-ring"
          aria-label="前月"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-center">
          <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">
            {format(baseDate, 'yyyy年M月', { locale: ja })}
          </p>
          <button
            type="button"
            onClick={() => setBaseDate(new Date())}
            className="text-[11px] font-semibold text-primary-600 dark:text-primary-400 hover:underline mt-0.5"
          >
            今月へ戻る
          </button>
        </div>
        <button
          type="button"
          onClick={() => navigate(1)}
          className="w-10 h-10 inline-flex items-center justify-center rounded-md text-neutral-500 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 focus-ring"
          aria-label="次月"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* empty state バナー */}
      {isCurrentMonthEmpty && (
        <EmptyState
          tone="warning"
          title="今月のシフト希望はまだありません"
          action={nextPrefMonth ? { label: '次の希望がある月へ', onClick: navigateToNextPrefMonth, iconRight: <NextPrefIcon className="w-3 h-3" /> } : undefined}
        />
      )}

      {/* 曜日ヘッダ — admin は SP で隠す / self は従来どおり全画面サイズで表示 */}
      <div
        className={
          (isAdminView ? 'hidden md:grid' : 'grid') +
          ' grid-cols-7 gap-1 md:gap-2 px-0.5'
        }
      >
        {weekDays.map((d, i) => (
          <div
            key={d}
            className={
              'text-center text-[11px] font-semibold ' +
              (i === 5
                ? 'text-info-500'
                : i === 6
                ? 'text-danger-500'
                : 'text-neutral-500 dark:text-neutral-300')
            }
          >
            {d}
          </div>
        ))}
      </div>

      {/* 日マス — admin は SP で隠す / self は従来どおり */}
      <div
        className={
          (isAdminView ? 'hidden md:grid' : 'grid') +
          ' grid-cols-7 gap-1 md:gap-2'
        }
        role="grid"
        aria-label="シフト希望カレンダー"
        style={isAdminView ? { gridAutoRows: 'minmax(88px, auto)' } : { gridAutoRows: '1fr' }}
      >
        {dates.map((d, idx) => {
          const dateStr = format(d, 'yyyy-MM-dd');
          const isToday = dateStr === today;
          const isCurrentMonth = d.getMonth() === baseDate.getMonth();
          const dayPrefs = preferencesByDate.get(dateStr) || [];
          const dayOfWeek = idx % 7;

          const primaryPref = dayPrefs[0];
          const theme = primaryPref ? getPreferenceTheme(primaryPref.preference_type) : null;
          const hasTime =
            primaryPref?.preference_type !== 'unavailable' &&
            !!primaryPref?.start_time &&
            !!primaryPref?.end_time;

          const pendingCount = dayPrefs.filter(p => p.status === 'pending').length;

          const baseCell = isAdminView
            ? 'min-h-[88px] lg:min-h-[120px] rounded-lg flex flex-col items-stretch gap-0.5 text-[11px] motion-safe:transition-colors duration-120 ease-out-expo focus-ring select-none cursor-pointer relative'
            : 'min-h-[56px] md:min-h-[72px] rounded-lg flex flex-col items-center justify-center gap-0.5 text-[11px] motion-safe:transition-colors duration-120 ease-out-expo focus-ring select-none cursor-pointer';

          let stateCell: string;
          if (!isCurrentMonth) {
            stateCell = 'bg-neutral-100 text-neutral-500 cursor-not-allowed dark:bg-neutral-800 dark:text-neutral-500';
          } else if (theme && !isAdminView) {
            stateCell = theme.cellClass + ' hover:opacity-90';
          } else {
            stateCell =
              'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50 dark:bg-neutral-900 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800';
          }
          const todayRing = isToday ? ' ring-2 ring-primary-500' : '';
          const dayNumColor =
            !isCurrentMonth
              ? 'text-neutral-500 dark:text-neutral-500'
              : dayOfWeek === 6
              ? 'text-danger-500'
              : dayOfWeek === 5
              ? 'text-info-500'
              : 'text-neutral-700 dark:text-neutral-300';

          const ariaLabel = `${format(d, 'yyyy年M月d日 (E)', { locale: ja })}${
            primaryPref ? ` ${getPreferenceTheme(primaryPref.preference_type).label}` : ''
          }${
            primaryPref && primaryPref.start_time && primaryPref.end_time
              ? ` ${formatTimeRangeA11y(primaryPref.start_time, primaryPref.end_time)}`
              : ''
          }`;

          const MAX_VISIBLE = 3;
          const visiblePrefs = dayPrefs.slice(0, MAX_VISIBLE);
          const overflowCount = dayPrefs.length - MAX_VISIBLE;

          const cellChildren = (
            <>
              <div className="flex items-center justify-between px-0.5 pt-0.5 md:px-1 md:pt-1">
                <span
                  className={
                    'text-xs font-semibold tabular-nums ' +
                    (theme && !isAdminView ? '' : dayNumColor)
                  }
                >
                  {format(d, 'd')}
                </span>
                {isAdminView && pendingCount > 0 && (
                  <span className="bg-warning-500 dark:bg-warning-400 text-white rounded-full w-4 h-4 inline-flex items-center justify-center text-[9px] font-semibold tabular-nums leading-none">
                    {pendingCount}
                  </span>
                )}
              </div>

              {/* スタッフビュー: 時間 or アイコン */}
              {!isAdminView && primaryPref && theme && (
                <>
                  {hasTime && primaryPref.start_time && primaryPref.end_time ? (
                    <span className="text-[10px] font-semibold tabular-nums leading-none">
                      {primaryPref.start_time.slice(0, 5)}
                    </span>
                  ) : (
                    <theme.Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                </>
              )}

              {/* 店長ビュー: 最大 3 件 PreferenceActionRow 表示 + +N件 */}
              {isAdminView && dayPrefs.length > 0 && (
                <div className="flex flex-col gap-0.5 px-0.5 pb-1 w-full">
                  {visiblePrefs.map(p => {
                    const tone = userToneMap.get(p.user_id) ?? MEMBER_TONE_CLASSES[0];
                    return (
                      <div
                        key={p.id}
                        className={tone + ' rounded-sm px-1 py-0.5 w-full'}
                      >
                        <PreferenceActionRow
                          preference={p}
                          memberName={memberNames?.get(p.user_id)}
                          memberDotClass={tone.split(' ')[0]}
                          onApprove={onApprovePreference ?? (async () => {})}
                          onReject={onRejectPreference ?? (async () => {})}
                          canManage={canManageStore?.(p.store_id) ?? false}
                          variant="compact"
                          onMutated={onMutated}
                        />
                      </div>
                    );
                  })}
                  {overflowCount > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDateClick(dateStr);
                      }}
                      className="w-full text-left text-[10px] text-primary-600 dark:text-primary-400 px-1 hover:underline"
                    >
                      +{overflowCount}件
                    </button>
                  )}
                </div>
              )}
            </>
          );

          return isAdminView ? (
            <div
              key={dateStr}
              role="gridcell"
              tabIndex={isCurrentMonth ? 0 : -1}
              aria-label={ariaLabel}
              aria-disabled={!isCurrentMonth}
              onClick={() => isCurrentMonth && onDateClick(dateStr)}
              onKeyDown={(e) => {
                if (!isCurrentMonth) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onDateClick(dateStr);
                }
              }}
              className={baseCell + ' ' + stateCell + todayRing + (!isCurrentMonth ? ' opacity-60' : '')}
            >
              {cellChildren}
            </div>
          ) : (
            <button
              key={dateStr}
              type="button"
              role="gridcell"
              aria-label={ariaLabel}
              aria-pressed={!!primaryPref && !isAdminView}
              disabled={!isCurrentMonth}
              onClick={() => isCurrentMonth && onDateClick(dateStr)}
              className={baseCell + ' ' + stateCell + todayRing}
            >
              {cellChildren}
            </button>
          );
        })}
      </div>

      {/* SP admin: 日次グループ縦リスト（md 未満のみ） */}
      {isAdminView && (
        <div className="md:hidden flex flex-col gap-2">
          {dailyGroups.length === 0 && !isCurrentMonthEmpty && (
            <p className="text-xs text-neutral-500 dark:text-neutral-300 text-center py-4">
              この月の希望データがありません
            </p>
          )}
          {dailyGroups.map(({ date, dateStr, prefs }) => {
            const dayOfWeek = (date.getDay() + 6) % 7; // 月=0..日=6
            const isToday = dateStr === today;
            const pendingCount = prefs.filter((p) => p.status === 'pending').length;
            const dayColor =
              dayOfWeek === 6
                ? 'text-danger-500'
                : dayOfWeek === 5
                ? 'text-info-500'
                : 'text-neutral-700 dark:text-neutral-300';
            return (
              <div
                key={dateStr}
                className={
                  'rounded-lg border bg-white dark:bg-neutral-900 ' +
                  (isToday
                    ? 'border-primary-500 ring-1 ring-primary-500'
                    : 'border-neutral-200 dark:border-neutral-700')
                }
              >
                <button
                  type="button"
                  onClick={() => onDateClick(dateStr)}
                  className="w-full flex items-center justify-between px-3 py-2.5 border-b border-neutral-100 dark:border-neutral-700 focus-ring rounded-t-lg hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  aria-label={`${format(date, 'M月d日 (E)', { locale: ja })} の希望一覧を開く`}
                >
                  <span className={'text-sm font-semibold tabular-nums ' + dayColor}>
                    {format(date, 'M月d日 (E)', { locale: ja })}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    {pendingCount > 0 && (
                      <span className="bg-warning-500 dark:bg-warning-400 text-white rounded-full px-1.5 h-4 inline-flex items-center text-[10px] font-semibold tabular-nums leading-none">
                        未対応 {pendingCount}
                      </span>
                    )}
                    <span className="text-[11px] text-neutral-500 dark:text-neutral-300 tabular-nums">
                      {prefs.length}件
                    </span>
                  </span>
                </button>
                <ul className="divide-y divide-neutral-100 dark:divide-neutral-700">
                  {prefs.map((p) => {
                    const tone = userToneMap.get(p.user_id) ?? MEMBER_TONE_CLASSES[0];
                    return (
                      <li key={p.id} className="px-3 py-2">
                        <PreferenceActionRow
                          preference={p}
                          memberName={memberNames?.get(p.user_id)}
                          memberDotClass={tone.split(' ')[0]}
                          onApprove={onApprovePreference ?? (async () => {})}
                          onReject={onRejectPreference ?? (async () => {})}
                          canManage={canManageStore?.(p.store_id) ?? false}
                          variant="full"
                          onMutated={onMutated}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

