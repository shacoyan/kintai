import type { AttendanceRecord } from '../types';
import type { BadgeTone } from '../components/ui/Badge';

/**
 * 「本日の記録」カードのステータスバッジ表示を導出する純関数。
 *
 * useAttendance フックの status は 3 値（'not_started' | 'working' | 'on_break'）で
 * 退勤済みを返さない（退勤すると activeRecord が null になり 'not_started' に戻る）。
 * そのためカード表示専用に、当日レコードから「退勤済」を 4 値目として導出する。
 *
 * 判定順（優先度）:
 *   1. 休憩中: status === 'on_break'
 *   2. 勤務中: status === 'working'（日跨ぎ勤務も working の一種としてここに含む）
 *   3. 退勤済: 当日レコードに clock_in/clock_out 両方を持つものが 1 件以上ある
 *   4. 未出勤: それ以外（当日 clock_in が一切ない）
 *
 * フック・ClockButton・BreakButton には一切影響しない（カード表示専用）。
 */
export function deriveTodayStatusLabel(
  status: 'not_started' | 'working' | 'on_break',
  todayOnlyRecords: AttendanceRecord[],
): string {
  if (status === 'on_break') return '休憩中';
  if (status === 'working') return '勤務中';
  if (todayOnlyRecords.some((r) => r.clock_in && r.clock_out)) return '退勤済';
  return '未出勤';
}

export function deriveTodayStatusTone(
  status: 'not_started' | 'working' | 'on_break',
): BadgeTone {
  if (status === 'on_break') return 'warning';
  if (status === 'working') return 'success';
  return 'neutral';
}
