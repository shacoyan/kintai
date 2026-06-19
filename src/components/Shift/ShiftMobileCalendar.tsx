import { useMemo, memo } from 'react';
import { addDays, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { PenLine } from 'lucide-react';
import type { Shift, ShiftPreference } from '../../types';
import type { StatusFilterValue } from './unifiedShiftTypes';
import { ROLE_COLOR_HEX, type RoleColorKey } from '../../utils/getRoleColor';
import { formatStartHour2, extractLastName, prioritizeDayItems, type DayChipItem } from '../../utils/shiftSlot';

// === ローカル色定数（getRoleColor.ts は改変しない / §B-3・§C-8） ===
// 役職別 700 相当 hex（AA 担保 / light text）
// 役職テキスト色は light=700 / dark=300 の静的 Tailwind クラスで指定する。
// inline style({color}) を併用すると CSS 詳細度で dark: クラスが効かず
// ダークモードでも light の 700 色のままになるため、色は className のみで管理（§B-3 / §B-9）。
const ROLE_TEXT_CLASS: Record<RoleColorKey, string> = {
  owner: 'text-violet-700 dark:text-violet-300',
  manager: 'text-blue-700 dark:text-blue-300',
  fulltime: 'text-teal-700 dark:text-teal-300',
  parttime: 'text-orange-700 dark:text-orange-300',
};

// 状態色（CalShiftBar statusVisual と同値 / §B / §B-4）
const STATUS_DOT_APPROVED = '#059669';
const STATUS_RING_TENTATIVE = '#ea580c';
const STATUS_DOT_PENDING = '#2563eb';
const UNAVAILABLE_HEX = '#b91c1c';

const MAX_CHIPS = 3;

/** hex(#rrggbb) → rgba 文字列 */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roleHexOf(key: RoleColorKey | undefined): string {
  return ROLE_COLOR_HEX[key ?? 'fulltime'];
}

interface Props {
  shiftViewMonth: Date;
  shifts: Shift[];
  preferences: ShiftPreference[];
  currentUserId: string | null;
  selectedDate: string | null;
  selectedBulkDates?: Set<string>;
  isBulkMode: boolean;
  statusFilter?: Set<StatusFilterValue>;
  /**
   * preference 系 chip（pending_preference / unavailable_preference）を statusFilter で
   * 制御するか。PC ShiftCalendar と同じく canManageTenant を渡す想定。
   * false（= staff）のときは ShiftStatusFilter 側に preference chip が出ない（ShiftPage L1251）ため、
   * ここで filter を適用すると OFF 状態を復元できず希望/休み希望が消える回帰になる。
   * → false のときは statusFilter を無視して preference を常時表示する（PC と対称）。
   */
  showPreferenceStatus?: boolean;
  /** 日セルタップ。SP では即 BottomSheet 起動の意味（§A-3） */
  onDateClick: (date: string) => void;
  /** 姓抽出のための display_name フルネーム（§A-2 必須追加） */
  memberNames?: Map<string, string>;
  /** 役職色のための role type マップ（§A-2 必須追加） */
  roleTypeMap?: Map<string, RoleColorKey>;
  /** +N タップ時。未指定時は onDateClick にフォールバック（§A-2） */
  onOverflowClick?: (date: string) => void;
}

/** その日の表示内容（チップ配列 + overflow + 休み希望件数） */
interface DayRender {
  visible: DayChipItem[];
  overflow: number;
  unavailableCount: number;
  count: number;
}

/** 状態マーカー（§B-4 / orange 衝突対策: 形状で弁別） */
function StatusMarker({ status }: { status: string }) {
  if (status === 'approved') {
    return (
      <span
        className="block w-[6px] h-[6px] rounded-full"
        style={{ background: STATUS_DOT_APPROVED }}
        aria-hidden="true"
      />
    );
  }
  if (status === 'tentative' || status === 'modified') {
    // 中空リング（parttime 左ボーダーと形状で弁別）
    return (
      <span
        className="block w-[7px] h-[7px] rounded-full border-[1.5px] box-border"
        style={{ borderColor: STATUS_RING_TENTATIVE }}
        aria-hidden="true"
      />
    );
  }
  // pending（その他）
  return (
    <span
      className="block w-[6px] h-[6px] rounded-full"
      style={{ background: STATUS_DOT_PENDING }}
      aria-hidden="true"
    />
  );
}

/** 確定シフト = 実体チップ（§B-3） */
function ShiftChip({ item }: { item: DayChipItem }) {
  const roleHex = roleHexOf(item.roleType);
  const textClass = ROLE_TEXT_CLASS[item.roleType ?? 'fulltime'];
  const hh = formatStartHour2(item.startTime);

  return (
    <div
      className={[
        'flex items-center gap-[3px] rounded-[4px] pl-[3px] pr-[2px] h-[15px] overflow-hidden',
        item.isMine ? 'outline outline-1 outline-blue-400/70 dark:outline-blue-400/60' : '',
      ].join(' ')}
      style={{
        borderLeft: `2px solid ${roleHex}`,
        backgroundColor: hexToRgba(roleHex, 0.1),
      }}
    >
      <span className={`text-[11px] leading-none tabular-nums shrink-0 ${textClass}`}>
        {hh}
      </span>
      <span className={`text-[11px] leading-none font-medium truncate ${textClass}`}>
        {item.lastName}
      </span>
      <span className="ml-auto shrink-0">
        <StatusMarker status={item.status} />
      </span>
    </div>
  );
}

/** 希望ゴーストチップ（§B-5） */
function PreferenceChip({ item }: { item: DayChipItem }) {
  const roleHex = roleHexOf(item.roleType);
  const textClass = ROLE_TEXT_CLASS[item.roleType ?? 'fulltime'];

  return (
    <div
      className="flex items-center gap-[3px] rounded-[4px] pl-[3px] pr-[2px] h-[15px] overflow-hidden border border-dashed"
      style={{
        // 破線の枠色（半透明）を先に置き、左辺だけ役職色 solid 2px で後勝ち上書き（§B-5）。
        // borderColor ショートハンドを後に置くと border-left-color が潰れるため順序厳守。
        borderColor: hexToRgba(roleHex, 0.5),
        borderLeftWidth: '2px',
        borderLeftStyle: 'solid',
        borderLeftColor: roleHex,
        backgroundColor: hexToRgba(roleHex, 0.06),
      }}
    >
      <PenLine className={`w-[8px] h-[8px] shrink-0 ${textClass}`} aria-hidden />
      <span className={`text-[10px] leading-none shrink-0 ${textClass}`}>
        希望
      </span>
      <span className={`text-[11px] leading-none truncate font-medium ${textClass}`}>
        {item.lastName}
      </span>
    </div>
  );
}

// Perf: 親の頻繁な再 render に追従させないため React.memo でラップ。
function ShiftMobileCalendarInner({
  shiftViewMonth,
  shifts,
  preferences,
  currentUserId,
  selectedDate,
  selectedBulkDates,
  isBulkMode,
  statusFilter,
  showPreferenceStatus = false,
  onDateClick,
  memberNames,
  roleTypeMap,
  onOverflowClick,
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

  // date → 表示チップ配列（日次集計 + ソート + 優先表示 + overflow + 休み希望件数）
  const dayRenderMap = useMemo(() => {
    const items = new Map<string, DayChipItem[]>();
    const unavailable = new Map<string, number>();
    const counts = new Map<string, number>();

    const roleOf = (userId: string): RoleColorKey => roleTypeMap?.get(userId) ?? 'fulltime';
    const nameOf = (userId: string): string => extractLastName(memberNames?.get(userId));

    // 確定 shift（§B-8: rejected/cancelled は statusFilter 既定 OFF → 通過分のみ）
    for (const shift of shifts) {
      const passesFilter = !statusFilter || statusFilter.has(shift.status as StatusFilterValue);
      if (!passesFilter) continue;
      const arr = items.get(shift.date) ?? [];
      const roleType = roleOf(shift.user_id);
      arr.push({
        kind: 'shift',
        userId: shift.user_id,
        startTime: shift.start_time,
        lastName: nameOf(shift.user_id),
        roleType,
        status: shift.status,
        isMine: !!currentUserId && shift.user_id === currentUserId,
        isManager: roleType === 'manager',
      });
      items.set(shift.date, arr);
      counts.set(shift.date, (counts.get(shift.date) ?? 0) + 1);
    }

    // preference
    for (const preference of preferences) {
      const isMinePref = !!currentUserId && preference.user_id === currentUserId;
      if (preference.preference_type === 'unavailable') {
        // 休み希望: チップ列に混ぜず隅マーカー（§B-6 / §B-8）
        // PC ShiftCalendar に倣い、showPreferenceStatus=false（staff）のときは
        // statusFilter を無視して常時表示する。さらに自分(isMine)の希望は
        // showPreferenceStatus に関わらず statusFilter を無視して常時表示（旧 SP 挙動の復元）。
        const showUnavailable =
          !showPreferenceStatus ||
          !statusFilter ||
          statusFilter.has('unavailable_preference') ||
          isMinePref;
        if (showUnavailable) {
          unavailable.set(preference.date, (unavailable.get(preference.date) ?? 0) + 1);
        }
        continue;
      }
      // preferred ゴーストチップ: pending のものを表示（§B-5 / §B-8）
      if (preference.status !== 'pending') continue;
      const showPreferred =
        !showPreferenceStatus ||
        !statusFilter ||
        statusFilter.has('pending_preference') ||
        isMinePref;
      if (!showPreferred) continue;
      const arr = items.get(preference.date) ?? [];
      const roleType = roleOf(preference.user_id);
      arr.push({
        kind: 'preference',
        userId: preference.user_id,
        startTime: preference.start_time ?? '99:99',
        lastName: nameOf(preference.user_id),
        roleType,
        status: 'pending',
        isMine: isMinePref,
        isManager: roleType === 'manager',
      });
      items.set(preference.date, arr);
    }

    const result = new Map<string, DayRender>();
    const dates = new Set<string>([...items.keys(), ...unavailable.keys()]);
    for (const date of dates) {
      const all = items.get(date) ?? [];
      const { visible, overflow } = prioritizeDayItems(all, MAX_CHIPS);
      result.set(date, {
        visible,
        overflow,
        unavailableCount: unavailable.get(date) ?? 0,
        count: counts.get(date) ?? 0,
      });
    }
    return result;
  }, [shifts, preferences, currentUserId, statusFilter, showPreferenceStatus, memberNames, roleTypeMap]);

  const today = new Date();
  const handleOverflow = (date: string) => {
    (onOverflowClick ?? onDateClick)(date);
  };

  return (
    <div className="lg:hidden">
      <div
        aria-label="シフトカレンダー (モバイル)"
        className="grid grid-cols-7 gap-[3px] bg-stone-200/70 dark:bg-stone-700/70 rounded-[8px] overflow-hidden border border-stone-200/70 dark:border-stone-700/70"
      >
        {days.map((d) => {
          const dateStr = format(d, 'yyyy-MM-dd');
          const otherMonth = !isSameMonth(d, shiftViewMonth);
          const isToday = isSameDay(d, today);
          const render = dayRenderMap.get(dateStr);
          const count = render?.count ?? 0;
          const visible = render?.visible ?? [];
          const overflow = render?.overflow ?? 0;
          const unavailableCount = render?.unavailableCount ?? 0;
          const isSelected = !isBulkMode && selectedDate === dateStr;
          const isBulkSelected = isBulkMode && selectedBulkDates?.has(dateStr);

          return (
            <button
              key={dateStr}
              type="button"
              aria-label={`${format(d, 'M月d日')}${count > 0 ? ` ${count}人` : ''}${
                unavailableCount > 0 ? ` 出勤不可${unavailableCount}件` : ''
              }${isToday ? ' (今日)' : ''}`}
              onClick={() => onDateClick(dateStr)}
              className={[
                'w-full min-h-[88px] p-1 flex flex-col gap-[2px] text-left relative',
                'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset',
                'motion-safe:transition-colors duration-150',
                otherMonth ? 'bg-stone-50 dark:bg-stone-900' : 'bg-white dark:bg-stone-800',
                isSelected ? 'bg-blue-50 dark:bg-blue-900/30' : '',
                isBulkSelected ? 'ring-2 ring-blue-600 ring-inset bg-blue-50 dark:bg-blue-900/30' : '',
              ].join(' ')}
            >
              {/* 日付行 */}
              <div className="flex items-center leading-none">
                {isToday ? (
                  <span className="inline-flex items-center justify-center w-[20px] h-[20px] rounded-full bg-blue-600 text-white text-[11px] font-semibold tabular-nums">
                    {d.getDate()}
                  </span>
                ) : (
                  <span
                    className={[
                      'text-[12px] tabular-nums',
                      isSelected
                        ? 'font-bold text-blue-600'
                        : otherMonth
                          ? 'text-stone-400 dark:text-stone-500'
                          : 'font-medium text-stone-700 dark:text-stone-300',
                    ].join(' ')}
                  >
                    {d.getDate()}
                  </span>
                )}
              </div>

              {/* チップ列 */}
              {!otherMonth && (
                <div className="flex flex-col gap-[2px]">
                  {visible.map((item, i) =>
                    item.kind === 'preference' ? (
                      <PreferenceChip key={`${item.userId}-pref-${i}`} item={item} />
                    ) : (
                      <ShiftChip key={`${item.userId}-shift-${i}`} item={item} />
                    ),
                  )}
                  {overflow > 0 && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`他${overflow}件を表示`}
                      className="inline-flex items-center self-start -my-1 -mx-1 px-1 py-1 min-w-[44px] text-[10px] tabular-nums leading-none text-stone-500 dark:text-stone-400 text-left cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOverflow(dateStr);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          handleOverflow(dateStr);
                        }
                      }}
                    >
                      +{overflow}
                    </span>
                  )}
                </div>
              )}

              {/* 休み希望 隅マーカー（§B-6） */}
              {!otherMonth && unavailableCount > 0 && (
                <span
                  className="absolute bottom-[2px] right-[2px] inline-flex items-center gap-[1px]"
                  aria-label={`出勤不可 ${unavailableCount}件`}
                >
                  <span className="block w-[6px] h-[6px] rounded-full" style={{ background: UNAVAILABLE_HEX }} />
                  {unavailableCount > 1 && (
                    <span className="text-[8px] tabular-nums leading-none" style={{ color: UNAVAILABLE_HEX }}>
                      {unavailableCount}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const ShiftMobileCalendar = memo(ShiftMobileCalendarInner);
