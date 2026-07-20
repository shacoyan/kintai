import { describe, it, expect } from 'vitest';
import {
  FRAME_DAY_LABELS,
  getDayOfWeek,
  getEffectiveFramesForDate,
  countFrameAssignments,
  judgeFrameFulfillment,
  timeRangesOverlapOvernight,
  resolveUnassignAction,
  isCandidatePreferenceType,
  sortFrameCandidates,
  planShiftToFrameSnap,
  buildAssignShiftSuccessMessage,
  buildAssignShiftLinkFailureMessage,
} from './shiftFrames';
import type { EffectiveFrame } from './shiftFrames';
import type { Shift, ShiftFrame, ShiftFrameOverride, ShiftPreference } from '../types';

function makeFrame(overrides: Partial<ShiftFrame>): ShiftFrame {
  return {
    id: 'frame-1',
    tenant_id: 't1',
    store_id: 's1',
    day_of_week: null,
    date: null,
    name: '早番',
    start_time: '09:00:00',
    end_time: '17:00:00',
    required_count: 2,
    sort_order: 0,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeOverride(overrides: Partial<ShiftFrameOverride>): ShiftFrameOverride {
  return {
    id: 'override-1',
    tenant_id: 't1',
    frame_id: 'frame-1',
    date: '2026-07-20',
    kind: 'cancel',
    name: null,
    start_time: null,
    end_time: null,
    required_count: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('FRAME_DAY_LABELS', () => {
  it('0=日..6=土 の getDay 値と表示順が月→日である', () => {
    expect(FRAME_DAY_LABELS.map((d) => d.label)).toEqual(['月', '火', '水', '木', '金', '土', '日']);
    expect(FRAME_DAY_LABELS.find((d) => d.label === '日')?.value).toBe(0);
    expect(FRAME_DAY_LABELS.find((d) => d.label === '土')?.value).toBe(6);
  });
});

describe('getDayOfWeek', () => {
  it('2026-07-19(日) → 0', () => {
    expect(getDayOfWeek('2026-07-19')).toBe(0);
  });
  it('2026-07-25(土) → 6', () => {
    expect(getDayOfWeek('2026-07-25')).toBe(6);
  });
  it('2026-07-20(月) → 1', () => {
    expect(getDayOfWeek('2026-07-20')).toBe(1);
  });
});

describe('judgeFrameFulfillment', () => {
  it('assigned=0 → unfilled/未配置/danger', () => {
    expect(judgeFrameFulfillment(0, 3)).toEqual({ level: 'unfilled', label: '未配置', tone: 'danger' });
  });
  it('0<assigned<required → shortage/不足/warning', () => {
    expect(judgeFrameFulfillment(1, 3)).toEqual({ level: 'shortage', label: '不足', tone: 'warning' });
  });
  it('assigned=required → met/充足/success', () => {
    expect(judgeFrameFulfillment(3, 3)).toEqual({ level: 'met', label: '充足', tone: 'success' });
  });
  it('assigned>required → excess/超過/info', () => {
    expect(judgeFrameFulfillment(4, 3)).toEqual({ level: 'excess', label: '超過', tone: 'info' });
  });
});

describe('countFrameAssignments', () => {
  const base: Pick<Shift, 'frame_id' | 'date' | 'status'>[] = [
    { frame_id: 'f1', date: '2026-07-20', status: 'tentative' },
    { frame_id: 'f1', date: '2026-07-20', status: 'approved' },
    { frame_id: 'f1', date: '2026-07-20', status: 'modified' },
    { frame_id: 'f1', date: '2026-07-20', status: 'pending' },
    { frame_id: 'f1', date: '2026-07-20', status: 'cancelled' },
    { frame_id: 'f1', date: '2026-07-20', status: 'rejected' },
    { frame_id: 'f2', date: '2026-07-20', status: 'tentative' },
    { frame_id: 'f1', date: '2026-07-21', status: 'tentative' },
  ];

  it('tentative/approved/modified のみ数える(pending/cancelled/rejected は除外)', () => {
    expect(countFrameAssignments(base, 'f1', '2026-07-20')).toBe(3);
  });
  it('別 frame は数えない', () => {
    expect(countFrameAssignments(base, 'f2', '2026-07-20')).toBe(1);
  });
  it('別 date は数えない', () => {
    expect(countFrameAssignments(base, 'f1', '2026-07-21')).toBe(1);
  });
});

describe('getEffectiveFramesForDate', () => {
  it('曜日一致する毎週テンプレを含める（2026-07-20=月=1）', () => {
    const frames = [makeFrame({ id: 'f1', day_of_week: 1 })];
    const result = getEffectiveFramesForDate(frames, [], 's1', '2026-07-20');
    expect(result.map((r) => r.frameId)).toEqual(['f1']);
    expect(result[0].isOneOff).toBe(false);
    expect(result[0].isModified).toBe(false);
  });

  it('曜日不一致は除外する', () => {
    const frames = [makeFrame({ id: 'f1', day_of_week: 2 })]; // 火
    const result = getEffectiveFramesForDate(frames, [], 's1', '2026-07-20'); // 月
    expect(result).toEqual([]);
  });

  it('is_active=false は除外する', () => {
    const frames = [makeFrame({ id: 'f1', day_of_week: 1, is_active: false })];
    const result = getEffectiveFramesForDate(frames, [], 's1', '2026-07-20');
    expect(result).toEqual([]);
  });

  it('cancel override は除外する', () => {
    const frames = [makeFrame({ id: 'f1', day_of_week: 1 })];
    const overrides = [makeOverride({ frame_id: 'f1', date: '2026-07-20', kind: 'cancel' })];
    const result = getEffectiveFramesForDate(frames, overrides, 's1', '2026-07-20');
    expect(result).toEqual([]);
  });

  it('modify override は丸ごと差替し isModified=true になる', () => {
    const frames = [makeFrame({ id: 'f1', day_of_week: 1, name: '早番', start_time: '09:00:00', end_time: '17:00:00', required_count: 2 })];
    const overrides = [makeOverride({
      frame_id: 'f1',
      date: '2026-07-20',
      kind: 'modify',
      name: '早番(変更)',
      start_time: '10:00:00',
      end_time: '18:00:00',
      required_count: 3,
    })];
    const result = getEffectiveFramesForDate(frames, overrides, 's1', '2026-07-20');
    expect(result).toHaveLength(1);
    expect(result[0].isModified).toBe(true);
    expect(result[0].name).toBe('早番(変更)');
    expect(result[0].startTime).toBe('10:00:00');
    expect(result[0].endTime).toBe('18:00:00');
    expect(result[0].requiredCount).toBe(3);
  });

  it('単発枠は date 一致で合流する', () => {
    const frames = [makeFrame({ id: 'f2', day_of_week: null, date: '2026-07-20' })];
    const result = getEffectiveFramesForDate(frames, [], 's1', '2026-07-20');
    expect(result).toHaveLength(1);
    expect(result[0].isOneOff).toBe(true);
  });

  it('他店舗の枠は除外する', () => {
    const frames = [makeFrame({ id: 'f1', day_of_week: 1, store_id: 'other-store' })];
    const result = getEffectiveFramesForDate(frames, [], 's1', '2026-07-20');
    expect(result).toEqual([]);
  });

  it('sort_order → start_time → name の順でソートする', () => {
    const frames = [
      makeFrame({ id: 'f-b', day_of_week: 1, sort_order: 0, start_time: '13:00:00', end_time: '21:00:00', name: 'B' }),
      makeFrame({ id: 'f-a', day_of_week: 1, sort_order: 0, start_time: '09:00:00', end_time: '17:00:00', name: 'A' }),
      makeFrame({ id: 'f-c', day_of_week: 1, sort_order: -1, start_time: '15:00:00', end_time: '23:00:00', name: 'C' }),
    ];
    const result = getEffectiveFramesForDate(frames, [], 's1', '2026-07-20');
    expect(result.map((r) => r.frameId)).toEqual(['f-c', 'f-a', 'f-b']);
  });
});

describe('resolveUnassignAction', () => {
  it('tentative + preference_id あり(希望由来) → revert_preference', () => {
    expect(resolveUnassignAction({ status: 'tentative', preference_id: 'p1' })).toBe('revert_preference');
  });
  it('tentative + preference_id なし(手動追加) → unlink', () => {
    expect(resolveUnassignAction({ status: 'tentative', preference_id: null })).toBe('unlink');
  });
  it('approved + preference_id あり → unlink(本承認は差戻し対象外)', () => {
    expect(resolveUnassignAction({ status: 'approved', preference_id: 'p1' })).toBe('unlink');
  });
  it('modified + preference_id あり → unlink', () => {
    expect(resolveUnassignAction({ status: 'modified', preference_id: 'p1' })).toBe('unlink');
  });
  it('pending + preference_id あり → unlink(tentative でないため差戻し対象外)', () => {
    expect(resolveUnassignAction({ status: 'pending', preference_id: 'p1' })).toBe('unlink');
  });
});

describe('isCandidatePreferenceType', () => {
  it('preferred は候補', () => {
    expect(isCandidatePreferenceType('preferred')).toBe(true);
  });
  it('available は候補', () => {
    expect(isCandidatePreferenceType('available')).toBe(true);
  });
  it('unavailable は候補でない', () => {
    expect(isCandidatePreferenceType('unavailable')).toBe(false);
  });
});

describe('sortFrameCandidates', () => {
  function makePref(overrides: Partial<ShiftPreference>): ShiftPreference {
    return {
      id: 'p1',
      tenant_id: 't1',
      user_id: 'u1',
      date: '2026-07-20',
      preference_type: 'preferred',
      start_time: null,
      end_time: null,
      note: null,
      status: 'pending',
      created_at: '2026-01-01T00:00:00Z',
      store_id: 's1',
      ...overrides,
    };
  }

  it('preferred が available より先頭に来る', () => {
    const prefs = [
      makePref({ id: 'avail', preference_type: 'available' as ShiftPreference['preference_type'] }),
      makePref({ id: 'pref', preference_type: 'preferred' }),
    ];
    const result = sortFrameCandidates(prefs);
    expect(result.map((p) => p.id)).toEqual(['pref', 'avail']);
  });

  it('同種別内は start_time 昇順', () => {
    const prefs = [
      makePref({ id: 'late', start_time: '13:00:00' }),
      makePref({ id: 'early', start_time: '09:00:00' }),
    ];
    const result = sortFrameCandidates(prefs);
    expect(result.map((p) => p.id)).toEqual(['early', 'late']);
  });

  it('非破壊(元配列を変更しない)', () => {
    const prefs = [makePref({ id: 'a', start_time: '13:00:00' }), makePref({ id: 'b', start_time: '09:00:00' })];
    const original = [...prefs];
    sortFrameCandidates(prefs);
    expect(prefs).toEqual(original);
  });
});

describe('timeRangesOverlapOvernight', () => {
  it('(21-05 vs 22-02) = true', () => {
    expect(timeRangesOverlapOvernight('21:00', '05:00', '22:00', '02:00')).toBe(true);
  });
  it('(21-05 vs 04-06) = true', () => {
    expect(timeRangesOverlapOvernight('21:00', '05:00', '04:00', '06:00')).toBe(true);
  });
  it('(21-05 vs 10-12) = false', () => {
    expect(timeRangesOverlapOvernight('21:00', '05:00', '10:00', '12:00')).toBe(false);
  });
  it('(10-12 vs 11-13) = true', () => {
    expect(timeRangesOverlapOvernight('10:00', '12:00', '11:00', '13:00')).toBe(true);
  });
  it('"HH:MM:SS" 入力に対応する', () => {
    expect(timeRangesOverlapOvernight('21:00:00', '05:00:00', '22:00:00', '02:00:00')).toBe(true);
  });
});

function makeShiftForSnap(overrides: Partial<Shift>): Pick<Shift, 'start_time' | 'end_time' | 'frame_id' | 'status'> {
  return {
    start_time: '09:00:00',
    end_time: '17:00:00',
    frame_id: null,
    status: 'tentative',
    ...overrides,
  };
}

function makeEffFrame(overrides: Partial<EffectiveFrame>): Pick<EffectiveFrame, 'frameId' | 'startTime' | 'endTime'> {
  return {
    frameId: 'frame-1',
    startTime: '09:00:00',
    endTime: '17:00:00',
    ...overrides,
  };
}

describe('planShiftToFrameSnap', () => {
  it('(1) 時間差+未リンク → needsTimeUpdate/needsLink とも true', () => {
    const shift = makeShiftForSnap({ start_time: '10:00:00', end_time: '18:00:00', frame_id: null });
    const frame = makeEffFrame({ frameId: 'frame-1', startTime: '09:00:00', endTime: '17:00:00' });
    const plan = planShiftToFrameSnap(shift, frame);
    expect(plan.needsTimeUpdate).toBe(true);
    expect(plan.needsLink).toBe(true);
  });

  it('(2) "HH:MM:SS" vs "HH:MM" 混在で一致判定（正規化）→ link のみ', () => {
    const shift = makeShiftForSnap({ start_time: '09:00:00', end_time: '17:00:00', frame_id: null });
    const frame = makeEffFrame({ frameId: 'frame-1', startTime: '09:00', endTime: '17:00' });
    const plan = planShiftToFrameSnap(shift, frame);
    expect(plan.needsTimeUpdate).toBe(false);
    expect(plan.needsLink).toBe(true);
  });

  it('(3) 時間差+同枠リンク済 → time のみ', () => {
    const shift = makeShiftForSnap({ start_time: '10:00:00', end_time: '18:00:00', frame_id: 'frame-1' });
    const frame = makeEffFrame({ frameId: 'frame-1', startTime: '09:00:00', endTime: '17:00:00' });
    const plan = planShiftToFrameSnap(shift, frame);
    expect(plan.needsTimeUpdate).toBe(true);
    expect(plan.needsLink).toBe(false);
  });

  it('(4) 完全一致 → needsTimeUpdate/needsLink とも false（無音 no-op 対象）', () => {
    const shift = makeShiftForSnap({ start_time: '09:00:00', end_time: '17:00:00', frame_id: 'frame-1' });
    const frame = makeEffFrame({ frameId: 'frame-1', startTime: '09:00:00', endTime: '17:00:00' });
    const plan = planShiftToFrameSnap(shift, frame);
    expect(plan.needsTimeUpdate).toBe(false);
    expect(plan.needsLink).toBe(false);
  });

  it('(5) approved+時間差 → demotesApproved=true', () => {
    const shift = makeShiftForSnap({ status: 'approved', start_time: '10:00:00', end_time: '18:00:00' });
    const frame = makeEffFrame({ startTime: '09:00:00', endTime: '17:00:00' });
    const plan = planShiftToFrameSnap(shift, frame);
    expect(plan.demotesApproved).toBe(true);
  });

  it('(6) approved+一致 → demotesApproved=false', () => {
    const shift = makeShiftForSnap({ status: 'approved', start_time: '09:00:00', end_time: '17:00:00' });
    const frame = makeEffFrame({ startTime: '09:00:00', endTime: '17:00:00' });
    const plan = planShiftToFrameSnap(shift, frame);
    expect(plan.demotesApproved).toBe(false);
  });

  it('(7) tentative/modified+時間差 → demotesApproved=false', () => {
    const tentative = planShiftToFrameSnap(
      makeShiftForSnap({ status: 'tentative', start_time: '10:00:00', end_time: '18:00:00' }),
      makeEffFrame({ startTime: '09:00:00', endTime: '17:00:00' }),
    );
    expect(tentative.demotesApproved).toBe(false);
    const modified = planShiftToFrameSnap(
      makeShiftForSnap({ status: 'modified', start_time: '10:00:00', end_time: '18:00:00' }),
      makeEffFrame({ startTime: '09:00:00', endTime: '17:00:00' }),
    );
    expect(modified.demotesApproved).toBe(false);
  });

  it('oldStartTime/oldEndTime/newStartTime/newEndTime は HH:MM 正規化済みで返る', () => {
    const shift = makeShiftForSnap({ start_time: '10:00:00', end_time: '18:00:00' });
    const frame = makeEffFrame({ startTime: '09:00:00', endTime: '17:00:00' });
    const plan = planShiftToFrameSnap(shift, frame);
    expect(plan.oldStartTime).toBe('10:00');
    expect(plan.oldEndTime).toBe('18:00');
    expect(plan.newStartTime).toBe('09:00');
    expect(plan.newEndTime).toBe('17:00');
  });
});

describe('buildAssignShiftSuccessMessage', () => {
  it('旧→新時間が含まれる（時間変更あり）', () => {
    const plan = planShiftToFrameSnap(
      makeShiftForSnap({ start_time: '10:00:00', end_time: '18:00:00' }),
      makeEffFrame({ startTime: '09:00:00', endTime: '17:00:00' }),
    );
    const msg = buildAssignShiftSuccessMessage('山田', '早番', plan);
    expect(msg).toContain('10:00-18:00');
    expect(msg).toContain('09:00-17:00');
    expect(msg).toContain('山田さんを枠「早番」に割り当てました');
  });

  it('日跨ぎ枠で「翌」表記になる', () => {
    const plan = planShiftToFrameSnap(
      makeShiftForSnap({ start_time: '18:00:00', end_time: '23:00:00' }),
      makeEffFrame({ startTime: '21:00:00', endTime: '05:00:00' }),
    );
    const msg = buildAssignShiftSuccessMessage('山田', '深夜番', plan);
    expect(msg).toContain('21:00-翌05:00');
  });

  it('demotesApproved 時に降格文が付く', () => {
    const plan = planShiftToFrameSnap(
      makeShiftForSnap({ status: 'approved', start_time: '10:00:00', end_time: '18:00:00' }),
      makeEffFrame({ startTime: '09:00:00', endTime: '17:00:00' }),
    );
    const msg = buildAssignShiftSuccessMessage('山田', '早番', plan);
    expect(msg).toContain('本承認だったため仮承認に戻りました');
  });

  it('時間一致（リンクのみ）は降格文・時間併記なしのシンプル文言', () => {
    const plan = planShiftToFrameSnap(
      makeShiftForSnap({ start_time: '09:00:00', end_time: '17:00:00' }),
      makeEffFrame({ startTime: '09:00:00', endTime: '17:00:00' }),
    );
    const msg = buildAssignShiftSuccessMessage('山田', '早番', plan);
    expect(msg).toBe('山田さんを枠「早番」に割り当てました');
  });
});

describe('buildAssignShiftLinkFailureMessage', () => {
  it('link failure 文に errorMessage 全文が含まれる', () => {
    const plan = planShiftToFrameSnap(
      makeShiftForSnap({ start_time: '10:00:00', end_time: '18:00:00' }),
      makeEffFrame({ startTime: '09:00:00', endTime: '17:00:00' }),
    );
    const errorMessage = 'ネットワークエラー: 接続がタイムアウトしました（詳細コード: ETIMEDOUT-12345）';
    const msg = buildAssignShiftLinkFailureMessage(plan, errorMessage);
    expect(msg).toContain(errorMessage);
    expect(msg).toContain('10:00-18:00');
    expect(msg).toContain('09:00-17:00');
    expect(msg).toContain('枠への紐付けに失敗しました');
  });
});
