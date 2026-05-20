import { startOfMonth, addMonths } from 'date-fns';

/**
 * 15日境界によるシフト初期表示月の判定ヘルパー。
 * 月の15日以前なら当月、16日以降なら翌月の月初を返す。
 *
 * @param now 基準日時。省略時は現在日時。
 *
 * @example
 *   getInitialShiftMonth(new Date('2024-01-10')) // 2024-01-01
 *   getInitialShiftMonth(new Date('2024-01-20')) // 2024-02-01
 */
export function getInitialShiftMonth(now: Date = new Date()): Date {
  if (now.getDate() <= 15) {
    return startOfMonth(now);
  }
  return startOfMonth(addMonths(now, 1));
}
