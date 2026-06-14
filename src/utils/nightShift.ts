import { differenceInMinutes } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

const TOKYO_TZ = 'Asia/Tokyo';

/**
 * 与えられた時刻（UTC 瞬間 = Date）を Asia/Tokyo の壁時計時刻に変換し、
 * その壁時計を「UTC フレームの Date」として返す。
 *
 * 以降の深夜帯計算は全て getUTCHours/setUTCHours など UTC ゲッタ/セッタで行うことで、
 * 実行ブラウザのローカル TZ に一切依存せず JST 壁時計のみで完結する。
 * これにより RPC 078/095 の `AT TIME ZONE 'Asia/Tokyo'`（壁時計化）と桁一致する。
 */
function toTokyoWallClockUtc(d: Date): Date {
  const iso = formatInTimeZone(d, TOKYO_TZ, "yyyy-MM-dd'T'HH:mm:ss.SSS");
  return new Date(`${iso}Z`);
}

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
 * 深夜帯計算のコア。引数は「JST 壁時計を UTC フレームで表現した Date」前提。
 * 22:00-翌5:00 バンドとの重複分を返す。UTC ゲッタ/セッタのみ使用しローカル TZ 非依存。
 */
function getNightMinutesFromWallClock(startJst: Date, endJst: Date): number {
  const totalMins = differenceInMinutes(endJst, startJst);
  if (totalMins <= 0) return 0;

  let nightMins = 0;
  const current = new Date(startJst);
  current.setUTCHours(0, 0, 0, 0);

  while (current < endJst) {
    const dayStart = new Date(current);

    // 0:00-5:00（JST 壁時計）
    const earlyNightStart = new Date(dayStart);
    earlyNightStart.setUTCHours(0, 0, 0, 0);
    const earlyNightEnd = new Date(dayStart);
    earlyNightEnd.setUTCHours(5, 0, 0, 0);

    // 22:00-24:00（JST 壁時計）
    const lateNightStart = new Date(dayStart);
    lateNightStart.setUTCHours(22, 0, 0, 0);
    const lateNightEnd = new Date(dayStart);
    lateNightEnd.setUTCHours(24, 0, 0, 0);

    nightMins += getOverlapMinutes(startJst, endJst, earlyNightStart, earlyNightEnd);
    nightMins += getOverlapMinutes(startJst, endJst, lateNightStart, lateNightEnd);

    current.setUTCDate(current.getUTCDate() + 1);
    current.setUTCHours(0, 0, 0, 0);
  }

  return Math.min(nightMins, totalMins);
}

/**
 * 深夜帯（22:00〜翌5:00・JST）に重なる分数を計算する。
 *
 * start/end は UTC 瞬間（Date・clock_in/out 等）。内部で Asia/Tokyo 壁時計へ
 * 明示変換してからバンドを当てるため、非 JST ブラウザでも RPC（078/095）と一致する。
 */
export function getNightMinutesInRange(start: Date, end: Date): number {
  return getNightMinutesFromWallClock(toTokyoWallClockUtc(start), toTokyoWallClockUtc(end));
}

/**
 * TIME文字列(HH:MM)とdate文字列からDateオブジェクトを生成し、深夜分数を計算する。
 * シフト用: start_time/end_time が TIME 型 (HH:MM) の場合に使用。
 *
 * 入力の date / HH:MM はそもそも JST 壁時計の表現なので、ローカル TZ 非依存に
 * UTC フレームの Date として直接組み立て、再変換せずコアへ渡す。
 */
export function getNightMinutesForShift(date: string, startTime: string, endTime: string): number {
  const startParts = startTime.split(':').map(Number);
  const endParts = endTime.split(':').map(Number);

  // date は 'yyyy-MM-dd'。UTC フレームの 0:00 を起点に壁時計成分を載せる。
  const start = new Date(`${date}T00:00:00.000Z`);
  start.setUTCHours(startParts[0], startParts[1], 0, 0);

  const end = new Date(`${date}T00:00:00.000Z`);
  end.setUTCHours(endParts[0], endParts[1], 0, 0);

  // 日付をまたぐ場合
  if (end <= start) {
    end.setUTCDate(end.getUTCDate() + 1);
  }

  return getNightMinutesFromWallClock(start, end);
}
