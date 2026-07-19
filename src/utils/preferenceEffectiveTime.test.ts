import { describe, it, expect } from 'vitest';
import type { Shift, ShiftPreference } from '../types';
import { buildTentativeShiftMap, getEffectiveTime } from './preferenceEffectiveTime';

function makeShift(over: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    tenant_id: 't1',
    user_id: 'u1',
    date: '2026-06-20',
    start_time: '18:00',
    end_time: '23:00',
    status: 'approved',
    original_start_time: null,
    original_end_time: null,
    note: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-06-10T00:00:00Z',
    tentative_approved_by: null,
    tentative_approved_at: null,
    store_id: 's1',
    preference_id: 'pref-1',
    frame_id: null,
    ...over,
  };
}

function makePref(over: Partial<ShiftPreference> = {}): ShiftPreference {
  return {
    id: 'pref-1',
    tenant_id: 't1',
    user_id: 'u1',
    date: '2026-06-20',
    preference_type: 'preferred',
    start_time: '17:00',
    end_time: '22:00',
    note: null,
    status: 'approved',
    created_at: '2026-06-09T00:00:00Z',
    store_id: 's1',
    ...over,
  };
}

describe('preferenceEffectiveTime', () => {
  it('approved + preference_id 直結 → 確定時刻 & isOverridden=true', () => {
    const map = buildTentativeShiftMap([makeShift()]);
    const eff = getEffectiveTime(makePref(), map);
    expect(eff.start).toBe('18:00');
    expect(eff.end).toBe('23:00');
    expect(eff.isOverridden).toBe(true);
    expect(eff.originalStart).toBe('17:00');
    expect(eff.originalEnd).toBe('22:00');
    expect(eff.shiftId).toBe('shift-1');
  });

  it('回帰: shift.status=approved でもマップから落ちず確定時刻が出る（旧バグ）', () => {
    const map = buildTentativeShiftMap([makeShift({ status: 'approved' })]);
    const eff = getEffectiveTime(makePref(), map);
    expect(eff.start).toBe('18:00');
    expect(eff.isOverridden).toBe(true);
  });

  it('status=modified もマップに含まれる', () => {
    const map = buildTentativeShiftMap([makeShift({ status: 'modified' })]);
    const eff = getEffectiveTime(makePref(), map);
    expect(eff.shiftId).toBe('shift-1');
  });

  it('status=tentative もマップに含まれる', () => {
    const map = buildTentativeShiftMap([makeShift({ status: 'tentative' })]);
    const eff = getEffectiveTime(makePref(), map);
    expect(eff.shiftId).toBe('shift-1');
  });

  it('rejected/cancelled/pending は除外される', () => {
    for (const status of ['rejected', 'cancelled', 'pending'] as const) {
      const map = buildTentativeShiftMap([makeShift({ status })]);
      const eff = getEffectiveTime(makePref(), map);
      // マッチしないので希望時刻フォールバック
      expect(eff.start).toBe('17:00');
      expect(eff.isOverridden).toBe(false);
      expect(eff.shiftId).toBeNull();
    }
  });

  it('preference_id=null + heuristic(user_id|date|store_id) で救済', () => {
    const map = buildTentativeShiftMap([makeShift({ preference_id: null })]);
    const eff = getEffectiveTime(makePref(), map);
    expect(eff.start).toBe('18:00');
    expect(eff.isOverridden).toBe(true);
    expect(eff.shiftId).toBe('shift-1');
  });

  it('preference_id 直結を heuristic より優先', () => {
    const linked = makeShift({ id: 'linked', preference_id: 'pref-1', start_time: '19:00', end_time: '23:00' });
    const heur = makeShift({ id: 'heur', preference_id: null, start_time: '20:00', end_time: '23:00', created_at: '2026-06-15T00:00:00Z' });
    const map = buildTentativeShiftMap([heur, linked]);
    const eff = getEffectiveTime(makePref(), map);
    expect(eff.shiftId).toBe('linked');
    expect(eff.start).toBe('19:00');
  });

  it('pending 希望は希望時刻のまま・確定時刻を出さない', () => {
    const map = buildTentativeShiftMap([makeShift()]);
    const eff = getEffectiveTime(makePref({ status: 'pending' }), map);
    expect(eff.start).toBe('17:00');
    expect(eff.end).toBe('22:00');
    expect(eff.isOverridden).toBe(false);
    expect(eff.shiftId).toBeNull();
  });

  it('unavailable は start/end null（時刻非表示）', () => {
    const map = buildTentativeShiftMap([makeShift()]);
    const eff = getEffectiveTime(
      makePref({ preference_type: 'unavailable', start_time: null, end_time: null }),
      map
    );
    expect(eff.start).toBeNull();
    expect(eff.end).toBeNull();
    expect(eff.isOverridden).toBe(false);
  });

  it('希望どおり承認（時刻一致）→ isOverridden=false', () => {
    const map = buildTentativeShiftMap([makeShift({ start_time: '17:00', end_time: '22:00' })]);
    const eff = getEffectiveTime(makePref(), map);
    expect(eff.isOverridden).toBe(false);
    expect(eff.start).toBe('17:00');
  });

  it('HH:MM 比較で秒差を override 扱いしない', () => {
    const map = buildTentativeShiftMap([makeShift({ start_time: '17:00:30', end_time: '22:00:45' })]);
    const eff = getEffectiveTime(makePref(), map);
    expect(eff.isOverridden).toBe(false);
  });

  it('preference_id 直結で同一 pref に複数シフト → created_at 最新が勝つ', () => {
    const old = makeShift({ id: 'old', start_time: '18:00', created_at: '2026-06-10T00:00:00Z' });
    const recent = makeShift({ id: 'recent', start_time: '19:00', created_at: '2026-06-15T00:00:00Z' });
    const map = buildTentativeShiftMap([old, recent]);
    const eff = getEffectiveTime(makePref(), map);
    expect(eff.shiftId).toBe('recent');
    expect(eff.start).toBe('19:00');
  });

  it('pref.start_time=null（時刻未指定）の承認は override 扱い', () => {
    const map = buildTentativeShiftMap([makeShift()]);
    const eff = getEffectiveTime(makePref({ start_time: null, end_time: null }), map);
    expect(eff.isOverridden).toBe(true);
    expect(eff.start).toBe('18:00');
  });
});
