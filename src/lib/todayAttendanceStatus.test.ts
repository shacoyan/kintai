import { describe, it, expect } from 'vitest';
import { deriveTodayStatusLabel, deriveTodayStatusTone } from './todayAttendanceStatus';
import type { AttendanceRecord } from '../types';

const rec = (over: Partial<AttendanceRecord>): AttendanceRecord => ({
  id: 'r1',
  tenant_id: 't1',
  user_id: 'u1',
  date: '2026-06-10',
  clock_in: null,
  clock_out: null,
  total_work_minutes: null,
  note: null,
  created_at: '2026-06-10T00:00:00Z',
  store_id: 's1',
  ...over,
});

describe('deriveTodayStatusLabel', () => {
  // (a) 未出勤: 当日 clock_in なし
  it('未出勤: 当日レコードなし → 未出勤', () => {
    expect(deriveTodayStatusLabel('not_started', [])).toBe('未出勤');
  });

  // (b) 勤務中: in あり out なし
  it('勤務中: status working → 勤務中', () => {
    const records = [rec({ clock_in: '2026-06-10T09:00:00Z', clock_out: null })];
    expect(deriveTodayStatusLabel('working', records)).toBe('勤務中');
  });

  // (c) 休憩中
  it('休憩中: status on_break → 休憩中', () => {
    const records = [rec({ clock_in: '2026-06-10T09:00:00Z', clock_out: null })];
    expect(deriveTodayStatusLabel('on_break', records)).toBe('休憩中');
  });

  // (d) 退勤済: in も out もあり・未退勤レコードなし
  it('退勤済: 当日 clock_in/clock_out あり・status not_started → 退勤済', () => {
    const records = [rec({ clock_in: '2026-06-10T09:00:00Z', clock_out: '2026-06-10T18:00:00Z' })];
    expect(deriveTodayStatusLabel('not_started', records)).toBe('退勤済');
  });

  // (e) 退勤後再出勤: 2レコード目 in あり → 勤務中
  it('再出勤: 退勤済レコード + 新規 clock_in レコード・status working → 勤務中', () => {
    const records = [
      rec({ id: 'r1', clock_in: '2026-06-10T09:00:00Z', clock_out: '2026-06-10T12:00:00Z' }),
      rec({ id: 'r2', clock_in: '2026-06-10T13:00:00Z', clock_out: null }),
    ];
    expect(deriveTodayStatusLabel('working', records)).toBe('勤務中');
  });

  // 優先度確認: 休憩中は退勤済レコードがあっても休憩中が優先
  it('優先度: on_break は退勤済レコードがあっても休憩中', () => {
    const records = [rec({ clock_in: '2026-06-10T09:00:00Z', clock_out: '2026-06-10T18:00:00Z' })];
    expect(deriveTodayStatusLabel('on_break', records)).toBe('休憩中');
  });
});

describe('deriveTodayStatusTone', () => {
  it('on_break → warning', () => {
    expect(deriveTodayStatusTone('on_break')).toBe('warning');
  });
  it('working → success', () => {
    expect(deriveTodayStatusTone('working')).toBe('success');
  });
  it('not_started → neutral（退勤済・未出勤とも neutral）', () => {
    expect(deriveTodayStatusTone('not_started')).toBe('neutral');
  });
});
