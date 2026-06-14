import { describe, it, expect } from 'vitest';
import {
  getOverlapMinutes,
  getNightMinutesInRange,
  getNightMinutesForShift,
} from './nightShift';

// JST(+09:00) の壁時計を UTC 瞬間として組み立てるヘルパ。
// clock_in/out 相当（DB の timestamptz を parseISO した Date）を模す。
function jst(iso: string): Date {
  return new Date(`${iso}+09:00`);
}

describe('getOverlapMinutes', () => {
  it('完全包含', () => {
    const a = new Date('2026-06-01T00:00:00Z');
    const b = new Date('2026-06-01T02:00:00Z');
    const c = new Date('2026-06-01T00:30:00Z');
    const d = new Date('2026-06-01T01:30:00Z');
    expect(getOverlapMinutes(a, b, c, d)).toBe(60);
  });
  it('重複なし', () => {
    const a = new Date('2026-06-01T00:00:00Z');
    const b = new Date('2026-06-01T01:00:00Z');
    const c = new Date('2026-06-01T02:00:00Z');
    const d = new Date('2026-06-01T03:00:00Z');
    expect(getOverlapMinutes(a, b, c, d)).toBe(0);
  });
  it('境界接触は0', () => {
    const a = new Date('2026-06-01T00:00:00Z');
    const b = new Date('2026-06-01T01:00:00Z');
    const c = new Date('2026-06-01T01:00:00Z');
    const d = new Date('2026-06-01T02:00:00Z');
    expect(getOverlapMinutes(a, b, c, d)).toBe(0);
  });
});

describe('getNightMinutesInRange (JST 22:00-翌5:00)', () => {
  it('完全に昼間(JST 10:00-18:00)→深夜0', () => {
    expect(getNightMinutesInRange(jst('2026-06-01T10:00:00'), jst('2026-06-01T18:00:00'))).toBe(0);
  });

  it('22:00端: 21:00-22:00 は深夜0（22:00 ちょうどは含まない側）', () => {
    expect(getNightMinutesInRange(jst('2026-06-01T21:00:00'), jst('2026-06-01T22:00:00'))).toBe(0);
  });

  it('22:00端: 22:00-23:00 は深夜60', () => {
    expect(getNightMinutesInRange(jst('2026-06-01T22:00:00'), jst('2026-06-01T23:00:00'))).toBe(60);
  });

  it('05:00端: 04:00-05:00 は深夜60', () => {
    expect(getNightMinutesInRange(jst('2026-06-01T04:00:00'), jst('2026-06-01T05:00:00'))).toBe(60);
  });

  it('05:00端: 05:00-06:00 は深夜0', () => {
    expect(getNightMinutesInRange(jst('2026-06-01T05:00:00'), jst('2026-06-01T06:00:00'))).toBe(0);
  });

  it('日跨ぎ: 22:00-翌05:00 は全部深夜=420分', () => {
    expect(getNightMinutesInRange(jst('2026-06-01T22:00:00'), jst('2026-06-02T05:00:00'))).toBe(420);
  });

  it('日跨ぎ混在: 20:00-翌02:00 → 深夜240(22-02)・通常120', () => {
    const night = getNightMinutesInRange(jst('2026-06-01T20:00:00'), jst('2026-06-02T02:00:00'));
    expect(night).toBe(240);
  });

  it('深夜帯をまたぐ長時間: 23:00-翌06:00 → 23-05=360', () => {
    expect(getNightMinutesInRange(jst('2026-06-01T23:00:00'), jst('2026-06-02T06:00:00'))).toBe(360);
  });

  it('非JSTブラウザ非依存: UTC 13:00(=JST22:00)-UTC14:00 は深夜60', () => {
    // UTC 表記で渡しても瞬間が同じなら結果は同一（TZ 非依存）。
    expect(getNightMinutesInRange(new Date('2026-06-01T13:00:00Z'), new Date('2026-06-01T14:00:00Z'))).toBe(60);
  });

  it('逆転/同時刻は0', () => {
    expect(getNightMinutesInRange(jst('2026-06-01T22:00:00'), jst('2026-06-01T22:00:00'))).toBe(0);
  });
});

describe('getNightMinutesForShift (HH:MM・JST 壁時計)', () => {
  it('昼間シフト 10:00-18:00 → 0', () => {
    expect(getNightMinutesForShift('2026-06-01', '10:00', '18:00')).toBe(0);
  });

  it('夜シフト 18:00-24:00 → 22-24 の120', () => {
    expect(getNightMinutesForShift('2026-06-01', '18:00', '24:00')).toBe(120);
  });

  it('日跨ぎ end<=start: 22:00-05:00 → 全部深夜420', () => {
    expect(getNightMinutesForShift('2026-06-01', '22:00', '05:00')).toBe(420);
  });

  it('日跨ぎ 20:00-02:00 → 深夜240', () => {
    expect(getNightMinutesForShift('2026-06-01', '20:00', '02:00')).toBe(240);
  });

  it('早朝 03:00-09:00 → 03-05 の120', () => {
    expect(getNightMinutesForShift('2026-06-01', '03:00', '09:00')).toBe(120);
  });

  it('22:00端 21:00-22:00 → 0', () => {
    expect(getNightMinutesForShift('2026-06-01', '21:00', '22:00')).toBe(0);
  });
});
