import { describe, it, expect } from 'vitest';
import { parseTimeRange } from './_shared.js';

/**
 * Wave4-P1 P0 回帰テスト。
 *
 * SalesPage.tsx は当日ライブ売上の取得で startHour=STORE_START_HOUR(11) /
 * endHour=(11+23)%24=10 を api に渡す。parseTimeRange は endHour < startHour の
 * ときのみ翌日扱いになるため、endHour を STORE_START_HOUR と同値(11)にすると
 * 当日 11:00〜11:59 の 59 分しか取得できないバグがあった。
 * フル営業日 (11:00〜翌10:59) になることをここで固定し、P0 の再発を防ぐ。
 */
describe('parseTimeRange — SalesPage が渡す営業日フルレンジ', () => {
  const STORE_START_HOUR = 11;
  const SALES_END_HOUR = (STORE_START_HOUR + 23) % 24; // = 10

  it('endHour=(11+23)%24=10 は翌日 10:59:59 までのフル営業日になる', () => {
    const range = parseTimeRange({
      date: '2026-06-10',
      start_hour: String(STORE_START_HOUR),
      end_hour: String(SALES_END_HOUR),
    });
    expect(range.beginTimeJST).toBe('2026-06-10T11:00:00+09:00');
    // 翌日 (06-11) の 10:59 まで → フル 24h 営業日
    expect(range.endTimeJST).toBe('2026-06-11T10:59:59.999+09:00');
  });

  it('回帰: endHour=startHour(11) だと当日 11:59 までの 59 分しか取れない（旧バグ挙動の固定）', () => {
    const range = parseTimeRange({
      date: '2026-06-10',
      start_hour: String(STORE_START_HOUR),
      end_hour: String(STORE_START_HOUR),
    });
    expect(range.beginTimeJST).toBe('2026-06-10T11:00:00+09:00');
    // 同日のまま 11:59 → これが P0 の症状。現行 SalesPage はこの値を渡さないこと。
    expect(range.endTimeJST).toBe('2026-06-10T11:59:59.999+09:00');
  });

  it('月跨ぎ: 月末日でも翌日へ正しく繰り上がる', () => {
    const range = parseTimeRange({
      date: '2026-06-30',
      start_hour: String(STORE_START_HOUR),
      end_hour: String(SALES_END_HOUR),
    });
    expect(range.endTimeJST).toBe('2026-07-01T10:59:59.999+09:00');
  });

  it('SALES_END_HOUR は 10 であること（式の意図を固定）', () => {
    expect(SALES_END_HOUR).toBe(10);
  });
});
