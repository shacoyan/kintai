import { useState, useMemo } from 'react';
import { format, startOfWeek, addDays, startOfMonth, endOfMonth } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, Circle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ShiftPreference, ShiftPreferenceType } from '../../types';

interface ShiftPreferenceCalendarProps {
  preferences: ShiftPreference[];
  onDateClick: (date: string) => void;
  memberNames?: Map<string, string>;
  isAdmin?: boolean;
}

const MEMBER_COLORS = [
  { bg: 'bg-blue-400', text: 'text-blue-700', light: 'bg-blue-100' },
  { bg: 'bg-emerald-400', text: 'text-emerald-700', light: 'bg-emerald-100' },
  { bg: 'bg-purple-400', text: 'text-purple-700', light: 'bg-purple-100' },
  { bg: 'bg-orange-400', text: 'text-orange-700', light: 'bg-orange-100' },
  { bg: 'bg-pink-400', text: 'text-pink-700', light: 'bg-pink-100' },
  { bg: 'bg-cyan-400', text: 'text-cyan-700', light: 'bg-cyan-100' },
  { bg: 'bg-amber-400', text: 'text-amber-700', light: 'bg-amber-100' },
  { bg: 'bg-indigo-400', text: 'text-indigo-700', light: 'bg-indigo-100' },
  { bg: 'bg-rose-400', text: 'text-rose-700', light: 'bg-rose-100' },
  { bg: 'bg-teal-400', text: 'text-teal-700', light: 'bg-teal-100' },
];

const PREFERENCE_STYLE: Record<ShiftPreferenceType, { Icon: LucideIcon; dot: string; label: string }> = {
  preferred: { Icon: CheckCircle2, dot: 'bg-blue-500', label: '希望' },
  available: { Icon: Circle, dot: 'bg-green-500', label: '出勤可' },
  unavailable: { Icon: XCircle, dot: 'bg-red-500', label: '出勤不可' },
};

export function ShiftPreferenceCalendar({
  preferences,
  onDateClick,
  memberNames,
  isAdmin,
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

  const userColorMap = useMemo(() => {
    const map = new Map<string, (typeof MEMBER_COLORS)[number]>();
    const uniqueUsers = [...new Set(preferences.map((p) => p.user_id))];
    uniqueUsers.forEach((uid, i) => {
      map.set(uid, MEMBER_COLORS[i % MEMBER_COLORS.length]);
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

  return (
    <div className="space-y-3">
      {/* ナビゲーション */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition"
            aria-label="前月"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 min-w-[120px] text-center">
            {format(baseDate, 'yyyy年M月', { locale: ja })}
          </span>
          <button
            onClick={() => navigate(1)}
            className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition"
            aria-label="次月"
          >
            <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <button
            onClick={() => setBaseDate(new Date())}
            className="px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition"
          >
            今月
          </button>
        </div>
      </div>

      {/* カレンダーグリッド */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        {/* ヘッダー */}
        <div className="grid grid-cols-7 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
          {weekDays.map((d, i) => (
            <div
              key={i}
              className={`text-center py-2 text-xs font-medium ${
                i === 5 ? 'text-blue-600 dark:text-blue-400' : i === 6 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {d}
            </div>
          ))}
        </div>

        {/* セル */}
        <div className="grid grid-cols-7">
          {dates.map((d, index) => {
            const dateStr = format(d, 'yyyy-MM-dd');
            const isToday = dateStr === today;
            const isCurrentMonth = d.getMonth() === baseDate.getMonth();
            const dayPrefs = preferencesByDate.get(dateStr) || [];
            const dayOfWeek = index % 7;

            return (
              <div
                key={dateStr}
                onClick={() => onDateClick(dateStr)}
                className={`min-h-[70px] sm:min-h-[80px] border-b border-r border-gray-100 dark:border-gray-700 p-1 cursor-pointer transition ${
                  !isCurrentMonth
                    ? 'bg-gray-50 dark:bg-gray-700 opacity-50'
                    : dayOfWeek === 5
                    ? 'bg-sky-50/40 dark:bg-sky-900/10 hover:bg-sky-100/50 dark:hover:bg-sky-900/20'
                    : dayOfWeek === 6
                    ? 'bg-rose-50/40 dark:bg-rose-900/10 hover:bg-rose-100/50 dark:hover:bg-rose-900/20'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <div
                  className={`text-xs font-medium mb-0.5 ${
                    isToday
                      ? 'bg-blue-600 text-white w-5 h-5 rounded-full flex items-center justify-center'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {format(d, 'd')}
                </div>

                <div className="space-y-0.5">
                  {isAdmin && memberNames ? (
                    // 店長ビュー: メンバーの頭文字 + タイプアイコン
                    dayPrefs.slice(0, 3).map((pref) => {
                      const color = userColorMap.get(pref.user_id) || MEMBER_COLORS[0];
                      const style = PREFERENCE_STYLE[pref.preference_type];
                      const initial = memberNames.get(pref.user_id)?.charAt(0) || '?';
                      return (
                        <div
                          key={pref.id}
                          className={`flex items-center gap-0.5 text-[10px] leading-tight px-1 py-0.5 rounded truncate ${color.light} ${color.text}`}
                        >
                          <span className="font-bold">{initial}</span>
                          <style.Icon className="w-3 h-3" />
                        </div>
                      );
                    })
                  ) : (
                    // スタッフビュー: 自分の希望タイプ
                    dayPrefs.slice(0, 1).map((pref) => {
                      const style = PREFERENCE_STYLE[pref.preference_type];
                      const timeLabel =
                        pref.preference_type !== 'unavailable' && pref.start_time && pref.end_time
                          ? `${pref.start_time.slice(0, 5)}-${pref.end_time.slice(0, 5)}`
                          : null;
                      return (
                        <div key={pref.id} className="space-y-0.5">
                          <div className="flex items-center gap-0.5">
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
                            <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">
                              <style.Icon className="w-3 h-3" />
                            </span>
                          </div>
                          {timeLabel && (
                            <div className="text-[9px] text-gray-500 dark:text-gray-400 leading-tight">{timeLabel}</div>
                          )}
                        </div>
                      );
                    })
                  )}
                  {isAdmin && dayPrefs.length > 3 && (
                    <div className="text-[10px] text-gray-500 dark:text-gray-400">+{dayPrefs.length - 3}件</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 凡例 */}
      <div className="flex flex-wrap gap-3 text-xs">
        {isAdmin && memberNames ? (
          [...userColorMap.entries()].map(([uid, color]) => (
            <div key={uid} className="flex items-center gap-1">
              <div className={`w-2.5 h-2.5 rounded-full ${color.bg}`} />
              <span className="text-gray-600 dark:text-gray-400">{memberNames.get(uid) || '不明'}</span>
            </div>
          ))
        ) : (
          (Object.entries(PREFERENCE_STYLE) as [ShiftPreferenceType, typeof PREFERENCE_STYLE[ShiftPreferenceType]][]).map(
            ([, style]) => (
              <div key={style.label} className="flex items-center gap-1">
                <div className={`w-2.5 h-2.5 rounded-full ${style.dot}`} />
                <span className="text-gray-600">{style.label}</span>
              </div>
            ),
          )
        )}
      </div>
    </div>
  );
}
