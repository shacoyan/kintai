import type { Shift, ShiftPreference } from '../types';

export interface EffectiveTime {
  start: string | null;
  end: string | null;
  isOverridden: boolean;
  originalStart: string | null;
  originalEnd: string | null;
  shiftId: string | null;
}

export function buildTentativeShiftMap(shifts: Shift[]): Map<string, Shift> {
  const map = new Map<string, Shift>();

  for (const shift of shifts) {
    if (shift.status !== 'tentative') continue;
    const key = `${shift.user_id}|${shift.date}|${shift.store_id ?? ''}`;

    const existing = map.get(key);
    if (!existing || shift.created_at > existing.created_at) {
      map.set(key, shift);
    }
  }

  return map;
}

export function getEffectiveTime(
  pref: ShiftPreference,
  tentativeShiftMap: Map<string, Shift>
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

  const primaryKey = `${pref.user_id}|${pref.date}|${pref.store_id ?? ''}`;
  const matchedShift = tentativeShiftMap.get(primaryKey);

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
