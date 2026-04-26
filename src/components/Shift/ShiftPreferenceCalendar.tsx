import { useMemo, useState } from 'react';
import { format, startOfWeek, addDays, startOfMonth, endOfMonth } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, CheckCircle2, Circle, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ShiftPreference, ShiftPreferenceType } from '../../types';

interface ShiftPreferenceCalendarProps {
  preferences: ShiftPreference[];
  onDateClick: (date: string) => void;
  memberNames?: Map<string, string>;
  canManageTenant?: boolean;
}

interface PrefStyle {
  Icon: LucideIcon;
  cellClass: string;
  dot: string;
  text: string;
  label: string;
}

const PREFERENCE_STYLE: Record<ShiftPreferenceType, PrefStyle> = {
  preferred: {
    Icon: CheckCircle2,
    cellClass: 'bg-primary-50 ring-1 ring-primary-300 text-primary-700',
    dot: 'bg-primary-500',
    text: 'text-primary-700',
    label: '希望',
  },
  available: {
    Icon: Circle,
    cellClass: 'bg-info-50 ring-1 ring-info-500/40 text-info-500',
    dot: 'bg-info-500',
    text: 'text-info-500',
    label: '出勤可能',
  },
  unavailable: {
    Icon: XCircle,
    cellClass: 'bg-warning-50 ring-1 ring-warning-500/40 text-warning-500',
    dot: 'bg-warning-500',
    text: 'text-warning-500',
    label: '出勤不可',
  },
};

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

  const today = format(new Date(), 'yyyy-MM-dd');
  const weekDays = ['月', '火', '水', '木', '金', '土', '日'];

  const isAdminView = !!canManageTenant && !!memberNames;

  return (
    <div className="flex flex-col gap-3">
      {/* ナビゲーション */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-10 h-10 inline-flex items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 focus-ring"
          aria-label="前月"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-center">
          <p className="text-base font-semibold text-neutral-900 tabular-nums">
            {format(baseDate, 'yyyy年M月', { locale: ja })}
          </p>
          <button
            type="button"
            onClick={() => setBaseDate(new Date())}
            className="text-[11px] font-semibold text-primary-600 hover:underline mt-0.5"
          >
            今月へ戻る
          </button>
        </div>
        <button
          type="button"
          onClick={() => navigate(1)}
          className="w-10 h-10 inline-flex items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 focus-ring"
          aria-label="次月"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* 曜日ヘッダ */}
      <div className="grid grid-cols-7 gap-1.5 px-0.5">
        {weekDays.map((d, i) => (
          <div
            key={d}
            className={
              'text-center text-[11px] font-semibold ' +
              (i === 5
                ? 'text-info-500'
                : i === 6
                ? 'text-danger-500'
                : 'text-neutral-500')
            }
          >
            {d}
          </div>
        ))}
      </div>

      {/* 日マス */}
      <div className="grid grid-cols-7 gap-1.5" role="grid" aria-label="シフト希望カレンダー">
        {dates.map((d, idx) => {
          const dateStr = format(d, 'yyyy-MM-dd');
          const isToday = dateStr === today;
          const isCurrentMonth = d.getMonth() === baseDate.getMonth();
          const dayPrefs = preferencesByDate.get(dateStr) || [];
          const dayOfWeek = idx % 7;

          // スタッフビューでは自分の希望は通常 1 件
          const primaryPref = dayPrefs[0];
          const style = primaryPref ? PREFERENCE_STYLE[primaryPref.preference_type] : null;
          const hasTime =
            primaryPref?.preference_type !== 'unavailable' &&
            !!primaryPref?.start_time &&
            !!primaryPref?.end_time;

          const baseCell =
            'aspect-square min-h-[44px] md:min-h-[56px] rounded-lg flex flex-col ' +
            'items-center justify-center gap-0.5 text-[11px] transition-colors duration-120 ' +
            'focus-ring select-none';

          let stateCell: string;
          if (!isCurrentMonth) {
            stateCell = 'bg-neutral-100 text-neutral-500 cursor-not-allowed';
          } else if (style && !isAdminView) {
            stateCell = style.cellClass + ' hover:opacity-90';
          } else {
            stateCell =
              'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50';
          }
          const todayRing = isToday ? ' ring-2 ring-primary-500' : '';
          const dayNumColor =
            !isCurrentMonth
              ? 'text-neutral-500'
              : dayOfWeek === 6
              ? 'text-danger-500'
              : dayOfWeek === 5
              ? 'text-info-500'
              : 'text-neutral-700';

          const ariaLabel = `${format(d, 'yyyy年M月d日 (E)', { locale: ja })}${
            primaryPref ? ` ${PREFERENCE_STYLE[primaryPref.preference_type].label}` : ''
          }`;

          return (
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
              <span
                className={
                  'text-xs font-semibold tabular-nums ' +
                  (style && !isAdminView ? '' : dayNumColor)
                }
              >
                {format(d, 'd')}
              </span>

              {/* スタッフビュー: 時間 or アイコン */}
              {!isAdminView && primaryPref && style && (
                <>
                  {hasTime && primaryPref.start_time && primaryPref.end_time ? (
                    <span className="text-[9px] font-semibold tabular-nums leading-none">
                      {primaryPref.start_time.slice(0, 5)}
                    </span>
                  ) : (
                    <style.Icon className="w-3 h-3" aria-hidden="true" />
                  )}
                </>
              )}

              {/* 店長ビュー: 人数 + tone dots */}
              {isAdminView && dayPrefs.length > 0 && (
                <div className="flex items-center gap-0.5">
                  {dayPrefs.slice(0, 3).map((p) => {
                    const tone = userToneMap.get(p.user_id) ?? MEMBER_TONE_CLASSES[0];
                    return (
                      <span
                        key={p.id}
                        className={'w-1.5 h-1.5 rounded-full ' + tone.split(' ')[0]}
                        aria-hidden="true"
                      />
                    );
                  })}
                  {dayPrefs.length > 3 && (
                    <span className="text-[9px] font-semibold text-neutral-500 tabular-nums ml-0.5">
                      +{dayPrefs.length - 3}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* 凡例 */}
      <div className="px-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-600">
        {isAdminView && memberNames ? (
          [...userToneMap.entries()].slice(0, 6).map(([uid, tone]) => (
            <div key={uid} className="inline-flex items-center gap-1.5">
              <span
                className={'w-2 h-2 rounded-full ' + tone.split(' ')[0]}
                aria-hidden="true"
              />
              <span className="text-neutral-700">{memberNames.get(uid) ?? '不明'}</span>
            </div>
          ))
        ) : (
          (Object.entries(PREFERENCE_STYLE) as Array<
            [ShiftPreferenceType, PrefStyle]
          >).map(([key, st]) => (
            <div key={key} className="inline-flex items-center gap-1.5">
              <span
                className={'inline-block w-2.5 h-2.5 rounded-sm ' + st.dot}
                aria-hidden="true"
              />
              <span>{st.label}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
