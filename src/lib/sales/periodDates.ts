import type { PeriodPreset } from './types';
import { getBusinessDate } from './businessDate';

/**
 * 期間プリセット → 日付列 (YYYY-MM-DD[]) を返す共通ロジック。
 *
 * Phase 2 で `useCustomerSegment` / `useMultiLocationSegment` に重複していたヘルパを集約。
 * 両 hook での実装は元々完全同一（diff 0）であり、本モジュールへ bit-by-bit コピーした。
 *
 * 仕様メモ:
 * - 入力 baseDate は JST の `YYYY-MM-DD` 文字列（Dashboard 経由）。
 * - 内部演算は UTC Date で実施し、JST における日付パーツへ最終整形する。
 * - period='week' は当該月内に限定（月跨ぎ排除）。
 * - 「今日」上限は営業日基準（getBusinessDate(startHour)）。営業開始時刻前は前営業日を
 *   上限とし、暦日が変わった瞬間に未経過の当日が範囲へ混入するのを防ぐ。
 * - 開始日が今日（営業日）より未来なら空配列、終了日が今日を超える場合は今日まで。
 */

export function getJSTDateParts(date: Date): { year: number; month: number; day: number } {
  const jstString = date.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = jstString.split('/').map(Number);
  return { year: parts[0], month: parts[1], day: parts[2] };
}

export function formatJSTDateString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 月曜起算 (Mon=0..Sun=6) で UTC Date の曜日オフセットを返す */
export function getMonOffset(date: Date): number {
  const d = date.getUTCDay(); // 0=Sun ... 6=Sat
  return (d + 6) % 7; // Mon=0, Sun=6
}

/** 当該年月の第1週月曜の UTC Date を返す（前月跨ぎあり） */
export function getFirstWeekMonday(year: number, month: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = getMonOffset(first);
  return new Date(Date.UTC(year, month - 1, 1 - offset));
}

/** 当該年月に含まれる「月曜起算週」の数 (week selector 上限用) */
export function getMonthWeekCount(year: number, month: number): number {
  const firstMon = getFirstWeekMonday(year, month);
  const lastDay = new Date(Date.UTC(year, month, 0));
  const diffDays = Math.floor((lastDay.getTime() - firstMon.getTime()) / 86400000);
  return Math.floor(diffDays / 7) + 1;
}

/**
 * メイン: PeriodPreset → 日付列 (YYYY-MM-DD[])
 *
 * @param period      'today' | 'week' | 'month' | 'quarter' | 'year'
 * @param baseDate    JST の YYYY-MM-DD 文字列
 * @param weekIndex   week のとき 1..N（省略時は baseDate から自動算出）
 * @param quarterIndex quarter のとき 1..4（省略時は baseDate の月から自動算出）
 */
export function calculatePeriodDates(
  period: PeriodPreset,
  baseDate: string,
  weekIndex?: number,
  quarterIndex?: number,
  startHour: number = 0,
): string[] {
  const [by, bm, bd] = baseDate.split('-').map(Number);

  // 「今日」上限は営業日基準。startHour=0 のとき暦日 (JST) と等価で従来挙動を維持する。
  const todayStr = getBusinessDate(startHour);
  const [todayY, todayM, todayD] = todayStr.split('-').map(Number);

  const dates: string[] = [];
  let startDateObj: Date;
  let endDateObj: Date;

  if (period === 'today') {
    startDateObj = new Date(Date.UTC(by, bm - 1, bd));
    endDateObj = new Date(Date.UTC(by, bm - 1, bd));
  } else if (period === 'week') {
    const firstMon = getFirstWeekMonday(by, bm);
    const baseDateUTC = Date.UTC(by, bm - 1, bd);

    let effectiveIndex: number;
    if (weekIndex !== undefined) {
      effectiveIndex = weekIndex;
    } else {
      const diff = baseDateUTC - firstMon.getTime();
      const days = diff / 86400000;
      effectiveIndex = Math.floor(days / 7) + 1;
      if (effectiveIndex < 1) effectiveIndex = 1;
    }

    startDateObj = new Date(firstMon.getTime() + 7 * (effectiveIndex - 1) * 86400000);
    endDateObj = new Date(firstMon.getTime() + (7 * (effectiveIndex - 1) + 6) * 86400000);
  } else if (period === 'quarter') {
    const effectiveQ =
      quarterIndex !== undefined
        ? quarterIndex
        : Math.floor((bm - 1) / 3) + 1; // 1-3->Q1, 4-6->Q2, 7-9->Q3, 10-12->Q4
    const startMonth = (effectiveQ - 1) * 3 + 1; // 1, 4, 7, 10
    const endMonth = startMonth + 2; // 3, 6, 9, 12
    startDateObj = new Date(Date.UTC(by, startMonth - 1, 1));
    endDateObj = new Date(Date.UTC(by, endMonth, 0)); // endMonth-1 month last day
  } else if (period === 'year') {
    startDateObj = new Date(Date.UTC(by, 0, 1)); // 1/1
    endDateObj = new Date(Date.UTC(by, 12, 0)); // 12/31
  } else {
    // month
    startDateObj = new Date(Date.UTC(by, bm - 1, 1));
    endDateObj = new Date(Date.UTC(by, bm, 0));
  }

  const startDateStr = formatJSTDateString(
    startDateObj.getUTCFullYear(),
    startDateObj.getUTCMonth() + 1,
    startDateObj.getUTCDate(),
  );
  if (startDateStr > todayStr) {
    return dates;
  }

  const endDateStr = formatJSTDateString(
    endDateObj.getUTCFullYear(),
    endDateObj.getUTCMonth() + 1,
    endDateObj.getUTCDate(),
  );
  if (endDateStr > todayStr) {
    endDateObj = new Date(Date.UTC(todayY, todayM - 1, todayD));
  }

  const current = new Date(startDateObj.getTime());
  while (current.getTime() <= endDateObj.getTime()) {
    dates.push(
      formatJSTDateString(
        current.getUTCFullYear(),
        current.getUTCMonth() + 1,
        current.getUTCDate(),
      ),
    );
    current.setUTCDate(current.getUTCDate() + 1);
  }

  if (period === 'week') {
    const prefix = `${by}-${String(bm).padStart(2, '0')}-`;
    return dates.filter(d => d.startsWith(prefix));
  }

  return dates;
}
