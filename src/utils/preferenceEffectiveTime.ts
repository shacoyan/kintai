import type { Shift, ShiftPreference } from '../types';

export interface EffectiveTime {
  start: string | null;
  end: string | null;
  isOverridden: boolean;
  originalStart: string | null;
  originalEnd: string | null;
  shiftId: string | null;
}

/**
 * override 反映対象シフトのマップ。
 * - byPreferenceId: migration 096 の shifts.preference_id 直結（最優先・厳密リンク）
 * - byHeuristic: preference_id=null の旧シフト救済用（user_id|date|store_id）
 *
 * 採用 status は approved/tentative/modified（本承認後も時刻を保持するため approved を含む）。
 * rejected/cancelled/pending は除外。タイブレークは created_at 最新優先。
 */
export interface OverrideShiftMap {
  byPreferenceId: Map<string, Shift>;
  byHeuristic: Map<string, Shift>;
}

const OVERRIDE_TARGET_STATUSES: ReadonlySet<Shift['status']> = new Set([
  'approved',
  'tentative',
  'modified',
]);

export function buildTentativeShiftMap(shifts: Shift[]): OverrideShiftMap {
  const byPreferenceId = new Map<string, Shift>();
  const byHeuristic = new Map<string, Shift>();

  for (const shift of shifts) {
    if (!OVERRIDE_TARGET_STATUSES.has(shift.status)) continue;

    if (shift.preference_id) {
      const existing = byPreferenceId.get(shift.preference_id);
      if (!existing || shift.created_at > existing.created_at) {
        byPreferenceId.set(shift.preference_id, shift);
      }
    } else {
      const key = `${shift.user_id}|${shift.date}|${shift.store_id ?? ''}`;
      const existing = byHeuristic.get(key);
      if (!existing || shift.created_at > existing.created_at) {
        byHeuristic.set(key, shift);
      }
    }
  }

  return { byPreferenceId, byHeuristic };
}

export function getEffectiveTime(
  pref: ShiftPreference,
  overrideShiftMap: OverrideShiftMap
): EffectiveTime {
  const defaultResult: EffectiveTime = {
    start: null,
    end: null,
    isOverridden: false,
    originalStart: null,
    originalEnd: null,
    shiftId: null,
  };

  if (pref.preference_type !== 'preferred') {
    return defaultResult;
  }

  if (pref.status !== 'approved') {
    return {
      start: pref.start_time,
      end: pref.end_time,
      isOverridden: false,
      originalStart: pref.start_time,
      originalEnd: pref.end_time,
      shiftId: null,
    };
  }

  // preference_id 直結を最優先 → 無ければ heuristic で救済
  const matchedShift =
    overrideShiftMap.byPreferenceId.get(pref.id) ??
    overrideShiftMap.byHeuristic.get(
      `${pref.user_id}|${pref.date}|${pref.store_id ?? ''}`
    );

  if (matchedShift) {
    const isStartOverridden =
      pref.start_time === null
        ? true
        : matchedShift.start_time.slice(0, 5) !== pref.start_time.slice(0, 5);
    const isEndOverridden =
      pref.end_time === null
        ? true
        : matchedShift.end_time.slice(0, 5) !== pref.end_time.slice(0, 5);

    return {
      start: matchedShift.start_time,
      end: matchedShift.end_time,
      isOverridden: isStartOverridden || isEndOverridden,
      originalStart: pref.start_time,
      originalEnd: pref.end_time,
      shiftId: matchedShift.id,
    };
  }

  return {
    start: pref.start_time,
    end: pref.end_time,
    isOverridden: false,
    originalStart: pref.start_time,
    originalEnd: pref.end_time,
    shiftId: null,
  };
}
