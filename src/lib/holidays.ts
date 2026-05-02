/** 日本の国民の祝日判定 (Loop 44) — japanese-holidays npm の薄ラッパ */
/** ShiftCalendar の月セル背景色適用に使用 (weekend.holiday-* token)。 */
/** 振替休日 (comp_holiday) は LeaveType 側の概念で別物 (本判定とは無関係)。 */
/** date-fns で生成されたローカル時刻 0:00 の Date を渡す前提 (UTC 補正なし)。 */

import * as jpHolidays from 'japanese-holidays';

/**
 * 指定日が日本の国民の祝日かどうかを返す。
 * @param date 判定対象 (date-fns ローカル時刻 0:00 を想定)
 * @returns 祝日なら true / そうでなければ false
 */
export function isJapaneseHoliday(date: Date): boolean {
  return jpHolidays.isHoliday(date) !== undefined;
}

/**
 * 指定日の祝日名を返す。祝日でなければ null。
 * @param date 判定対象 (date-fns ローカル時刻 0:00 を想定)
 * @returns 祝日名 (例: "憲法記念日") / 祝日でなければ null
 */
export function getJapaneseHolidayName(date: Date): string | null {
  return jpHolidays.isHoliday(date) ?? null;
}
