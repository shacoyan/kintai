import { useMemo, useState } from 'react';
import { format, startOfWeek, addDays, startOfMonth, endOfMonth, isSameMonth, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ChevronRight as NextPrefIcon } from 'lucide-react';
import type { ShiftPreference } from '../../types';
import { PreferenceActionRow } from './PreferenceActionRow';
import { getPreferenceTheme, PREFERENCE_THEME_LIST } from '../../lib/preferenceTheme';
import { EmptyState } from '../ui';

interface ShiftPreferenceCalendarProps {
  preferences: ShiftPreference[];
  onDateClick: (date: string) => void;
  memberNames?: Map<string, string>;
  canManageTenant?: boolean;
  onApprovePreference?: (id: string, startTime?: string, endTime?: string) => Promise<void>;
  onRejectPreference?: (id: string) => Promise<void>;
  canManageStore?: (storeId: string | null) => boolean;
  onMutated?: () => void;
  showStatusLegend?: boolean;
}

const MEMBER_TONE_CLASSES = [
  'bg-primary-50 text-primary-700',
  'bg-success-50 text-success-500',
  'bg-info-50 text-info-500',
  'bg-warning-50 text-warning-500',
  'bg-danger-50 text-danger-500',
  'bg-neutral-100 text-neutral-700',
];

const STATUS_LEGEND = [
  { key: 'pending', dot: 'bg-warning-500 dark:bg-warning-400', label: '申請中' },
  { key: 'approved', dot: 'bg-success-500 dark:bg-success-400', label: '承認済' },
  { key: 'rejected', dot: 'bg-danger-500 dark:bg-danger-400', label: '却下' },
  { key: 'modified', dot: 'bg-primary-500 dark:bg-primary-400', label: '修正' },
  { key: 'cancelled', dot: 'bg-neutral-400 dark:bg-neutral-500', label: '取消' },
];

