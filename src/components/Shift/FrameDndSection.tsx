// src/components/Shift/FrameDndSection.tsx
// SP 日詳細シート注入 と FrameAssignSheet の両方から使う「枠カード + 候補 + D&D」の共用セクション。
// 自前の DndContext / DragOverlay(portal) を内包し self-contained。
//
// 設計書:
// - .company/engineering/docs/2026-07-21-kintai-frame-dnd.md §5.2（コンポーネント契約）/ §4（DnD 正規定義）
// - .company/engineering/docs/2026-07-21-kintai-shift-to-frame-dnd.md §6.2（onAssignShift 追加・枠外シフト
//   リスト新設・割当チップ draggable 化・時間省略・activeDrag union 拡張）

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
import { X } from 'lucide-react';
import { Badge, Card, Select } from '../ui';
import { formatTimeRange } from '../../utils/formatTimeRange';
import {
  countFrameAssignments,
  judgeFrameFulfillment,
  resolveUnassignAction,
  timeRangesOverlapOvernight,
  type EffectiveFrame,
  type FrameFulfillmentVerdict,
} from '../../utils/shiftFrames';
import type { Shift, ShiftPreference } from '../../types';

// 設計書 §4.3: collision(3 コンテキスト共通・各ファイルにローカル定義。wave 1 のチーム間 import を作らない)。
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

/** 「配置として数える」status 集合（ShiftDayCoverageHeader / shiftFrames.ts と同一）。 */
const ASSIGNED_STATUSES = new Set<Shift['status']>(['tentative', 'approved', 'modified']);

/** HH:MM 正規化比較(§5.3)。'HH:MM:SS' / 'HH:MM' 混在を吸収する。ローカル 1 行ヘルパ(チーム間 import 禁止)。 */
function timesMatch(a: string, b: string): boolean {
  return a.slice(0, 5) === b.slice(0, 5);
}

/** ドラッグ中アイテムの判別 union（§4: 前ループの activePref を pref|shift の union に拡張）。 */
type ActiveDrag = { kind: 'pref'; pref: ShiftPreference } | { kind: 'shift'; shift: Shift } | null;

export interface FrameDndSectionProps {
  date: string;
  /** 呼び出し側で getEffectiveFramesForDate 済 */
  effectiveFrames: EffectiveFrame[];
  /** 対象日・対象店舗・全 status（statusFilter 非適用） */
  dayShifts: Shift[];
  /** pending・非 unavailable・store/date 一致・ソート済み（sortFrameCandidates） */
  candidates: ShiftPreference[];
  memberNames: Map<string, string>;
  /** 'assign-{prefId}' | 'unassign-{shiftId}' | 'snapshift-{shiftId}' | null */
  busyKey: string | null;
  onAssign: (preferenceId: string, frameId: string) => void | Promise<void>;
  /** §3.2 の分岐は呼び出し側実装 */
  onUnassign: (shift: Shift) => void | Promise<void>;
  /**
   * §3.2 の時間スナップ割当（枠外シフト→枠 / 枠→枠の付け替え）。
   * 未指定時はシフト DnD / 枠外シフトリスト / チップの drag 化を一切出さない（後方互換）。
   */
  onAssignShift?: (shift: Shift, frame: EffectiveFrame) => void | Promise<void>;
  /** 'sp' | 'fa'（§4.1 id 名前空間） */
  idPrefix: string;
  /** FrameAssignSheet の休止/変更/手動追加スロット */
  renderFrameExtras?: (frame: EffectiveFrame) => ReactNode;
}

// ============================================================
// DnD: ドラッグ可能な候補行(§5.2)
// ============================================================

interface DraggableCandidateRowProps {
  idPrefix: string;
  pref: ShiftPreference;
  memberName: string;
  effectiveFrames: EffectiveFrame[];
  disabled: boolean;
  onAssign: (preferenceId: string, frameId: string) => void | Promise<void>;
}

