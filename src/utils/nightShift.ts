import { differenceInMinutes } from 'date-fns';

/**
 * 2つの時間範囲の重複分数を計算する
 */
export function getOverlapMinutes(s1: Date, e1: Date, s2: Date, e2: Date): number {
  const overlapStart = s1 > s2 ? s1 : s2;
  const overlapEnd = e1 < e2 ? e1 : e2;
  if (overlapStart >= overlapEnd) return 0;
  return differenceInMinutes(overlapEnd, overlapStart);
}

/**
 * 指定時間帯が深夜帯（22:00〜翌5:00）に重なる分数を計算する
 */
export function getNightMinutesInRange(start: Date, end: Date): number {
  const totalMins = differenceInMinutes(end, start);
  if (totalMins <= 0) return 0;

  let nightMins = 0;
  // 日ごとに処理（最大2日程度なので問題ない）
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);

  while (current < end) {
    const dayStart = new Date(current);

    // 0:00-5:00
    const earlyNightStart = new Date(dayStart);
    earlyNightStart.setHours(0, 0, 0, 0);
    const earlyNightEnd = new Date(dayStart);
    earlyNightEnd.setHours(5, 0, 0, 0);

    // 22:00-24:00
    const lateNightStart = new Date(dayStart);
    lateNightStart.setHours(22, 0, 0, 0);
    const lateNightEnd = new Date(dayStart);
    lateNightEnd.setHours(24, 0, 0, 0);

    // 重複計算
    nightMins += getOverlapMinutes(start, end, earlyNightStart, earlyNightEnd);
    nightMins += getOverlapMinutes(start, end, lateNightStart, lateNightEnd);

    // 次の日へ
    current.setDate(current.getDate() + 1);
    current.setHours(0, 0, 0, 0);
  }

  return Math.min(nightMins, totalMins);
}

/**
 * TIME文字列(HH:MM)とdate文字列からDateオブジェクトを生成し、深夜分数を計算する
 * シフト用: start_time/end_time が TIME 型 (HH:MM) の場合に使用
 */
export function getNightMinutesForShift(date: string, startTime: string, endTime: string): number {
  const startParts = startTime.split(':').map(Number);
  const endParts = endTime.split(':').map(Number);

  const start = new Date(date);
  start.setHours(startParts[0], startParts[1], 0, 0);

  const end = new Date(date);
  end.setHours(endParts[0], endParts[1], 0, 0);

  // 日付をまたぐ場合
  if (end <= start) {
    end.setDate(end.getDate() + 1);
  }

  return getNightMinutesInRange(start, end);
}
