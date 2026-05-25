import { format, isSameDay, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Badge } from '../ui';
import type { Shift } from '../../types';

type RoleType = 'owner' | 'manager' | 'fulltime' | 'parttime';

interface Props {
  selectedDate: string | null;
  shifts: Shift[];
  memberNames: Map<string, string>;
  storeNames?: Map<string, string>;
  roleTypeMap?: Map<string, RoleType>;
  onShiftClick?: (shift: Shift) => void;
  onSeeAll?: () => void;
}

function roleColorOf(roleType?: RoleType): string {
  if (roleType === 'owner') return '#7c3aed';
  if (roleType === 'manager') return '#2563eb';
  if (roleType === 'fulltime') return '#0d9488';
  return '#ea580c';
}

function roleLabelOf(roleType?: RoleType): string {
  if (roleType === 'owner') return '会長 / 内勤';
  if (roleType === 'manager') return '店長';
  if (roleType === 'fulltime') return '正社員';
  return 'バイト';
}

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

function formatHHmm(time: string): string {
  return time.slice(0, 5);
}

export function ShiftMobileTodayList({
  selectedDate,
  shifts,
  memberNames,
  roleTypeMap,
  onShiftClick,
  onSeeAll,
}: Props) {
  const targetDate = selectedDate ?? format(new Date(), 'yyyy-MM-dd');
  const dayShifts = shifts.filter((shift) => shift.date === targetDate);
  const isToday = isSameDay(parseISO(targetDate), new Date());
  const visible = dayShifts.slice(0, 6);
  const overflow = dayShifts.length - visible.length;

  return (
    <div className="lg:hidden mt-4">
      <div className="flex items-center mb-2 gap-2">
        <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100 tabular-nums">
          {format(parseISO(targetDate), 'M/d (E)', { locale: ja })} — {dayShifts.length}名
        </h3>
        <div className="flex-1" />
        {isToday && (
          <span className="text-[11px] text-stone-500 dark:text-stone-400">本日</span>
        )}
      </div>
      {dayShifts.length === 0 ? (
        <div className="rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-4 text-xs text-stone-500 dark:text-stone-400 text-center">
          この日のシフトはありません
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((shift) => {
            const roleType = roleTypeMap?.get(shift.user_id);
            const roleColor = roleColorOf(roleType);
            const name = memberNames.get(shift.user_id) ?? '—';
            const initial = name.slice(0, 1);

            return (
              <li key={shift.id}>
                <button
                  type="button"
                  onClick={() => onShiftClick?.(shift)}
                  className="w-full text-left flex items-center gap-2.5 rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-2.5 hover:bg-stone-50 dark:hover:bg-stone-700/40 focus-ring motion-safe:transition-colors duration-150"
                  style={{ borderLeftWidth: 3, borderLeftColor: roleColor }}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shrink-0"
                    style={{ background: roleColor }}
                  >
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
