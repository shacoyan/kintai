// src/utils/timeRange.ts
import { messages } from '../lib/messages';

/**
 * シフト時刻範囲のバリデーション。
 * 深夜跨ぎ（end < start）は許容。同時刻（start === end）のみ NG。
 *
 * @param start "HH:MM" 形式（フォーム state 想定）
 * @param end   "HH:MM" 形式
 *
 * @example
 *   validateShiftTimeRange('09:00', '18:00') // { ok: true }
 *   validateShiftTimeRange('09:00', '09:00') // { ok: false, message: '開始と終了の時刻が同じです。…' }
 *   validateShiftTimeRange('21:00', '05:00') // { ok: true }  ← 翌日跨ぎとして許容
 *   validateShiftTimeRange('23:45', '00:00') // { ok: true }  ← 跨ぎ境界（15min）
 *   validateShiftTimeRange('9:00',  '18:00') // { ok: false, message: '時刻形式が不正です' }
 */
export function validateShiftTimeRange(
  start: string,
  end: string,
): { ok: true } | { ok: false; message: string } {
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
    return { ok: false, message: '時刻形式が不正です' };
  }
  if (start === end) {
    return { ok: false, message: messages.validation.timeIdentical };
  }
  // start > end は翌日跨ぎとして許容（24h 内）
  return { ok: true };
}