function CalendarLegend({
  showStatusLegend,
  memberNames,
  memberEntries,
  showAllMembers,
  setShowAllMembers,
  isAdminView,
}: {
  showStatusLegend: boolean;
  memberNames?: Map<string, string>;
  memberEntries: Array<[string, string]>;
  showAllMembers: boolean;
  setShowAllMembers: (v: boolean) => void;
  isAdminView: boolean;
}) {
  return (
    <>
      {/* SP: 折りたたみ */}
      <div className="md:hidden">
        <details>
          <summary className="list-none flex items-center gap-1 cursor-pointer text-sm font-semibold text-neutral-700 dark:text-neutral-200 select-none focus-ring rounded">
            凡例
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
          </summary>
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-neutral-600 dark:text-neutral-400">
              {isAdminView && memberNames ? (
                <>
                  {memberEntries.slice(0, 5).map(([uid, tone]) => (
                    <div key={uid} className="inline-flex items-center gap-1.5">
                      <span
                        className={'w-2 h-2 rounded-full ' + tone.split(' ')[0]}
                        aria-hidden="true"
                      />
                      <span className="text-neutral-700 dark:text-neutral-300">{memberNames.get(uid) ?? '不明'}</span>
                    </div>
                  ))}
                  {memberEntries.length > 5 && (
                    <>
                      {!showAllMembers && (
                        <button
                          type="button"
                          onClick={() => setShowAllMembers(true)}
                          className="inline-flex items-center gap-0.5 text-primary-600 dark:text-primary-400 hover:underline focus-ring rounded"
                        >
                          +{memberEntries.length - 5}
                          <ChevronDown className="w-3 h-3" aria-hidden="true" />
                        </button>
                      )}
                      {showAllMembers &&
                        memberEntries.slice(5).map(([uid, tone]) => (
                          <div key={uid} className="inline-flex items-center gap-1.5">
                            <span
                              className={'w-2 h-2 rounded-full ' + tone.split(' ')[0]}
                              aria-hidden="true"
                            />
                            <span className="text-neutral-700 dark:text-neutral-300">{memberNames.get(uid) ?? '不明'}</span>
                          </div>
                        ))}
                      {showAllMembers && (
                        <button
                          type="button"
                          onClick={() => setShowAllMembers(false)}
                          className="inline-flex items-center gap-0.5 text-primary-600 dark:text-primary-400 hover:underline focus-ring rounded"
                        >
                          閉じる
                          <ChevronUp className="w-3 h-3" aria-hidden="true" />
                        </button>
                      )}
                    </>
                  )}
                </>
              ) : (
                PREFERENCE_THEME_LIST.map((theme) => (
                  <div key={theme.type} className="inline-flex items-center gap-1.5">
                    <theme.Icon className="w-3.5 h-3.5" aria-hidden="true" />
                    <span className={'w-2 h-2 rounded-full ' + theme.dotClass} aria-hidden="true" />
                    <span>{theme.label}</span>
                  </div>
                ))
              )}
            </div>
            {showStatusLegend && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                {STATUS_LEGEND.map((s) => (
                  <div key={s.key} className="inline-flex items-center gap-1.5">
                    <span
                      className={'inline-block w-2 h-2 rounded-full ' + s.dot}
                      aria-hidden="true"
                    />
                    <span>{s.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      </div>

      {/* PC: 常時展開 */}
      <div className="hidden md:block px-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-neutral-600 dark:text-neutral-400">
          {isAdminView && memberNames ? (
            <>
              {memberEntries.slice(0, 5).map(([uid, tone]) => (
                <div key={uid} className="inline-flex items-center gap-1.5">
                  <span
                    className={'w-2 h-2 rounded-full ' + tone.split(' ')[0]}
                    aria-hidden="true"
                  />
                  <span className="text-neutral-700 dark:text-neutral-300">{memberNames.get(uid) ?? '不明'}</span>
                </div>
              ))}
              {memberEntries.length > 5 && (
                <>
                  {!showAllMembers && (
                    <button
                      type="button"
                      onClick={() => setShowAllMembers(true)}
                      className="inline-flex items-center gap-0.5 text-primary-600 dark:text-primary-400 hover:underline focus-ring rounded"
                    >
                      +{memberEntries.length - 5}
                      <ChevronDown className="w-3 h-3" aria-hidden="true" />
                    </button>
                  )}
                  {showAllMembers &&
                    memberEntries.slice(5).map(([uid, tone]) => (
                      <div key={uid} className="inline-flex items-center gap-1.5">
                        <span
                          className={'w-2 h-2 rounded-full ' + tone.split(' ')[0]}
                          aria-hidden="true"
                        />
                        <span className="text-neutral-700 dark:text-neutral-300">{memberNames.get(uid) ?? '不明'}</span>
                      </div>
                    ))}
                  {showAllMembers && (
                    <button
                      type="button"
                      onClick={() => setShowAllMembers(false)}
                      className="inline-flex items-center gap-0.5 text-primary-600 dark:text-primary-400 hover:underline focus-ring rounded"
                    >
                      閉じる
                      <ChevronUp className="w-3 h-3" aria-hidden="true" />
                    </button>
                  )}
                </>
              )}
            </>
          ) : (
            PREFERENCE_THEME_LIST.map((theme) => (
              <div key={theme.type} className="inline-flex items-center gap-1.5">
                <theme.Icon className="w-3.5 h-3.5" aria-hidden="true" />
                <span className={'w-2 h-2 rounded-full ' + theme.dotClass} aria-hidden="true" />
                <span>{theme.label}</span>
              </div>
            ))
          )}
        </div>
        {showStatusLegend && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            {STATUS_LEGEND.map((s) => (
              <div key={s.key} className="inline-flex items-center gap-1.5">
                <span
                  className={'inline-block w-2 h-2 rounded-full ' + s.dot}
                  aria-hidden="true"
                />
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function ShiftPreferenceCalendar({
  preferences,
  onDateClick,
  memberNames,
  canManageTenant,
  onApprovePreference,
  onRejectPreference,
  canManageStore,
  onMutated,
  showStatusLegend = false,
}: ShiftPreferenceCalendarProps) {
  const [baseDate, setBaseDate] = useState(() => new Date());
  const [showAllMembers, setShowAllMembers] = useState(false);

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

  const memberEntries = useMemo(() => {
    if (!isAdminView || !memberNames) return [];
    return [...userToneMap.entries()].filter(([uid]) => memberNames.has(uid));
  }, [isAdminView, memberNames, userToneMap]);

  return (
    <div className="flex flex-col gap-3">
      {/* ナビゲーション */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-10 h-10 inline-flex items-center justify-center rounded-md text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 focus-ring"
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
          className="w-10 h-10 inline-flex items-center justify-center rounded-md text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 focus-ring"
          aria-label="次月"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* 凡例 (CalendarLegend) */}
      <CalendarLegend
        showStatusLegend={!!showStatusLegend}
        memberNames={memberNames}
        memberEntries={memberEntries}
        showAllMembers={showAllMembers}
        setShowAllMembers={setShowAllMembers}
        isAdminView={isAdminView}
      />

      {/* empty state バナー */}
      {isCurrentMonthEmpty && (
        <EmptyState
          tone="warning"
          title="今月のシフト希望はまだありません"
          action={nextPrefMonth ? { label: '次の希望がある月へ', onClick: navigateToNextPrefMonth, iconRight: <NextPrefIcon className="w-3 h-3" /> } : undefined}
        />
      )}

      {/* 曜日ヘッダ */}
      <div className="grid grid-cols-7 gap-1 md:gap-1.5 px-0.5">
        {weekDays.map((d, i) => (
          <div
            key={d}
            className={
              'text-center text-[11px] font-semibold ' +
              (i === 5
                ? 'text-info-500'
                : i === 6
                ? 'text-danger-500'
                : 'text-neutral-500 dark:text-neutral-400')
            }
          >
            {d}
          </div>
        ))}
      </div>

      {/* 日マス */}
      <div 
        className="grid grid-cols-7 gap-1 md:gap-1.5" 
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
            ? 'min-h-[88px] lg:min-h-[120px] rounded-lg flex flex-col items-stretch gap-0.5 text-[11px] motion-safe:transition-colors duration-120 focus-ring select-none cursor-pointer relative'
            : 'min-h-[64px] md:min-h-[72px] rounded-lg flex flex-col items-center justify-center gap-0.5 text-[11px] motion-safe:transition-colors duration-120 focus-ring select-none cursor-pointer';

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
          }`;

          const MAX_VISIBLE = 3;
          const visiblePrefs = dayPrefs.slice(0, MAX_VISIBLE);
          const overflowCount = dayPrefs.length - MAX_VISIBLE;

          const cellChildren = (
            <>
              <div className="flex items-center justify-between px-1 pt-1">
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
                    <span className="text-[9px] font-semibold tabular-nums leading-none">
                      {primaryPref.start_time.slice(0, 5)}
                    </span>
                  ) : (
                    <theme.Icon className="w-3 h-3" aria-hidden="true" />
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
    </div>
  );
}
