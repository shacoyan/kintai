import { useMemo, memo } from 'react';
import { addDays, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { PenLine, LayoutGrid } from 'lucide-react';
import type { Shift, ShiftPreference, ShiftFrame, ShiftFrameOverride } from '../../types';
import type { StatusFilterValue } from './unifiedShiftTypes';
import { ROLE_COLOR_HEX, type RoleColorKey } from '../../utils/getRoleColor';
import {
  formatChipTimeRange,
  NO_START_TIME_SENTINEL,
  extractLastName,
  prioritizeDayItems,
  type DayChipItem,
} from '../../utils/shiftSlot';
import {
  getEffectiveFramesForDate,
  countFrameAssignments,
  judgeFrameFulfillment,
  type EffectiveFrame,
} from '../../utils/shiftFrames';
import { formatTimeRangeA11y } from '../../utils/formatTimeRange';

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

/** 「配置として数える」status 集合（shiftFrames.ts / ShiftDayCoverageHeader と同一・ファイル内ローカル定義 / §4.2(b)）。 */
const ASSIGNED_STATUSES = new Set<string>(['tentative', 'approved', 'modified']);

/** 枠バーの tone スタイル（ShiftCalendar.tsx:85-90 と同値のローカル定義 / §4.2(b)）。 */
const FRAME_TONE_STYLES: Record<'danger' | 'warning' | 'success' | 'info', { border: string; bg: string }> = {
  danger: { border: '#dc2626', bg: 'bg-red-50 dark:bg-red-900/20' },
  warning: { border: '#f59e0b', bg: 'bg-amber-50 dark:bg-amber-900/20' },
  success: { border: '#059669', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  info: { border: '#2563eb', bg: 'bg-blue-50 dark:bg-blue-900/20' },
};

/** チップの時刻レンジ文字列を "先頭ハイフンまで" / "残り" に分割する（1 行に収まらない時の折返し用・§4.2(a)）。 */
function splitChipRange(range: string): { head: string; tail: string } {
  const idx = range.indexOf('-');
  if (idx === -1) return { head: range, tail: '' };
  return { head: range.slice(0, idx + 1), tail: range.slice(idx + 1) };
}

/** チップ / 枠バー title 用の状態ラベル（§4.2(a)）。 */
function statusLabelOf(item: Pick<DayChipItem, 'kind' | 'status'>): string {
  if (item.kind === 'preference') return '申請中';
  if (item.status === 'approved') return '本承認';
  if (item.status === 'tentative' || item.status === 'modified') return '仮承認';
  return '申請中';
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
  /**
   * true のとき、確定シフト・希望（preferred ゴーストチップ・出勤不可マーカー）を
   * currentUserId 本人の行のみに絞り込む（機能1「自分のみ」表示）。
   * currentUserId が null のときは（ON のまま渡されても）フィルタを適用しない
   * （全件消失事故防止 / UnifiedShiftSidebar.tsx の defensive guard と同思想）。
   * isMinePref の常時表示例外（pending / unavailable の自分の希望）とは矛盾しない
   * ——本フィルタは他人の行を先に除外するだけで、自分の行は従来通り常時残る。
   */
  mineOnly?: boolean;
  /** 日セルタップ。SP では即 BottomSheet 起動の意味（§A-3） */
  onDateClick: (date: string) => void;
  /** 姓抽出のための display_name フルネーム（§A-2 必須追加） */
  memberNames?: Map<string, string>;
  /** 役職色のための role type マップ（§A-2 必須追加） */
  roleTypeMap?: Map<string, RoleColorKey>;
  /** +N タップ時。未指定時は onDateClick にフォールバック（§A-2） */
  onOverflowClick?: (date: string) => void;
  /** 枠テンプレート / 単発枠（§4.2(b)）。未指定 = 枠表示 OFF（完全従来挙動）。 */
  frames?: ShiftFrame[];
  /** 枠の当日限定上書き（cancel/modify）。§4.2(b)。 */
  frameOverrides?: ShiftFrameOverride[];
  /** 枠表示対象の店舗 id。null/undefined = 枠表示 OFF（§4.2(b)）。 */
  frameStoreId?: string | null;
  /**
   * 充足カウント用の生 shifts（statusFilter / mineOnly 非適用）。未指定時は props.shifts を使う。
   * staff では表示用 shifts=myShifts のため、count 専用に店舗 allShifts を渡す（§4.5 裁定 B）。
   */
  frameCountShifts?: Shift[];
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

/** 確定シフト = 実体チップ（2 段: 姓+マーカー / 時刻。§4.2(a)） */
function ShiftChip({ item }: { item: DayChipItem }) {
  const roleHex = roleHexOf(item.roleType);
  const textClass = ROLE_TEXT_CLASS[item.roleType ?? 'fulltime'];
  const timeRange = formatChipTimeRange(item.startTime, item.endTime);
  const { head, tail } = splitChipRange(timeRange);
  const statusLabel = statusLabelOf(item);

  return (
    <div
      className={[
        'flex flex-col rounded-[4px] pl-[3px] pr-[2px] py-[1px] overflow-hidden',
        item.isMine ? 'outline outline-1 outline-blue-400/70 dark:outline-blue-400/60' : '',
      ].join(' ')}
      style={{
        borderLeft: `2px solid ${roleHex}`,
        backgroundColor: hexToRgba(roleHex, 0.1),
      }}
      title={`${item.lastName} ${timeRange} ${statusLabel}`}
    >
      <div className="flex items-center gap-[3px]">
        <span className={`text-[11px] leading-[1.15] font-medium truncate min-w-0 ${textClass}`}>
          {item.lastName}
        </span>
        <span className="ml-auto shrink-0">
          <StatusMarker status={item.status} />
        </span>
      </div>
      {timeRange && (
        <div className={`flex flex-wrap items-center text-[10px] leading-[1.15] tabular-nums ${textClass}`}>
          <span>{head}</span>
          {tail && <span>{tail}</span>}
        </div>
      )}
    </div>
  );
}

/** 希望ゴーストチップ（同型 2 段。1 段目 = PenLine + 姓、マーカーなし / §4.2(a)） */
function PreferenceChip({ item }: { item: DayChipItem }) {
  const roleHex = roleHexOf(item.roleType);
  const textClass = ROLE_TEXT_CLASS[item.roleType ?? 'fulltime'];
  const timeRange = formatChipTimeRange(item.startTime, item.endTime);
  const { head, tail } = splitChipRange(timeRange);
  const statusLabel = statusLabelOf(item);

  return (
    <div
      className="flex flex-col rounded-[4px] pl-[3px] pr-[2px] py-[1px] overflow-hidden border border-dashed"
      style={{
        // 破線の枠色（半透明）を先に置き、左辺だけ役職色 solid 2px で後勝ち上書き（§B-5）。
        // borderColor ショートハンドを後に置くと border-left-color が潰れるため順序厳守。
        borderColor: hexToRgba(roleHex, 0.5),
        borderLeftWidth: '2px',
        borderLeftStyle: 'solid',
        borderLeftColor: roleHex,
        backgroundColor: hexToRgba(roleHex, 0.06),
      }}
      title={`${item.lastName} ${timeRange} ${statusLabel}`}
    >
      <div className="flex items-center gap-[3px]">
        <PenLine className={`w-[8px] h-[8px] shrink-0 ${textClass}`} aria-hidden />
        <span className={`text-[11px] leading-[1.15] truncate font-medium min-w-0 ${textClass}`}>
          {item.lastName}
        </span>
      </div>
      {timeRange && (
        <div className={`flex flex-wrap items-center text-[10px] leading-[1.15] tabular-nums ${textClass}`}>
          <span>{head}</span>
          {tail && <span>{tail}</span>}
        </div>
      )}
    </div>
  );
}

/** SP 枠バー（枠名 / 時刻 / n・m の 3 行。role/tabIndex/onClick なし = セル button の子でタップはセルへバブル。§4.2(b)） */
function MobileFrameBar({ frame, assigned }: { frame: EffectiveFrame; assigned: number }) {
  const verdict = judgeFrameFulfillment(assigned, frame.requiredCount);
  const tone = FRAME_TONE_STYLES[verdict.tone];
  const timeRange = formatChipTimeRange(frame.startTime, frame.endTime);
  const { head, tail } = splitChipRange(timeRange);
  const a11y = `枠 ${frame.name} ${formatTimeRangeA11y(frame.startTime, frame.endTime)} 配置${assigned}人/必要${frame.requiredCount}人 ${verdict.label}`;

  return (
    <div
      className={`flex flex-col rounded-[3px] border-l-2 px-[2px] py-[1px] ${tone.bg}`}
      style={{ borderLeftColor: tone.border }}
      title={a11y}
    >
      <div className="flex items-center gap-[2px]">
        <LayoutGrid className="w-[8px] h-[8px] shrink-0 text-stone-700 dark:text-stone-200" aria-hidden />
        <span className="text-[10px] font-semibold truncate text-stone-800 dark:text-stone-100">
          {frame.isModified ? `*${frame.name}` : frame.name}
        </span>
      </div>
      {timeRange && (
        <div className="flex flex-wrap items-center text-[9px] tabular-nums text-stone-700 dark:text-stone-200">
          <span>{head}</span>
          {tail && <span>{tail}</span>}
        </div>
      )}
      <div className="text-[9px] tabular-nums font-medium text-stone-800 dark:text-stone-100">
        {assigned}/{frame.requiredCount}
      </div>
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
  mineOnly = false,
  onDateClick,
  memberNames,
  roleTypeMap,
  frames,
  frameOverrides,
  frameStoreId,
  frameCountShifts,
}: Props) {
  // currentUserId が null のときは mineOnly を無視する（全件消失事故防止）。
  const effectiveMineOnly = mineOnly && !!currentUserId;
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
      // mineOnly（機能1）: statusFilter の常時表示例外（pending 等）より優先して
      // 他人の行を先に除外する。自分の行は従来通り passesFilter の判定に進む。
      if (effectiveMineOnly && shift.user_id !== currentUserId) continue;
      const passesFilter = !statusFilter || statusFilter.has(shift.status as StatusFilterValue);
      if (!passesFilter) continue;
      const arr = items.get(shift.date) ?? [];
      const roleType = roleOf(shift.user_id);
      arr.push({
        kind: 'shift',
        userId: shift.user_id,
        startTime: shift.start_time,
        endTime: shift.end_time,
        lastName: nameOf(shift.user_id),
        roleType,
        status: shift.status,
        isMine: !!currentUserId && shift.user_id === currentUserId,
        isManager: roleType === 'manager',
        frameId: shift.frame_id,
      });
      items.set(shift.date, arr);
      counts.set(shift.date, (counts.get(shift.date) ?? 0) + 1);
    }

    // preference
    for (const preference of preferences) {
      const isMinePref = !!currentUserId && preference.user_id === currentUserId;
      // mineOnly（機能1）: isMinePref=false（他人）の希望経路を丸ごと除外する。
      // isMinePref=true の自分の希望は effectiveMineOnly の有無に関わらずこの後の
      // 常時表示例外（showUnavailable / showPreferred の isMinePref 分岐）で表示され続ける。
      if (effectiveMineOnly && !isMinePref) continue;
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
        startTime: preference.start_time ?? NO_START_TIME_SENTINEL,
        endTime: preference.end_time,
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
      // オーナー決定: モバイルもセル内全件表示。優先ソートは維持しつつ
      // 上限なし (全件) を描画するため limit に全件数を渡す (overflow=0)。
      const { visible, overflow } = prioritizeDayItems(all, all.length);
      result.set(date, {
        visible,
        overflow,
        unavailableCount: unavailable.get(date) ?? 0,
        count: counts.get(date) ?? 0,
      });
    }
    return result;
  }, [
    shifts,
    preferences,
    currentUserId,
    statusFilter,
    showPreferenceStatus,
    effectiveMineOnly,
    memberNames,
    roleTypeMap,
  ]);

  // 設計書 §4.2(b): framesByDate。枠機能 OFF（frameStoreId 未指定）なら空 Map（PC ShiftCalendar.tsx:391-401 と同型）。
  const framesByDate = useMemo(() => {
    const map = new Map<string, EffectiveFrame[]>();
    if (!frames || !frameStoreId) return map;
    for (const d of days) {
      const dateStr = format(d, 'yyyy-MM-dd');
      const effective = getEffectiveFramesForDate(frames, frameOverrides ?? [], frameStoreId, dateStr);
      if (effective.length > 0) map.set(dateStr, effective);
    }
    return map;
  }, [frames, frameOverrides, frameStoreId, days]);

  // 設計書 §4.2(b) 注意書き: 充足カウントは statusFilter/mineOnly 非適用の生 shifts から算出。
  const frameAssignCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (framesByDate.size === 0) return map;
    const countSource = frameCountShifts ?? shifts;
    for (const effective of framesByDate.values()) {
      for (const frame of effective) {
        const key = `${frame.date}@${frame.frameId}`;
        map.set(key, countFrameAssignments(countSource, frame.frameId, frame.date));
      }
    }
    return map;
  }, [frameCountShifts, shifts, framesByDate]);

  const today = new Date();

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
          const unavailableCount = render?.unavailableCount ?? 0;
          const isSelected = !isBulkMode && selectedDate === dateStr;
          const isBulkSelected = isBulkMode && selectedBulkDates?.has(dateStr);

          // 設計書 §4.2(b): 枠バー + 配下グループの分配（visible の順序を保持）。
          const dayFrames = framesByDate.get(dateStr) ?? [];
          const dayFrameIds = new Set(dayFrames.map((f) => f.frameId));
          const groupedByFrame = new Map<string, DayChipItem[]>();
          const rest: DayChipItem[] = [];
          for (const item of visible) {
            if (
              item.kind === 'shift' &&
              item.frameId &&
              dayFrameIds.has(item.frameId) &&
              ASSIGNED_STATUSES.has(item.status)
            ) {
              const arr = groupedByFrame.get(item.frameId) ?? [];
              arr.push(item);
              groupedByFrame.set(item.frameId, arr);
            } else {
              rest.push(item);
            }
          }

          return (
            <button
              key={dateStr}
              type="button"
              aria-label={`${format(d, 'M月d日')}${count > 0 ? ` ${count}人` : ''}${
                unavailableCount > 0 ? ` 出勤不可${unavailableCount}件` : ''
              }${dayFrames.length > 0 ? ` 枠${dayFrames.length}件` : ''}${isToday ? ' (今日)' : ''}`}
              onClick={() => onDateClick(dateStr)}
              className={[
                'w-full min-h-[88px] p-1 flex flex-col gap-[2px] text-left relative',
                '[content-visibility:auto] [contain-intrinsic-size:auto_88px]',
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

              {/* 枠ブロック（枠バー + 配下グループ。§4.2(b)） */}
              {!otherMonth && dayFrames.length > 0 && (
                <div className="flex flex-col gap-[3px]">
                  {dayFrames.map((frame) => {
                    const assigned = frameAssignCounts.get(`${dateStr}@${frame.frameId}`) ?? 0;
                    const grouped = groupedByFrame.get(frame.frameId) ?? [];
                    return (
                      <div key={frame.frameId} className="flex flex-col gap-[1px]">
                        <MobileFrameBar frame={frame} assigned={assigned} />
                        {grouped.length > 0 && (
                          <div
                            data-testid={`sp-frame-group-${frame.frameId}`}
                            className="ml-[3px] pl-[2px] border-l-2 border-stone-300 dark:border-stone-600 flex flex-col gap-[2px]"
                          >
                            {grouped.map((item, i) => (
                              <ShiftChip key={`${item.userId}-shift-frame-${i}`} item={item} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* チップ列（rest） */}
              {!otherMonth && (
                <div className="flex flex-col gap-[2px]">
                  {rest.map((item, i) =>
                    item.kind === 'preference' ? (
                      <PreferenceChip key={`${item.userId}-pref-${i}`} item={item} />
                    ) : (
                      <ShiftChip key={`${item.userId}-shift-${i}`} item={item} />
                    ),
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
