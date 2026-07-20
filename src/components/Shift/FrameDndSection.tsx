// src/components/Shift/FrameDndSection.tsx
// SP 日詳細シート注入 と FrameAssignSheet の両方から使う「枠カード + 候補 + D&D」の共用セクション。
// 自前の DndContext / DragOverlay(portal) を内包し self-contained。
//
// 設計書: .company/engineering/docs/2026-07-21-kintai-frame-dnd.md §5.2（コンポーネント契約）/ §4（DnD 正規定義）

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

export interface FrameDndSectionProps {
  date: string;
  /** 呼び出し側で getEffectiveFramesForDate 済 */
  effectiveFrames: EffectiveFrame[];
  /** 対象日・対象店舗・全 status（statusFilter 非適用） */
  dayShifts: Shift[];
  /** pending・非 unavailable・store/date 一致・ソート済み（sortFrameCandidates） */
  candidates: ShiftPreference[];
  memberNames: Map<string, string>;
  /** 'assign-{prefId}' | 'unassign-{shiftId}' | null */
  busyKey: string | null;
  onAssign: (preferenceId: string, frameId: string) => void | Promise<void>;
  /** §3.2 の分岐は呼び出し側実装 */
  onUnassign: (shift: Shift) => void | Promise<void>;
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
// DnD: DragOverlay 用の候補行クローン(§4.4。onClick/role は持たせない)
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
  activePref: ShiftPreference | null;
  busyKey: string | null;
  onUnassign: (shift: Shift) => void | Promise<void>;
  disabled: boolean;
  renderFrameExtras?: (frame: EffectiveFrame) => ReactNode;
}

function FrameDropCard({
  idPrefix,
  frame,
  verdict,
  assignedCount,
  assignedShifts,
  memberNames,
  activePref,
  busyKey,
  onUnassign,
  disabled,
  renderFrameExtras,
}: FrameDropCardProps) {
  // §4.5: シート内(単一日)のため droppable は busy 中を除き常時 enabled。
  const { setNodeRef, isOver } = useDroppable({
    id: `${idPrefix}frame-${frame.frameId}`,
    data: { type: 'frame' as const, frameId: frame.frameId, date: frame.date },
    disabled,
  });

  // ドラッグ中の候補と時間帯が重複する枠は emerald ヒント(時刻 NULL 候補はヒントなし)。
  const overlaps =
    activePref && activePref.start_time && activePref.end_time
      ? timeRangesOverlapOvernight(frame.startTime, frame.endTime, activePref.start_time, activePref.end_time)
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
            assignedShifts.map((s) => {
              // §3.2: 表示判定に resolveUnassignAction を使ってよい(実行は onUnassign 側の責務)。
              const action = resolveUnassignAction(s);
              const name = memberNames.get(s.user_id) ?? '—';
              const ariaLabel =
                action === 'revert_preference' ? `${name}を枠から外して申請中に戻す` : `${name}を枠から外す`;
              return (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 dark:bg-stone-800 px-2.5 py-1 text-xs text-stone-700 dark:text-stone-200"
                >
                  {name}（{formatTimeRange(s.start_time, s.end_time, { separator: '-' })}）
                  <button
                    type="button"
                    onClick={() => onUnassign(s)}
                    disabled={busyKey === `unassign-${s.id}`}
                    className="text-stone-400 hover:text-red-600 dark:hover:text-red-400"
                    aria-label={ariaLabel}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })
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
  idPrefix,
  renderFrameExtras,
}: FrameDndSectionProps) {
  // 設計書 §4.2 状態機械: idle | dragging | submitting
  const [activePref, setActivePref] = useState<ShiftPreference | null>(null);
  const busy = busyKey !== null;

  // 設計書 §4.3: センサー正規値(Pointer distance:5 / Touch delay:250 tolerance:5・KeyboardSensor なし)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as { type?: string; preference?: ShiftPreference } | undefined;
    if (data?.type === 'pref' && data.preference) {
      setActivePref(data.preference);
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const pref = activePref;
      setActivePref(null);
      if (!pref) return;
      const { over } = event;
      if (!over) return;
      const overData = over.data.current as { type?: string; frameId?: string } | undefined;
      if (overData?.type !== 'frame' || !overData.frameId) return;
      void onAssign(pref.id, overData.frameId);
    },
    [activePref, onAssign],
  );

  const handleDragCancel = useCallback(() => setActivePref(null), []);

  if (effectiveFrames.length === 0) {
    return <div className="text-xs text-stone-400 dark:text-stone-500 px-1 py-2">この日の枠はありません</div>;
  }

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
                activePref={activePref}
                busyKey={busyKey}
                onUnassign={onUnassign}
                disabled={busy}
                renderFrameExtras={renderFrameExtras}
              />
            );
          })}
        </div>
      </div>

      {typeof document !== 'undefined' &&
        createPortal(
          <DragOverlay>
            {activePref ? (
              <DragOverlayCandidateChip pref={activePref} memberName={memberNames.get(activePref.user_id) ?? '—'} />
            ) : null}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}
