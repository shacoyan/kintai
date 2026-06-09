import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getBusinessDate } from './businessDate';

describe('getBusinessDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('JST 2026-05-21 05:00 + startHour=10 → 2026-05-20', () => {
    vi.setSystemTime(new Date('2026-05-20T20:00:00Z'));
    expect(getBusinessDate(10)).toBe('2026-05-20');
  });

  it('JST 2026-05-21 09:59 + startHour=10 → 2026-05-20', () => {
    vi.setSystemTime(new Date('2026-05-21T00:59:00Z'));
    expect(getBusinessDate(10)).toBe('2026-05-20');
  });

  it('JST 2026-05-21 10:00 + startHour=10 → 2026-05-21', () => {
    vi.setSystemTime(new Date('2026-05-21T01:00:00Z'));
    expect(getBusinessDate(10)).toBe('2026-05-21');
  });

  it('JST 2026-05-21 23:59 + startHour=10 → 2026-05-21', () => {
    vi.setSystemTime(new Date('2026-05-21T14:59:00Z'));
    expect(getBusinessDate(10)).toBe('2026-05-21');
  });

  it('JST 2026-05-22 00:00 + startHour=10 → 2026-05-21', () => {
    vi.setSystemTime(new Date('2026-05-21T15:00:00Z'));
    expect(getBusinessDate(10)).toBe('2026-05-21');
  });

  it('JST 2026-05-22 08:00 + startHour=10 → 2026-05-21', () => {
    vi.setSystemTime(new Date('2026-05-21T23:00:00Z'));
    expect(getBusinessDate(10)).toBe('2026-05-21');
  });

  it('startHour=0 → JST 暦日 (前日処理に入らない)', () => {
    vi.setSystemTime(new Date('2026-05-20T20:00:00Z'));
    expect(getBusinessDate(0)).toBe('2026-05-21');
  });

  it('startHour=13 互換: JST 2026-05-21 12:00 + startHour=13 → 2026-05-20', () => {
    vi.setSystemTime(new Date('2026-05-21T03:00:00Z'));
    expect(getBusinessDate(13)).toBe('2026-05-20');
  });

  it('月またぎ: JST 2026-06-01 08:00 + startHour=10 → 2026-05-31', () => {
    vi.setSystemTime(new Date('2026-05-31T23:00:00Z'));
    expect(getBusinessDate(10)).toBe('2026-05-31');
  });

  it('年またぎ: JST 2027-01-01 05:00 + startHour=10 → 2026-12-31', () => {
    vi.setSystemTime(new Date('2026-12-31T20:00:00Z'));
    expect(getBusinessDate(10)).toBe('2026-12-31');
  });
});
