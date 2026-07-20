import { useState, useMemo, useEffect, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { format, startOfWeek, addDays, startOfMonth, endOfMonth } from 'date-fns';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { LayoutGrid } from 'lucide-react';
import type {
  Shift,
  LeaveRequest,
  ShiftPreference,
  TenantMember,
  ShiftFrame,
  ShiftFrameOverride,
} from '../../types';
import type { StatusFilterValue } from './unifiedShiftTypes';
import { isJapaneseHoliday, getJapaneseHolidayName } from '../../lib/holidays';
import { getInitialShiftMonth } from '../../utils/initialShiftMonth';
import { CalShiftBar } from './CalShiftBar';
import {
  getEffectiveFramesForDate,
  countFrameAssignments,
  judgeFrameFulfillment,
  type EffectiveFrame,
} from '../../utils/shiftFrames';
import { formatTimeRange, formatTimeRangeA11y } from '../../utils/formatTimeRange';

type ViewMode = 'week' | '2week' | 'month';

const WEEK_LABELS = ['月曜', '火曜', '水曜', '木曜', '金曜', '土曜', '日曜'];

const LEAVE_TYPE_DOT: Record<string, string> = {
  paid: 'bg-emerald-500',
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

// 設計書: .company/engineering/docs/2026-07-21-kintai-frame-dnd.md §4/§5.1
// DnD 正規値（§4.3 collision）。3 コンテキスト共通・各ファイルにローカル定義（wave 1 のチーム間 import を作らない）。
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

const TONE_STYLES: Record<'danger' | 'warning' | 'success' | 'info', { border: string; bg: string }> = {
  danger: { border: '#dc2626', bg: 'bg-red-50 dark:bg-red-900/20' },
  warning: { border: '#f59e0b', bg: 'bg-amber-50 dark:bg-amber-900/20' },
  success: { border: '#059669', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  info: { border: '#2563eb', bg: 'bg-blue-50 dark:bg-blue-900/20' },
};

interface ShiftCalendarProps {
  shifts: Shift[];
  onDateClick: (date: string) => void;
  onShiftClick?: (shift: Shift) => void;
  memberNames?: Map<string, string>;
  onViewMonthChange?: (date: Date) => void;
  leaves?: LeaveRequest[];
  preferences?: ShiftPreference[];
  onPreferenceClick?: (pref: ShiftPreference) => void;
  statusFilter?: Set<StatusFilterValue>;
  showPreferenceStatus?: boolean;
  currentUserId?: string | null;
  selectedBulkDates?: Set<string>;
  viewMode?: ViewMode;
  onViewModeChange?: (v: ViewMode) => void;
  baseDate?: Date;
  membersById?: Map<string, TenantMember>;
  // 設計書 §5.1: シフト枠のカレンダー表示 + D&D 割当(全 optional・未指定時は完全従来挙動)。
  frames?: ShiftFrame[];
  frameOverrides?: ShiftFrameOverride[];
  frameStoreId?: string | null;
  canAssignFrames?: boolean;
  onAssignPreferenceToFrame?: (preferenceId: string, frameId: string, date: string) => Promise<void>;
  onFrameBarClick?: (date: string) => void;
}

// ============================================================
// DnD: ドラッグ可能な希望バー(§5.1 DraggableCalPrefBar)
// ============================================================

interface DraggableCalPrefBarProps {
  pref: ShiftPreference;
  member?: TenantMember;
  isMine: boolean;
  disabled: boolean;
  onClick?: () => void;
}

function DraggableCalPrefBar({ pref, member, isMine, disabled, onClick }: DraggableCalPrefBarProps) {
  // 裁定(§5.1): {...attributes} は spread しない(KeyboardSensor 非対応のため role/tabIndex/aria-describedby はノイズ)。
  const { setNodeRef, listeners } = useDraggable({
    id: `calpref-${pref.id}`,
    data: { type: 'pref' as const, preference: pref },
    disabled,
  });

  return (
    <div ref={setNodeRef} {...listeners} style={{ touchAction: 'none' }}>
      <CalShiftBar preference={pref} member={member} isMine={isMine} onClick={onClick} />
    </div>
  );
}

// ============================================================
// DnD: 枠バー(droppable。§5.1 CalFrameBar)
// ============================================================

interface CalFrameBarProps {
  frame: EffectiveFrame;
  assigned: number;
  dragPrefDate: string | null;
  onFrameBarClick?: (date: string) => void;
}

function CalFrameBar({ frame, assigned, dragPrefDate, onFrameBarClick }: CalFrameBarProps) {
  // §4.5: droppable(枠) はドラッグ中の希望と同日のときのみ enabled。ドラッグしていない間(dragPrefDate===null)は常に enabled。
  const eligible = dragPrefDate === null || dragPrefDate === frame.date;
  const { setNodeRef, isOver } = useDroppable({
    id: `calframe-${frame.frameId}@${frame.date}`,
    data: { type: 'frame' as const, frameId: frame.frameId, date: frame.date },
    disabled: !eligible,
  });
  const verdict = judgeFrameFulfillment(assigned, frame.requiredCount);
  const tone = TONE_STYLES[verdict.tone];
  const dragState = !eligible
    ? 'opacity-40'
    : isOver
      ? 'ring-2 ring-blue-600 bg-blue-100/60'
      : dragPrefDate !== null
        ? 'ring-1 ring-blue-500'
        : '';
  const label = formatTimeRange(frame.startTime, frame.endTime);
  const a11yLabel = `${frame.name} ${formatTimeRangeA11y(frame.startTime, frame.endTime)} 配置${assigned}人/必要${frame.requiredCount}人 ${verdict.label}。クリックで枠割当を開く`;

  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      aria-label={a11yLabel}
      onClick={(e) => {
        e.stopPropagation();
        onFrameBarClick?.(frame.date);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onFrameBarClick?.(frame.date);
        }
      }}
      className={`flex flex-col min-w-0 w-full text-left cursor-pointer rounded-[3px] py-1 px-1 border-l-2 ${tone.bg} ${dragState} motion-safe:transition-shadow duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
      style={{ borderLeftColor: tone.border }}
    >
      <span className="flex items-center gap-0.5 text-[10px] font-semibold text-stone-700 dark:text-stone-200 truncate">
        <LayoutGrid className="w-2 h-2 shrink-0" aria-hidden="true" />
        <span className="truncate">{frame.name}</span>
      </span>
      <span className="text-[9px] text-stone-500 dark:text-stone-400 tabular-nums truncate">
        {label} {assigned}/{frame.requiredCount}人 {verdict.label}
      </span>
    </div>
  );
}

// ============================================================
// DnD: DragOverlay 用の簡易バークローン(§4.4。onClick/role は持たせない)
// ============================================================

function DragOverlayPrefBar({ pref, member, isMine }: { pref: ShiftPreference; member?: TenantMember; isMine: boolean }) {
  return (
    <div className="w-40 pointer-events-none shadow-lg rounded-[3px]">
      <CalShiftBar preference={pref} member={member} isMine={isMine} />
    </div>
  );
}

// Perf: 親 (ShiftPage) の頻繁な再 render に追従させないため React.memo でラップ。
// 親側で handler/ data を useCallback / useMemo 化済みなので、prop 浅比較で skip できる。
function ShiftCalendarInner({
  shifts,
  onDateClick,
  onShiftClick,
  memberNames,
  onViewMonthChange,
  leaves = [],
  preferences,
  onPreferenceClick,
  statusFilter,
  showPreferenceStatus = false,
  currentUserId,
  selectedBulkDates,
  viewMode: viewModeProp,
  baseDate: baseDateProp,
  membersById,
  frames,
  frameOverrides,
  frameStoreId,
  canAssignFrames = false,
  onAssignPreferenceToFrame,
  onFrameBarClick,
}: ShiftCalendarProps) {
  const [internalViewMode] = useState<ViewMode>('month');
  const [internalBaseDate] = useState(getInitialShiftMonth);
  const viewMode = viewModeProp ?? internalViewMode;
  const baseDate = baseDateProp ?? internalBaseDate;

  // 設計書 §4.2 状態機械: idle | dragging | submitting
  const [activePref, setActivePref] = useState<ShiftPreference | null>(null);
  const [busy, setBusy] = useState(false);

  // 設計書 §4.3: センサー正規値(Pointer distance:5 / Touch delay:250 tolerance:5・KeyboardSensor なし)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  useEffect(() => {
    onViewMonthChange?.(baseDate);
  }, [baseDate, onViewMonthChange]);

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
      for (let i = 0; i < days; i += 1) result.push(addDays(weekStart, i));
    }
    return result;
  }, [viewMode, baseDate]);

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const s of shifts) {
      // Bug#1(2026-06-19): shift.status==='pending'(申請中) は statusFilter に依らず常時表示扱い
      //   (unifiedShiftTypes.ts の設計意図)。StatusFilterValue に 'pending' メンバーが無いため
      //   statusFilter.has('pending') は常に false となり、差し戻し後 (tentative→pending) の
      //   shift がカレンダーから脱落していた。pending を追加で通すだけ (他 status の挙動は不変)。
      const passesFilter =
        s.status === 'pending' ||
        !statusFilter || statusFilter.has(s.status as StatusFilterValue);
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
      // 出勤不可 (unavailable) は自動承認されるため status 不問で表示、preferred は pending のみ
      if (p.preference_type !== 'unavailable' && p.status !== 'pending') continue;
      // preferred は 'pending_preference' chip でゲート、unavailable は 'unavailable_preference' chip でゲート
      const filterKey: StatusFilterValue =
        p.preference_type === 'unavailable' ? 'unavailable_preference' : 'pending_preference';
      const showByFilter = !showPreferenceStatus || !statusFilter || statusFilter.has(filterKey);
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

  // 設計書 §5.1: framesByDate。枠機能 OFF(frameStoreId 未指定)なら空 Map。
  const framesByDate = useMemo(() => {
    const map = new Map<string, EffectiveFrame[]>();
    if (!frames || !frameStoreId) return map;
    for (const d of dates) {
      const dateStr = format(d, 'yyyy-MM-dd');
      const effective = getEffectiveFramesForDate(frames, frameOverrides ?? [], frameStoreId, dateStr);
      if (effective.length > 0) map.set(dateStr, effective);
    }
    return map;
  }, [frames, frameOverrides, frameStoreId, dates]);

  // 設計書 §5.1 注意書き: 充足カウントは statusFilter 非適用の生 shifts から算出(shiftsByDate はフィルタ済のため使用禁止)。
  const frameAssignCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (framesByDate.size === 0) return map;
    for (const effective of framesByDate.values()) {
      for (const frame of effective) {
        const key = `${frame.date}@${frame.frameId}`;
        map.set(key, countFrameAssignments(shifts, frame.frameId, frame.date));
      }
    }
    return map;
  }, [shifts, framesByDate]);

  // 設計書 §4.2: onDragStart → dragging(activePref セット)
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as { type?: string; preference?: ShiftPreference } | undefined;
    if (data?.type === 'pref' && data.preference) {
      setActivePref(data.preference);
    }
  }, []);

  // 設計書 §4.2: onDragEnd
  //   over == null                        → idle(無音キャンセル)
  //   over.data.date !== activePref.date  → idle(第2層防御。disabled により通常到達しない)
  //   over 有効枠                          → submitting(onAssign 呼び出し・busy 管理・throw しない)
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const pref = activePref;
      setActivePref(null);
      if (!pref) return;
      const { over } = event;
      if (!over) return;
      const overData = over.data.current as { type?: string; frameId?: string; date?: string } | undefined;
      if (overData?.type !== 'frame' || !overData.frameId || !overData.date) return;
      if (overData.date !== pref.date) return;
      if (!onAssignPreferenceToFrame) return;
      setBusy(true);
      onAssignPreferenceToFrame(pref.id, overData.frameId, pref.date).finally(() => setBusy(false));
    },
    [activePref, onAssignPreferenceToFrame],
  );

  const handleDragCancel = useCallback(() => {
    setActivePref(null);
  }, []);

  const dragPrefDate = activePref?.date ?? null;

  const today = format(new Date(), 'yyyy-MM-dd');

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="space-y-3">
        <div className="rounded-[10px] overflow-hidden border border-stone-200/70 dark:border-stone-700/70 bg-stone-200/70 dark:bg-stone-700/70">
          <div className="grid grid-cols-7 gap-px bg-stone-200/70 dark:bg-stone-700/70">
            {WEEK_LABELS.map((w, i) => (
              <div
                key={w}
                className={`bg-stone-50 dark:bg-stone-800 py-1.5 px-2.5 text-[11px] font-semibold tracking-[0.04em] ${
                  i === 5
                    ? 'text-blue-600 dark:text-blue-400'
                    : i === 6
                      ? 'text-red-700 dark:text-red-400'
                      : 'text-stone-700 dark:text-stone-300'
                }`}
              >
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px bg-stone-200/70 dark:bg-stone-700/70" aria-label="シフトカレンダー">
            {dates.map((d) => {
              const dateStr = format(d, 'yyyy-MM-dd');
              const isToday = dateStr === today;
              const dayShifts = shiftsByDate.get(dateStr) || [];
              const dayPendingPreferences = preferencesByDate.get(dateStr) || [];
              const dayLeaves = leavesByDate.get(dateStr) || [];
              const dayFrames = canAssignFrames ? framesByDate.get(dateStr) || [] : [];
              const isCurrentMonth = viewMode === 'month' ? d.getMonth() === baseDate.getMonth() : true;
              const dayOfWeek = d.getDay();
              const isHoliday = isJapaneseHoliday(d);
              const holidayName = isHoliday ? getJapaneseHolidayName(d) : null;
              const leaveTooltip = dayLeaves
                .map((l) => {
                  const typeLabel = LEAVE_TYPE_LABEL[l.leave_type] || 'その他';
                  const name = memberNames?.get(l.user_id) || '';
                  return name ? `${typeLabel} - ${name}` : typeLabel;
                })
                .join('\n');
              const isBulkSelected = !!selectedBulkDates && selectedBulkDates.has(dateStr);
              // 正典準拠: 人数 badge は user_id の Set サイズで算出 (重複 shift/preference を 1 名と数える)
              const uniqueHeadcount = (() => {
                const ids = new Set<string>();
                for (const s of dayShifts) ids.add(s.user_id);
                for (const p of dayPendingPreferences) ids.add(p.user_id);
                return ids.size;
              })();
              const allItems: Array<{ kind: 'shift'; data: Shift } | { kind: 'pref'; data: ShiftPreference }> = [
                ...dayShifts.map((s) => ({ kind: 'shift' as const, data: s })),
                ...dayPendingPreferences.map((p) => ({ kind: 'pref' as const, data: p })),
              ];
              const visible = allItems;
              const cellBg = !isCurrentMonth ? 'bg-stone-50 dark:bg-stone-800' : 'bg-white dark:bg-stone-900';
              const weekendTint =
                isCurrentMonth && isHoliday
                  ? 'bg-red-50/40 dark:bg-red-900/15'
                  : isCurrentMonth && dayOfWeek === 6
                    ? 'bg-blue-50/30 dark:bg-blue-900/10'
                    : isCurrentMonth && dayOfWeek === 0
                      ? 'bg-red-50/30 dark:bg-red-900/10'
                      : '';

              return (
                // セルはコンテナ div (クリックハンドラ無し)。導線は中の
                // 日付ヘッダ button とバー button が担う (兄弟・ネストなし)。
                // role=grid/gridcell は付けない (Batch C の a11y 是正を維持)。
                <div
                  key={dateStr}
                  onClick={(e) => {
                    // セルの空き余白 (このコンテナ div 自身) のクリックのみ日モーダルを起動。
                    // 子 (日付ヘッダ button / items div / バー / 休暇 dots) は currentTarget
                    // と一致しないため誤起動しない。role/tabIndex は付けない (既存 a11y 方針)。
                    if (e.target === e.currentTarget) onDateClick(dateStr);
                  }}
                  className={`relative cursor-pointer ${cellBg} ${weekendTint} p-1 motion-safe:transition-colors duration-150 ease-out
                    min-h-[80px] lg:min-h-[130px] [content-visibility:auto] [contain-intrinsic-size:auto_130px]
                    ${isToday ? 'border-t-2 border-blue-600 dark:border-blue-400 bg-blue-600/[0.04] dark:bg-blue-500/10' : ''}
                    ${isBulkSelected ? 'ring-2 ring-blue-500 ring-inset bg-blue-50/60 dark:bg-blue-900/30' : ''}
                  `}
                >
                  <button
                    type="button"
                    aria-label={`${dateStr} の詳細${holidayName ? ` (${holidayName})` : ''}`}
                    aria-pressed={selectedBulkDates ? isBulkSelected : undefined}
                    onClick={() => onDateClick(dateStr)}
                    className={`flex items-center gap-1 w-full text-left appearance-none bg-transparent cursor-pointer rounded-[3px] px-0.5 pb-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset ${
                      isCurrentMonth ? 'hover:bg-stone-50 dark:hover:bg-stone-800' : ''
                    }`}
                  >
                    <span
                      className={`text-[11px] tabular-nums ${
                        !isCurrentMonth
                          ? 'text-stone-400 dark:text-stone-500'
                          : isToday
                            ? 'text-stone-900 dark:text-stone-50 font-bold'
                            : isHoliday
                              ? 'text-red-600 dark:text-red-400 font-medium'
                              : dayOfWeek === 6
                                ? 'text-blue-600 dark:text-blue-400 font-medium'
                                : dayOfWeek === 0
                                  ? 'text-red-600 dark:text-red-400 font-medium'
                                  : 'text-stone-700 dark:text-stone-300 font-medium'
                      }`}
                    >
                      {format(d, 'd')}
                    </span>
                    {uniqueHeadcount > 0 && isCurrentMonth && (
                      <span className="ml-auto text-[9px] text-stone-400 dark:text-stone-500 tabular-nums">{uniqueHeadcount}人</span>
                    )}
                  </button>

                  {dayFrames.length > 0 && (
                    <div className="flex flex-col gap-0.5 min-w-0 mb-0.5">
                      {dayFrames.map((frame) => (
                        <CalFrameBar
                          key={frame.frameId}
                          frame={frame}
                          assigned={frameAssignCounts.get(`${frame.date}@${frame.frameId}`) ?? 0}
                          dragPrefDate={dragPrefDate}
                          onFrameBarClick={onFrameBarClick}
                        />
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col gap-0.5 min-w-0">
                    {visible.map((it) => {
                      if (it.kind === 'shift') {
                        const s = it.data;
                        const member = membersById?.get(s.user_id);
                        const isMine = !!currentUserId && s.user_id === currentUserId;
                        return (
                          <CalShiftBar
                            key={`s-${s.id}`}
                            shift={s}
                            member={member}
                            isMine={isMine}
                            onClick={() => onShiftClick?.(s)}
                          />
                        );
                      }

                      const p = it.data;
                      const member = membersById?.get(p.user_id);
                      const isMine = !!currentUserId && p.user_id === currentUserId;

                      if (canAssignFrames) {
                        // §4.5 draggable(希望) ゲート述語: 非unavailable && pending && store一致 && !busy
                        const isDraggableCandidate =
                          p.preference_type !== 'unavailable' &&
                          p.status === 'pending' &&
                          (!frameStoreId || p.store_id === frameStoreId);
                        return (
                          <DraggableCalPrefBar
                            key={`p-${p.id}`}
                            pref={p}
                            member={member}
                            isMine={isMine}
                            disabled={!isDraggableCandidate || busy}
                            onClick={() => onPreferenceClick?.(p)}
                          />
                        );
                      }

                      return (
                        <CalShiftBar
                          key={`p-${p.id}`}
                          preference={p}
                          member={member}
                          isMine={isMine}
                          onClick={() => onPreferenceClick?.(p)}
                        />
                      );
                    })}
                  </div>

                  {dayLeaves.length > 0 && (
                    <div title={leaveTooltip} className="absolute bottom-1 right-1 flex items-center gap-0.5">
                      {dayLeaves.map((l) => (
                        <span
                          key={l.id}
                          className={`w-1.5 h-1.5 rounded-full ${LEAVE_TYPE_DOT[l.leave_type] || 'bg-blue-500'} ${
                            l.status === 'pending' ? 'ring-1 ring-orange-400' : ''
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {typeof document !== 'undefined' &&
        createPortal(
          <DragOverlay>
            {activePref ? (
              <DragOverlayPrefBar
                pref={activePref}
                member={membersById?.get(activePref.user_id)}
                isMine={!!currentUserId && activePref.user_id === currentUserId}
              />
            ) : null}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}

export const ShiftCalendar = memo(ShiftCalendarInner);
