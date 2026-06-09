import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { calculatePeriodDates } from './periodDates';

/**
 * 「今日」上限の営業日基準キャップ回帰テスト。
 *
 * バグ: 暦日が午前0時に変わった瞬間、営業開始(startHour)前で売上0の当日が
 * 週/月/四半期/年の集計範囲へ混入し、経過日数分母や1日平均を薄めていた。
 * 修正: 上限を getBusinessDate(startHour) 由来の営業日に切替。
 */
describe('calculatePeriodDates — 営業日基準の今日キャップ', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('開店前 (JST 2026-06-06 02:00 / startHour=11): 月範囲は前営業日 6/5 で止まり当日 6/6 を含めない', () => {
    vi.setSystemTime(new Date('2026-06-05T17:00:00Z')); // JST 2026-06-06 02:00
    const dates = calculatePeriodDates('month', '2026-06-05', undefined, undefined, 11);
    expect(dates[dates.length - 1]).toBe('2026-06-05');
    expect(dates).not.toContain('2026-06-06');
  });

  it('開店後 (JST 2026-06-06 12:00 / startHour=11): 月範囲は当日 6/6 を含む', () => {
    vi.setSystemTime(new Date('2026-06-06T03:00:00Z')); // JST 2026-06-06 12:00
    const dates = calculatePeriodDates('month', '2026-06-06', undefined, undefined, 11);
    expect(dates[dates.length - 1]).toBe('2026-06-06');
    expect(dates).toContain('2026-06-06');
  });

  it('開店前 today: 前営業日 6/5 を baseDate にすると当日扱いで返る', () => {
    vi.setSystemTime(new Date('2026-06-05T17:00:00Z')); // JST 2026-06-06 02:00
    const dates = calculatePeriodDates('today', '2026-06-05', undefined, undefined, 11);
    expect(dates).toEqual(['2026-06-05']);
  });

  it('開店前 today: 未経過の暦日 6/6 を baseDate にすると空配列（未来扱いで除外）', () => {
    vi.setSystemTime(new Date('2026-06-05T17:00:00Z')); // JST 2026-06-06 02:00
    const dates = calculatePeriodDates('today', '2026-06-06', undefined, undefined, 11);
    expect(dates).toEqual([]);
  });

  it('後方互換 startHour 省略 (=0): 暦日基準で当日を含む（従来挙動）', () => {
    vi.setSystemTime(new Date('2026-06-05T17:00:00Z')); // JST 2026-06-06 02:00
    const dates = calculatePeriodDates('month', '2026-06-06');
    expect(dates[dates.length - 1]).toBe('2026-06-06');
    expect(dates).toContain('2026-06-06');
  });
});
