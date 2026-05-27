import { format, isSameDay, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Badge } from '../ui';
import type { Shift, ShiftPreference } from '../../types';
import { ROLE_COLOR_HEX, ROLE_COLOR_LABEL, type RoleColorKey } from '../../utils/getRoleColor';
import type { StatusFilterValue } from './unifiedShiftTypes';

type RoleType = RoleColorKey;
type RowItem =
  | { kind: 'shift'; shift: Shift }
  | { kind: 'preference'; pref: ShiftPreference };

interface Props {
  selectedDate: string | null;
  shifts: Shift[];
  preferences?: ShiftPreference[];
  memberNames: Map<string, string>;
  storeNames?: Map<string, string>;
  roleTypeMap?: Map<string, RoleType>;
  statusFilter?: Set<StatusFilterValue>;
  showPreferenceStatus?: boolean;
  onShiftClick?: (shift: Shift) => void;
  onSeeAll?: () => void;
}

const roleColorOf = (roleType?: RoleType): string => ROLE_COLOR_HEX[roleType ?? 'parttime'];
const roleLabelOf = (roleType?: RoleType): string => ROLE_COLOR_LABEL[roleType ?? 'parttime'];

function statusTone(status: string): 'success' | 'warning' | 'info' {
  if (status === 'approved') return 'success';
  if (status === 'tentative') return 'warning';
  return 'info';
}

function statusLabel(status: string): string {
  if (status === 'approved') return '本承認';
  if (status === 'tentative') return '仮承認';
  return '申請中';
}

function preferenceBadge(pref: ShiftPreference): { tone: 'warning' | 'info'; label: string } {
  if (pref.preference_type === 'unavailable') return { tone: 'warning', label: '休み希望' };
  if (pref.status === 'approved') return { tone: 'warning', label: '仮承認(希望)' };
  return { tone: 'info', label: '申請中(希望)' };
}

function formatHHmm(time: string): string {
  return time.slice(0, 5);
}

function preferenceTimeLabel(pref: ShiftPreference): string {
  if (pref.preference_type === 'unavailable') return '休み希望';
  if (pref.start_time && pref.end_time) return `${formatHHmm(pref.start_time)}-${formatHHmm(pref.end_time)}`;
  return '時刻未指定';
}

export function ShiftMobileTodayList({
  selectedDate,
  shifts,
  preferences,
  memberNames,
  roleTypeMap,
  statusFilter,
  showPreferenceStatus,
  onShiftClick,
  onSeeAll,
}: Props) {
  const targetDate = selectedDate ?? format(new Date(), 'yyyy-MM-dd');
  const allDayShifts = shifts.filter((shift) => shift.date === targetDate);
  const dayShifts = allDayShifts.filter((shift) =>
    !statusFilter || statusFilter.has(shift.status as StatusFilterValue)
  );
  const allDayPrefs = (preferences ?? []).filter((pref) => pref.date === targetDate);
  const dayPrefs = allDayPrefs.filter((pref) => {
    // 出勤不可 (unavailable) は自動承認されるため status 不問、preferred は pending のみ
    if (pref.preference_type !== 'unavailable' && pref.status !== 'pending') return false;
    if (!showPreferenceStatus) return true;
    if (!statusFilter) return true;
    const filterKey: StatusFilterValue =
      pref.preference_type === 'unavailable' ? 'unavailable_preference' : 'pending_preference';
    return statusFilter.has(filterKey);
  });
  const shiftUserIds = new Set(dayShifts.map((shift) => shift.user_id));
  const standalonePrefs = dayPrefs.filter((pref) => !shiftUserIds.has(pref.user_id));
  const rows: RowItem[] = [
    ...dayShifts.map((shift) => ({ kind: 'shift' as const, shift })),
    ...standalonePrefs.map((pref) => ({ kind: 'preference' as const, pref })),
  ];
  const isToday = isSameDay(parseISO(targetDate), new Date());
  const visible = rows.slice(0, 6);
  const overflow = rows.length - visible.length;

  return (
    <div className="lg:hidden mt-4">
      <div className="flex items-center mb-2 gap-2">
        <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100 tabular-nums">
          {format(parseISO(targetDate), 'M/d (E)', { locale: ja })} — {rows.length} 名
        </h3>
        <div className="flex-1" />
        {isToday && (
          <span className="text-[11px] text-stone-500 dark:text-stone-400">本日</span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-4 text-xs text-stone-500 dark:text-stone-400 text-center">
          この日のシフトはありません
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((row) => {
            if (row.kind === 'preference') {
              const pref = row.pref;
              const roleType = roleTypeMap?.get(pref.user_id);
              const roleColor = roleColorOf(roleType);
              const name = memberNames.get(pref.user_id) ?? '—';
              const initial = name.slice(0, 1);
              const badge = preferenceBadge(pref);

              return (
                <li key={`pref-${pref.id}`}>
                  <div
                    className="w-full text-left flex items-center gap-3 rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 py-3 px-3"
                    style={{ borderLeftWidth: 3, borderLeftColor: roleColor }}
                  >
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-stone-900 dark:text-stone-100 bg-stone-200 dark:bg-stone-700 shrink-0">
                      {initial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold text-stone-900 dark:text-stone-100 truncate">
                        {name}
                      </div>
                      <div className="text-[10px] text-stone-500 dark:text-stone-400">
                        {roleLabelOf(roleType)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[12px] font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                        {preferenceTimeLabel(pref)}
                      </div>
                      <div className="mt-1">
                        <Badge tone={badge.tone} withDot>
                          {badge.label}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </li>
              );
            }

            const shift = row.shift;
            const roleType = roleTypeMap?.get(shift.user_id);
            const roleColor = roleColorOf(roleType);
            const name = memberNames.get(shift.user_id) ?? '—';
            const initial = name.slice(0, 1);

            return (
              <li key={shift.id}>
                <button
                  type="button"
                  onClick={() => onShiftClick?.(shift)}
                  className="w-full text-left flex items-center gap-3 rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 py-3 px-3 hover:bg-stone-50 dark:hover:bg-stone-700/40 focus-ring motion-safe:transition-colors duration-150"
                  style={{ borderLeftWidth: 3, borderLeftColor: roleColor }}
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-stone-900 dark:text-stone-100 bg-stone-200 dark:bg-stone-700 shrink-0">
                    {initial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-stone-900 dark:text-stone-100 truncate">
                      {name}
                    </div>
                    <div className="text-[10px] text-stone-500 dark:text-stone-400">
                      {roleLabelOf(roleType)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[12px] font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                      {formatHHmm(shift.start_time)}-{formatHHmm(shift.end_time)}
                    </div>
                    <div className="mt-1">
                      <Badge tone={statusTone(shift.status)} withDot>
                        {statusLabel(shift.status)}
                      </Badge>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {overflow > 0 && onSeeAll && (
        <button
          type="button"
          onClick={onSeeAll}
          className="mt-2 w-full text-center text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline focus-ring py-2"
        >
          + {overflow} 件をすべて見る
        </button>
      )}
    </div>
  );
}