function DraggableCandidateRow({
  idPrefix,
  pref,
  memberName,
  effectiveFrames,
  disabled,
  onAssign,
}: DraggableCandidateRowProps) {
  // 裁定(§5.1 と同様): {...attributes} は spread しない(KeyboardSensor 非対応のためノイズ)。
  const { setNodeRef, listeners } = useDraggable({
    id: `${idPrefix}pref-${pref.id}`,
    data: { type: 'pref' as const, preference: pref },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      style={{ touchAction: 'none' }}
      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm bg-stone-50 dark:bg-stone-800/60"
    >
      <span className="text-stone-700 dark:text-stone-200">
        {memberName}
        {pref.preference_type === 'preferred' && <Badge tone="primary">希望</Badge>}
        {' '}
        {pref.start_time && pref.end_time
          ? formatTimeRange(pref.start_time, pref.end_time, { separator: '-' })
          : '終日可'}
      </span>
      {/* キーボード/AT 代替導線(§5.2): ドラッグ導入後もボタン系導線を必ず残す */}
      <Select
        value=""
        onChange={(e) => e.target.value && onAssign(pref.id, e.target.value)}
        options={[{ value: '', label: '枠へ割当' }, ...effectiveFrames.map((f) => ({ value: f.frameId, label: f.name }))]}
        disabled={disabled}
        aria-label={`${memberName}を枠へ割当`}
      />
    </div>
  );
}

// ============================================================
// DnD: ドラッグ可能な枠外シフト行（§6.2 新設。onAssignShift 未指定時は呼び出し側が描画しない）
// ============================================================

interface DraggableUnframedShiftRowProps {
  idPrefix: string;
  shift: Shift;
  memberName: string;
  effectiveFrames: EffectiveFrame[];
  disabled: boolean;
  onAssignShift: (shift: Shift, frame: EffectiveFrame) => void | Promise<void>;
}

function DraggableUnframedShiftRow({
  idPrefix,
  shift,
  memberName,
  effectiveFrames,
  disabled,
  onAssignShift,
}: DraggableUnframedShiftRowProps) {
  // §5.2/§6.2 の候補行と同型: ref+listeners のみ・attributes 非 spread・touchAction:'none'。
  const { setNodeRef, listeners } = useDraggable({
    id: `${idPrefix}shift-${shift.id}`,
    data: { type: 'shift' as const, shift },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      style={{ touchAction: 'none' }}
      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm bg-stone-50 dark:bg-stone-800/60"
    >
      <span className="text-stone-700 dark:text-stone-200">
        {memberName} {formatTimeRange(shift.start_time, shift.end_time, { separator: '-' })}
      </span>
      {/* キーボード/AT 代替導線: 既存「枠外シフト」Select 導線を統合（§3.5 相当・実行先は onAssignShift に統一） */}
      <Select
        value=""
        onChange={(e) => {
          const frame = effectiveFrames.find((f) => f.frameId === e.target.value);
          if (frame) onAssignShift(shift, frame);
        }}
        options={[{ value: '', label: '枠へ割当' }, ...effectiveFrames.map((f) => ({ value: f.frameId, label: f.name }))]}
        disabled={disabled}
        aria-label={`${memberName}のシフトを枠へ割当`}
      />
    </div>
  );
}

// ============================================================
// DnD: DragOverlay 用のクローン(§4.4。onClick/role は持たせない)
// ============================================================

function DragOverlayCandidateChip({ pref, memberName }: { pref: ShiftPreference; memberName: string }) {
  return (
    <div className="pointer-events-none shadow-lg rounded-md bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 px-2 py-1.5 text-sm text-stone-700 dark:text-stone-200">
      {memberName}
      {pref.preference_type === 'preferred' && <Badge tone="primary">希望</Badge>}
      {' '}
      {pref.start_time && pref.end_time
        ? formatTimeRange(pref.start_time, pref.end_time, { separator: '-' })
        : '終日可'}
    </div>
  );
}

function DragOverlayShiftChip({ shift, memberName }: { shift: Shift; memberName: string }) {
  return (
    <div className="pointer-events-none shadow-lg rounded-full bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 px-2.5 py-1 text-xs text-stone-700 dark:text-stone-200">
      {memberName}（{formatTimeRange(shift.start_time, shift.end_time, { separator: '-' })}）
    </div>
  );
}

// ============================================================
// DnD: 割当済みチップ（§6.2: draggable 化 = 枠→枠の付け替え D&D。×は従来どおり click）
// ============================================================

interface DraggableAssignedChipProps {
  idPrefix: string;
  shift: Shift;
  frame: EffectiveFrame;
  memberName: string;
  disabled: boolean;
  busyKey: string | null;
  onUnassign: (shift: Shift) => void | Promise<void>;
}

function DraggableAssignedChip({
  idPrefix,
  shift,
  frame,
  memberName,
  disabled,
  busyKey,
  onUnassign,
}: DraggableAssignedChipProps) {
  // PointerSensor distance:5 により×クリックとドラッグは両立する（前ループ §4 の裁定と同型）。
  const { setNodeRef, listeners } = useDraggable({
    id: `${idPrefix}shift-${shift.id}`,
    data: { type: 'shift' as const, shift },
    disabled,
  });

  const action = resolveUnassignAction(shift);
  const ariaLabel = action === 'revert_preference' ? `${memberName}を枠から外して申請中に戻す` : `${memberName}を枠から外す`;
  // §5.3: 枠時間と一致 → 名前のみ / 不一致 → 名前（時間）。
  const timeMatches = timesMatch(shift.start_time, frame.startTime) && timesMatch(shift.end_time, frame.endTime);

  return (
    <span
      ref={setNodeRef}
      {...listeners}
      style={{ touchAction: 'none' }}
      className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 dark:bg-stone-800 px-2.5 py-1 text-xs text-stone-700 dark:text-stone-200"
    >
      {timeMatches ? memberName : `${memberName}（${formatTimeRange(shift.start_time, shift.end_time, { separator: '-' })}）`}
      <button
        type="button"
        onClick={() => onUnassign(shift)}
        disabled={busyKey === `unassign-${shift.id}`}
        className="text-stone-400 hover:text-red-600 dark:hover:text-red-400"
        aria-label={ariaLabel}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

// ============================================================
// DnD: 枠カード(droppable。§5.2)
// ============================================================

interface FrameDropCardProps {
  idPrefix: string;
  frame: EffectiveFrame;
  verdict: FrameFulfillmentVerdict;
  assignedCount: number;
  assignedShifts: Shift[];
  memberNames: Map<string, string>;
  activeDrag: ActiveDrag;
  busyKey: string | null;
  onUnassign: (shift: Shift) => void | Promise<void>;
  disabled: boolean;
  /** onAssignShift が呼び出し側から渡されているか（chip の draggable 化ゲート） */
  chipsDraggable: boolean;
  renderFrameExtras?: (frame: EffectiveFrame) => ReactNode;
}

function FrameDropCard({
  idPrefix,
  frame,
  verdict,
  assignedCount,
  assignedShifts,
  memberNames,
  activeDrag,
  busyKey,
  onUnassign,
  disabled,
  chipsDraggable,
  renderFrameExtras,
}: FrameDropCardProps) {
  // §4.5: シート内(単一日)のため droppable は busy 中を除き常時 enabled。
  // §4: droppable data に frame 本体を追加(ハンドラが実効時間を要するため)。
  const { setNodeRef, isOver } = useDroppable({
    id: `${idPrefix}frame-${frame.frameId}`,
    data: { type: 'frame' as const, frameId: frame.frameId, date: frame.date, frame },
    disabled,
  });

  // ドラッグ中のアイテム(pref/shift どちらも可・§4 任意)と時間帯が重複する枠は emerald ヒント。
  const activeTimes =
    activeDrag == null
      ? null
      : activeDrag.kind === 'pref'
        ? { start: activeDrag.pref.start_time, end: activeDrag.pref.end_time }
        : { start: activeDrag.shift.start_time, end: activeDrag.shift.end_time };
  const overlaps =
    activeTimes && activeTimes.start && activeTimes.end
      ? timeRangesOverlapOvernight(frame.startTime, frame.endTime, activeTimes.start, activeTimes.end)
      : false;
  const dragState = isOver ? 'ring-2 ring-blue-500' : overlaps ? 'bg-emerald-50 dark:bg-emerald-900/20' : '';

  return (
    <Card padding="md">
      <div ref={setNodeRef} className={`rounded-md motion-safe:transition-shadow duration-150 ease-out ${dragState}`}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Badge tone="primary">{frame.name}</Badge>
            <span className="text-sm text-stone-600 dark:text-stone-300">
              {formatTimeRange(frame.startTime, frame.endTime, { separator: ' - ' })}
            </span>
            {frame.isModified && <Badge tone="info">変更あり</Badge>}
          </div>
          <Badge tone={verdict.tone}>
            {assignedCount}/{frame.requiredCount}人 {verdict.label}
          </Badge>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {assignedShifts.length === 0 ? (
            <span className="text-xs text-stone-400 dark:text-stone-500">割当なし</span>
          ) : (
            assignedShifts.map((s) => (
              <DraggableAssignedChip
                key={s.id}
                idPrefix={idPrefix}
                shift={s}
                frame={frame}
                memberName={memberNames.get(s.user_id) ?? '—'}
                disabled={disabled || !chipsDraggable}
                busyKey={busyKey}
                onUnassign={onUnassign}
              />
            ))
          )}
        </div>

        {renderFrameExtras?.(frame)}
      </div>
    </Card>
  );
}

// ============================================================
// FrameDndSection 本体
// ============================================================

export function FrameDndSection({
  date,
  effectiveFrames,
  dayShifts,
  candidates,
  memberNames,
  busyKey,
  onAssign,
  onUnassign,
  onAssignShift,
  idPrefix,
  renderFrameExtras,
}: FrameDndSectionProps) {
  // 設計書 §4.2 状態機械: idle | dragging | submitting
  const [activeDrag, setActiveDrag] = useState<ActiveDrag>(null);
  const busy = busyKey !== null;

  // 設計書 §4.3: センサー正規値(Pointer distance:5 / Touch delay:250 tolerance:5・KeyboardSensor なし)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as
      | { type?: string; preference?: ShiftPreference; shift?: Shift }
      | undefined;
    if (data?.type === 'pref' && data.preference) {
      setActiveDrag({ kind: 'pref', pref: data.preference });
    } else if (data?.type === 'shift' && data.shift) {
      setActiveDrag({ kind: 'shift', shift: data.shift });
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const drag = activeDrag;
      setActiveDrag(null);
      if (!drag) return;
      const { over } = event;
      if (!over) return;
      const overData = over.data.current as
        | { type?: string; frameId?: string; frame?: EffectiveFrame }
        | undefined;
      if (overData?.type !== 'frame' || !overData.frameId || !overData.frame) return;
      if (drag.kind === 'pref') {
        void onAssign(drag.pref.id, overData.frameId);
      } else {
        void onAssignShift?.(drag.shift, overData.frame);
      }
    },
    [activeDrag, onAssign, onAssignShift],
  );

  const handleDragCancel = useCallback(() => setActiveDrag(null), []);

  if (effectiveFrames.length === 0) {
    return <div className="text-xs text-stone-400 dark:text-stone-500 px-1 py-2">この日の枠はありません</div>;
  }

  // §3.3/§6.2: 枠外シフト = frame_id null かつ ASSIGNED_STATUSES・start_time 昇順。
  const unframedShifts = onAssignShift
    ? dayShifts
        .filter((s) => s.frame_id === null && ASSIGNED_STATUSES.has(s.status))
        .slice()
        .sort((a, b) => a.start_time.localeCompare(b.start_time))
    : [];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="space-y-3">
        <div>
          <div className="text-xs font-semibold text-stone-500 dark:text-stone-400 mb-2">候補</div>
          {candidates.length === 0 ? (
            <span className="text-xs text-stone-400 dark:text-stone-500">候補なし</span>
          ) : (
            <div className="space-y-1.5">
              {candidates.map((p) => (
                <DraggableCandidateRow
                  key={p.id}
                  idPrefix={idPrefix}
                  pref={p}
                  memberName={memberNames.get(p.user_id) ?? '—'}
                  effectiveFrames={effectiveFrames}
                  disabled={busy}
                  onAssign={onAssign}
                />
              ))}
            </div>
          )}
        </div>

        {/* §6.2 新設: 枠外シフト（onAssignShift 未指定時は描画しない = 後方互換） */}
        {onAssignShift && (
          <div>
            <div className="text-xs font-semibold text-stone-500 dark:text-stone-400 mb-2">枠外シフト</div>
            {unframedShifts.length === 0 ? (
              <span className="text-xs text-stone-400 dark:text-stone-500">枠外シフトなし</span>
            ) : (
              <div className="space-y-1.5">
                {unframedShifts.map((s) => (
                  <DraggableUnframedShiftRow
                    key={s.id}
                    idPrefix={idPrefix}
                    shift={s}
                    memberName={memberNames.get(s.user_id) ?? '—'}
                    effectiveFrames={effectiveFrames}
                    disabled={busy}
                    onAssignShift={onAssignShift}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          {effectiveFrames.map((frame) => {
            const assignedShifts = dayShifts.filter(
              (s) => s.frame_id === frame.frameId && ASSIGNED_STATUSES.has(s.status),
            );
            const assignedCount = countFrameAssignments(dayShifts, frame.frameId, date);
            const verdict = judgeFrameFulfillment(assignedCount, frame.requiredCount);

            return (
              <FrameDropCard
                key={frame.frameId}
                idPrefix={idPrefix}
                frame={frame}
                verdict={verdict}
                assignedCount={assignedCount}
                assignedShifts={assignedShifts}
                memberNames={memberNames}
                activeDrag={activeDrag}
                busyKey={busyKey}
                onUnassign={onUnassign}
                disabled={busy}
                chipsDraggable={!!onAssignShift}
                renderFrameExtras={renderFrameExtras}
              />
            );
          })}
        </div>
      </div>

      {typeof document !== 'undefined' &&
        createPortal(
          <DragOverlay>
            {activeDrag?.kind === 'pref' ? (
              <DragOverlayCandidateChip
                pref={activeDrag.pref}
                memberName={memberNames.get(activeDrag.pref.user_id) ?? '—'}
              />
            ) : activeDrag?.kind === 'shift' ? (
              <DragOverlayShiftChip
                shift={activeDrag.shift}
                memberName={memberNames.get(activeDrag.shift.user_id) ?? '—'}
              />
            ) : null}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}
