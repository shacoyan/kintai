import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { calculatePeriodDates, currentWeekIndex } from './periodDates';

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

/**
 * B4: currentWeekIndex が正本 calculatePeriodDates の week 省略時 effectiveIndex と
 * 全日一致すること（月初が火〜日の月でも 1 週ズレないこと）を担保する。
 */
describe('currentWeekIndex — 正本 week 省略時 effectiveIndex と一致', () => {
  // 各月の 1 日の曜日（月初が火〜日になる月を網羅）。
  // 2026: 1月=木,2月=日,3月=日,4月=水,5月=金,6月=月,7月=水,9月=火,11月=日。
  const months: Array<{ y: number; m: number }> = [
    { y: 2026, m: 1 }, // 木
    { y: 2026, m: 2 }, // 日
    { y: 2026, m: 4 }, // 水
    { y: 2026, m: 5 }, // 金
    { y: 2026, m: 6 }, // 月
    { y: 2026, m: 7 }, // 水
    { y: 2026, m: 9 }, // 火
    { y: 2026, m: 11 }, // 日
    { y: 2025, m: 3 }, // 土
  ];

  it('月の全日で currentWeekIndex(d) 指定 と week 省略 が同一日付列を返す', () => {
    for (const { y, m } of months) {
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      for (let d = 1; d <= lastDay; d++) {
        const base = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        // startHour=0（後方互換暦日）で today キャップに依存しないよう、
        // 過去年で十分に経過した日付列にする（2025/2026 とも現在より過去）。
        const omitted = calculatePeriodDates('week', base);
        const idx = currentWeekIndex(y, m, d);
        const explicit = calculatePeriodDates('week', base, idx);
        expect(explicit).toEqual(omitted);
      }
    }
  });

  it('月初が日曜の月（2026-02）: 正本は前月跨ぎ週起点。1 日(日)=週1、2 日(月)=週2、9 日=週3', () => {
    // 2026-02-01 は日曜。getFirstWeekMonday は Feb 1 を含む週の月曜 = 1/26 を起点にする。
    // よって翌日 2/2(月) は firstMon+7 で週2 となる（旧 SalesPage 独自定義では週1 だった差分）。
    expect(currentWeekIndex(2026, 2, 1)).toBe(1);
    expect(currentWeekIndex(2026, 2, 2)).toBe(2);
    expect(currentWeekIndex(2026, 2, 9)).toBe(3);
  });

  it('月初が月曜の月（2026-06）: 1 日が週1、8 日で週2', () => {
    expect(currentWeekIndex(2026, 6, 1)).toBe(1);
    expect(currentWeekIndex(2026, 6, 8)).toBe(2);
  });
});
