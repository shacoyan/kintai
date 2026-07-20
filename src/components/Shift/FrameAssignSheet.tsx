import { useState, useEffect, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, UserPlus, Ban, CalendarClock, Pencil } from 'lucide-react';
import { useShiftFrames } from '../../hooks/useShiftFrames';
import { useToast } from '../../contexts/ToastContext';
import { formatSupabaseError } from '../../lib/errors';
import {
  getEffectiveFramesForDate,
  isCandidatePreferenceType,
  resolveUnassignAction,
  sortFrameCandidates,
  planShiftToFrameSnap,
  buildAssignShiftSuccessMessage,
  buildAssignShiftLinkFailureMessage,
  type EffectiveFrame,
} from '../../utils/shiftFrames';
import { FrameDndSection } from './FrameDndSection';
import { BottomSheet, Button, Select, EmptyState, Input } from '../ui';
import type { Shift, ShiftPreference, TenantMember } from '../../types';

interface FrameAssignSheetProps {
  tenantId: string;
  storeId: string;
  date: string;
  onDateChange: (date: string) => void;
  members: TenantMember[];
  allShifts: Shift[];
  allPreferences: ShiftPreference[];
  addShiftForMember: (
    date: string,
    userId: string,
    storeId: string,
    startTime: string,
    endTime: string,
    note?: string,
    frameId?: string | null,
  ) => Promise<Shift>;
  /** 希望を pending に戻す(§3.2 差戻し)。ShiftPage の useShiftPreference().revertPreference をそのまま渡す。 */
  revertPreference: (preferenceId: string) => Promise<void>;
  /** シフト時間更新(update_shift_time RPC)。§3.2 の時間スナップ経路。ShiftPage の useShift().modifyShift をそのまま渡す。 */
  modifyShift: (shiftId: string, startTime: string, endTime: string, storeId?: string) => Promise<void>;
  onClose: () => void;
  onMutated: () => void;
}

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '15', '30', '45']) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`);
  }
}
const TIME_OPTION_OBJECTS = TIME_OPTIONS.map((t) => ({ value: t, label: t }));

export function FrameAssignSheet({
  tenantId,
  storeId,
  date,
  onDateChange,
  members,
  allShifts,
  allPreferences,
  addShiftForMember,
  revertPreference,
  modifyShift,
  onClose,
  onMutated,
}: FrameAssignSheetProps) {
  const { showToast } = useToast();
  const {
    frames,
    overrides,
    fetchFrames,
    assignPreferenceToFrame,
    setShiftFrame,
    upsertOverride,
    removeOverride,
  } = useShiftFrames(tenantId, storeId);

  useEffect(() => {
    fetchFrames(date, date);
  }, [date, fetchFrames]);

  const memberNames = useMemo(() => new Map(members.map((m) => [m.user_id, m.display_name])), [members]);

  const effectiveFrames = useMemo(
    () => getEffectiveFramesForDate(frames, overrides, storeId, date),
    [frames, overrides, storeId, date],
  );

  const dayShifts = useMemo(
    () => allShifts.filter((s) => s.date === date && s.store_id === storeId),
    [allShifts, date, storeId],
  );

  const dayCandidates = useMemo(
    () =>
      sortFrameCandidates(
        allPreferences.filter(
          (p) => p.date === date && p.store_id === storeId && p.status === 'pending' && isCandidatePreferenceType(p.preference_type),
        ),
      ),
    [allPreferences, date, storeId],
  );

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [manualAddFrameId, setManualAddFrameId] = useState<string | null>(null);
  const [manualUserId, setManualUserId] = useState('');
  const [manualStart, setManualStart] = useState('09:00');
  const [manualEnd, setManualEnd] = useState('17:00');

  const [modifyFrameId, setModifyFrameId] = useState<string | null>(null);
  const [modifyName, setModifyName] = useState('');
  const [modifyStart, setModifyStart] = useState('09:00');
  const [modifyEnd, setModifyEnd] = useState('17:00');
  const [modifyRequiredCount, setModifyRequiredCount] = useState(1);

  const goPrevDay = useCallback(() => onDateChange(format(addDays(parseISO(date), -1), 'yyyy-MM-dd')), [date, onDateChange]);
  const goNextDay = useCallback(() => onDateChange(format(addDays(parseISO(date), 1), 'yyyy-MM-dd')), [date, onDateChange]);

  const handleAssign = async (preferenceId: string, frameId: string) => {
    setBusyKey(`assign-${preferenceId}`);
    try {
      await assignPreferenceToFrame(preferenceId, frameId);
      showToast('枠へ割り当てました（仮承認）', 'success');
      onMutated();
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setBusyKey(null);
    }
  };

  // §3.2: resolveUnassignAction の分岐どおり。tentative + preference_id あり(希望由来)のみ
  // revertPreference(希望を pending に戻す)。それ以外(手動追加 tentative / approved / modified)は
  // 従来どおり setShiftFrame(id, null) のリンク解除のみ。
  const handleUnassign = async (shift: Shift) => {
    const action = resolveUnassignAction(shift);
    setBusyKey(`unassign-${shift.id}`);
    try {
      if (action === 'revert_preference') {
        await revertPreference(shift.preference_id!);
        showToast('枠から外し、希望を申請中に戻しました', 'success');
      } else {
        await setShiftFrame(shift.id, null);
        showToast('枠から外しました', 'success');
      }
      onMutated();
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setBusyKey(null);
    }
  };

  // §3.2 canonical: 時間スナップ（skip-if-equal）+ リンク。旧 handleAssignExisting（リンクのみ）を統合・撤去。
  const handleAssignShift = async (shift: Shift, frame: EffectiveFrame) => {
    const plan = planShiftToFrameSnap(shift, frame);
    if (!plan.needsTimeUpdate && !plan.needsLink) return; // 完全 no-op: 無音

    const memberName = memberNames.get(shift.user_id) ?? '—';
    setBusyKey(`snapshift-${shift.id}`);
    let timeUpdated = false;
    try {
      if (plan.needsTimeUpdate) {
        await modifyShift(shift.id, plan.newStartTime, plan.newEndTime);
        timeUpdated = true;
      }
      if (plan.needsLink) {
        await setShiftFrame(shift.id, frame.frameId);
      }
      showToast(buildAssignShiftSuccessMessage(memberName, frame.name, plan), 'success');
    } catch (err) {
      const msg = formatSupabaseError(err).message;
      if (timeUpdated && plan.needsLink) {
        showToast(buildAssignShiftLinkFailureMessage(plan, msg), 'error');
      } else {
        showToast(msg, 'error');
      }
    } finally {
      setBusyKey(null);
      onMutated();
    }
  };

  const openManualAdd = (frame: EffectiveFrame) => {
    setManualAddFrameId(frame.frameId);
    setManualUserId('');
    setManualStart(frame.startTime.slice(0, 5));
    setManualEnd(frame.endTime.slice(0, 5));
  };

  const handleManualAdd = async () => {
    if (!manualAddFrameId || !manualUserId) return;
    setBusyKey(`manual-${manualAddFrameId}`);
    try {
      await addShiftForMember(date, manualUserId, storeId, manualStart, manualEnd, undefined, manualAddFrameId);
      showToast('シフトを追加しました', 'success');
      setManualAddFrameId(null);
      onMutated();
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const handleCancelDay = async (frame: EffectiveFrame) => {
    setBusyKey(`cancel-${frame.frameId}`);
    try {
      await upsertOverride(frame.frameId, date, { kind: 'cancel' });
      showToast('この日だけ休止しました', 'success');
      onMutated();
      await fetchFrames(date, date);
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const openModifyDay = (frame: EffectiveFrame) => {
    setModifyFrameId(frame.frameId);
    setModifyName(frame.name);
    setModifyStart(frame.startTime.slice(0, 5));
    setModifyEnd(frame.endTime.slice(0, 5));
    setModifyRequiredCount(frame.requiredCount);
  };

  const handleModifyDay = async (frame: EffectiveFrame) => {
    if (!modifyName || !modifyStart || !modifyEnd || modifyRequiredCount < 1) return;
    setBusyKey(`modify-${frame.frameId}`);
    try {
      await upsertOverride(frame.frameId, date, {
        kind: 'modify',
        name: modifyName,
        startTime: modifyStart,
        endTime: modifyEnd,
        requiredCount: modifyRequiredCount,
      });
      showToast('この日だけ変更しました', 'success');
      setModifyFrameId(null);
      onMutated();
      await fetchFrames(date, date);
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const handleRemoveOverride = async (frame: EffectiveFrame) => {
    const target = overrides.find((o) => o.frame_id === frame.frameId && o.date === date);
    if (!target) return;
    setBusyKey(`removeoverride-${frame.frameId}`);
    try {
      await removeOverride(target.id);
      showToast('上書きを解除しました', 'success');
      onMutated();
      await fetchFrames(date, date);
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setBusyKey(null);
    }
  };

  // §5.3: 「この日だけ休止 / 変更 / 上書き解除」+「手動追加」を FrameDndSection の renderFrameExtras スロットへ移設。
  // FrameDndSection は memo でないため useCallback 化は不要(新規関数参照でも過剰再 render の懸念なし)。
  const renderFrameExtras = (frame: EffectiveFrame): ReactNode => {
    const hasOverride = overrides.some((o) => o.frame_id === frame.frameId && o.date === date);
    return (
      <>
        {!frame.isOneOff && (
          <div className="mt-3">
            {hasOverride ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => handleRemoveOverride(frame)} disabled={busyKey === `removeoverride-${frame.frameId}`}>
                  上書き解除
                </Button>
              </div>
            ) : modifyFrameId === frame.frameId ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-full sm:w-auto sm:flex-1 min-w-[140px]">
                  <Input label="枠名" value={modifyName} onChange={(e) => setModifyName(e.target.value)} size="sm" />
                </div>
                <Select label="開始" value={modifyStart} onChange={(e) => setModifyStart(e.target.value)} options={TIME_OPTION_OBJECTS} />
                <Select label="終了" value={modifyEnd} onChange={(e) => setModifyEnd(e.target.value)} options={TIME_OPTION_OBJECTS} />
                <div className="w-20">
                  <Input
                    label="必要人数"
                    type="number"
                    min={1}
                    max={50}
                    value={modifyRequiredCount}
                    onChange={(e) => setModifyRequiredCount(Number(e.target.value))}
                    size="sm"
                  />
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleModifyDay(frame)}
                  disabled={!modifyName || !modifyStart || !modifyEnd || modifyRequiredCount < 1 || busyKey === `modify-${frame.frameId}`}
                >
                  保存
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setModifyFrameId(null)}>
                  キャンセル
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleCancelDay(frame)}
                  disabled={busyKey === `cancel-${frame.frameId}`}
                  iconLeft={<Ban className="w-3.5 h-3.5" />}
                >
                  この日だけ休止
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openModifyDay(frame)}
                  iconLeft={<Pencil className="w-3.5 h-3.5" />}
                >
                  この日だけ変更
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="mt-3 border-t border-stone-200 dark:border-stone-700 pt-3">
          {manualAddFrameId === frame.frameId ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-full sm:w-auto sm:flex-1 min-w-[140px]">
                <Select
                  label="メンバー"
                  value={manualUserId}
                  onChange={(e) => setManualUserId(e.target.value)}
                  options={[{ value: '', label: '選択してください' }, ...members.map((m) => ({ value: m.user_id, label: m.display_name }))]}
                />
              </div>
              <Select label="開始" value={manualStart} onChange={(e) => setManualStart(e.target.value)} options={TIME_OPTION_OBJECTS} />
              <Select label="終了" value={manualEnd} onChange={(e) => setManualEnd(e.target.value)} options={TIME_OPTION_OBJECTS} />
              <Button variant="primary" size="sm" onClick={handleManualAdd} disabled={!manualUserId || busyKey === `manual-${frame.frameId}`}>
                追加
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setManualAddFrameId(null)}>
                キャンセル
              </Button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => openManualAdd(frame)} iconLeft={<UserPlus className="w-3.5 h-3.5" />}>
              希望なしメンバーを手動追加
            </Button>
          )}
        </div>
      </>
    );
  };

  return (
    <BottomSheet isOpen onClose={onClose} title="枠割当" widthClassName="md:max-w-2xl" ariaLabel="シフト枠割当">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Button variant="secondary" size="sm" onClick={goPrevDay} iconLeft={<ChevronLeft className="w-4 h-4" />} aria-label="前日">
            <span className="sr-only">前日</span>
          </Button>
          <div className="text-sm font-semibold text-stone-700 dark:text-stone-200">
            {format(parseISO(date), 'M月d日(E)', { locale: ja })}
          </div>
          <Button variant="secondary" size="sm" onClick={goNextDay} iconLeft={<ChevronRight className="w-4 h-4" />} aria-label="翌日">
            <span className="sr-only">翌日</span>
          </Button>
        </div>

        {effectiveFrames.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="w-10 h-10 text-stone-400 dark:text-stone-500" />}
            title="この日の枠はありません"
            description="シフト枠は管理画面の「シフト枠」から設定できます"
          />
        ) : (
          <FrameDndSection
            idPrefix="fa"
            date={date}
            effectiveFrames={effectiveFrames}
            dayShifts={dayShifts}
            candidates={dayCandidates}
            memberNames={memberNames}
            busyKey={busyKey}
            onAssign={handleAssign}
            onUnassign={handleUnassign}
            onAssignShift={handleAssignShift}
            renderFrameExtras={renderFrameExtras}
          />
        )}
      </div>
    </BottomSheet>
  );
}
