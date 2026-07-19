import { useState, useEffect, useMemo, useCallback } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, X, UserPlus, Ban, CalendarClock, Pencil } from 'lucide-react';
import { useShiftFrames } from '../../hooks/useShiftFrames';
import { useToast } from '../../contexts/ToastContext';
import { formatSupabaseError } from '../../lib/errors';
import { formatTimeRange } from '../../utils/formatTimeRange';
import {
  getEffectiveFramesForDate,
  countFrameAssignments,
  judgeFrameFulfillment,
  timeRangesOverlapOvernight,
  type EffectiveFrame,
} from '../../utils/shiftFrames';
import { BottomSheet, Button, Badge, Select, Card, EmptyState, Input } from '../ui';
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

/** 「配置として数える」status 集合（ShiftDayCoverageHeader / shiftFrames.ts と同一）。 */
const ASSIGNED_STATUSES = new Set<Shift['status']>(['tentative', 'approved', 'modified']);

function isCandidatePreferenceType(t: string): boolean {
  return t === 'preferred' || t === 'available';
}

export function FrameAssignSheet({
  tenantId,
  storeId,
  date,
  onDateChange,
  members,
  allShifts,
  allPreferences,
  addShiftForMember,
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
      allPreferences
        .filter((p) => p.date === date && p.store_id === storeId && p.status === 'pending' && isCandidatePreferenceType(p.preference_type))
        .sort((a, b) => {
          if (a.preference_type !== b.preference_type) return a.preference_type === 'preferred' ? -1 : 1;
          const aStart = a.start_time ?? '';
          const bStart = b.start_time ?? '';
          return aStart < bStart ? -1 : aStart > bStart ? 1 : 0;
        }),
    [allPreferences, date, storeId],
  );

  const unassignedShifts = useMemo(
    () => dayShifts.filter((s) => s.frame_id === null && ASSIGNED_STATUSES.has(s.status)),
    [dayShifts],
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
      showToast('候補を枠へ割り当てました', 'success');
      onMutated();
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const handleUnassign = async (shiftId: string) => {
    setBusyKey(`unassign-${shiftId}`);
    try {
      await setShiftFrame(shiftId, null);
      showToast('枠から外しました', 'success');
      onMutated();
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const handleAssignExisting = async (shiftId: string, frameId: string) => {
    setBusyKey(`link-${shiftId}`);
    try {
      await setShiftFrame(shiftId, frameId);
      showToast('枠へ割り当てました', 'success');
      onMutated();
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setBusyKey(null);
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
          effectiveFrames.map((frame) => {
            const assignedShifts = dayShifts.filter(
              (s) => s.frame_id === frame.frameId && ASSIGNED_STATUSES.has(s.status),
            );
            const assignedCount = countFrameAssignments(dayShifts, frame.frameId, date);
            const verdict = judgeFrameFulfillment(assignedCount, frame.requiredCount);
            const hasOverride = overrides.some((o) => o.frame_id === frame.frameId && o.date === date);

            return (
              <Card key={frame.frameId} padding="md">
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
                      <span
                        key={s.id}
                        className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 dark:bg-stone-800 px-2.5 py-1 text-xs text-stone-700 dark:text-stone-200"
                      >
                        {memberNames.get(s.user_id) ?? '—'}（{formatTimeRange(s.start_time, s.end_time, { separator: '-' })}）
                        <button
                          type="button"
                          onClick={() => handleUnassign(s.id)}
                          disabled={busyKey === `unassign-${s.id}`}
                          className="text-stone-400 hover:text-red-600 dark:hover:text-red-400"
                          aria-label={`${memberNames.get(s.user_id) ?? ''}を枠から外す`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))
                  )}
                </div>

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

                <div className="mt-4 border-t border-stone-200 dark:border-stone-700 pt-3">
                  <div className="text-xs font-semibold text-stone-500 dark:text-stone-400 mb-2">候補</div>
                  {dayCandidates.length === 0 ? (
                    <span className="text-xs text-stone-400 dark:text-stone-500">候補なし</span>
                  ) : (
                    <div className="space-y-1.5">
                      {dayCandidates.map((p) => {
                        const overlaps =
                          p.start_time && p.end_time
                            ? timeRangesOverlapOvernight(frame.startTime, frame.endTime, p.start_time, p.end_time)
                            : true; // 終日可（時刻NULL）は常に候補・ハイライトなし扱い
                        const noTime = !p.start_time || !p.end_time;
                        return (
                          <div
                            key={p.id}
                            className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm ${
                              !noTime && overlaps ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-transparent'
                            }`}
                          >
                            <span className="text-stone-700 dark:text-stone-200">
                              {memberNames.get(p.user_id) ?? '—'}
                              {p.preference_type === 'preferred' && <Badge tone="primary">希望</Badge>}
                              {' '}
                              {p.start_time && p.end_time ? formatTimeRange(p.start_time, p.end_time, { separator: '-' }) : '終日可'}
                            </span>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleAssign(p.id, frame.frameId)}
                              disabled={busyKey === `assign-${p.id}`}
                            >
                              この枠に割当
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

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
              </Card>
            );
          })
        )}

        <Card padding="md">
          <div className="text-xs font-semibold text-stone-500 dark:text-stone-400 mb-2">枠外シフト</div>
          {unassignedShifts.length === 0 ? (
            <span className="text-xs text-stone-400 dark:text-stone-500">枠外シフトなし</span>
          ) : (
            <div className="space-y-1.5">
              {unassignedShifts.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-stone-700 dark:text-stone-200">
                    {memberNames.get(s.user_id) ?? '—'}（{formatTimeRange(s.start_time, s.end_time, { separator: '-' })}）
                  </span>
                  {effectiveFrames.length > 0 && (
                    <Select
                      value=""
                      onChange={(e) => e.target.value && handleAssignExisting(s.id, e.target.value)}
                      options={[{ value: '', label: '枠へ割当' }, ...effectiveFrames.map((f) => ({ value: f.frameId, label: f.name }))]}
                      aria-label={`${memberNames.get(s.user_id) ?? ''}のシフトを枠へ割当`}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </BottomSheet>
  );
}
