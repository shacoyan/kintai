// src/utils/formatTimeRange.ts

/**
 * 時刻範囲を翌日跨ぎを含めてフォーマットする。
 * 21:00-05:00 のように end <= start のケースは「翌HH:MM」表記。
 *
 * @param start "HH:MM" or "HH:MM:SS"
 * @param end   "HH:MM" or "HH:MM:SS"
 * @param opts.separator デフォ '-'。和文では '〜' などを指定。
 * @param opts.compactNextDay true なら時刻の hour を 0 埋めしない（例: 翌5:00）
 *
 * @example
 *   formatTimeRange('09:00', '18:00')                                  // '09:00-18:00'
 *   formatTimeRange('21:00', '05:00')                                  // '21:00-翌05:00'
 *   formatTimeRange('21:00', '05:00', { compactNextDay: true })        // '21:00-翌5:00'
 *   formatTimeRange('21:00', '05:00', { separator: '〜' })             // '21:00〜翌05:00'
 *   formatTimeRange('21:00:00', '05:00:00', { separator: ' 〜 ' })     // '21:00 〜 翌05:00'
 */
export function formatTimeRange(
  start: string,
  end: string,
  opts?: { separator?: string; compactNextDay?: boolean }
): string {
  const sep = opts?.separator ?? '-';
  const s = start.slice(0, 5);
  const e = end.slice(0, 5);
  if (e <= s) {
    const nextDayPrefix = opts?.compactNextDay
      ? `翌${parseInt(e.slice(0, 2), 10)}:${e.slice(3, 5)}`
      : `翌${e}`;
    return `${s}${sep}${nextDayPrefix}`;
  }
  return `${s}${sep}${e}`;
}

/**
 * aria-label 用に翌日跨ぎを和文で読み上げ可能にフォーマットする。
 * @example
 *   formatTimeRangeA11y('21:00', '05:00') // '21:00 から 翌日 05:00 まで'
 *   formatTimeRangeA11y('09:00', '18:00') // '09:00 から 18:00 まで'
 */
export function formatTimeRangeA11y(start: string, end: string): string {
  const s = start.slice(0, 5);
  const e = end.slice(0, 5);
  return e <= s ? `${s} から 翌日 ${e} まで` : `${s} から ${e} まで`;
}
