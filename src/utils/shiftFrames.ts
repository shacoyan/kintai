// src/utils/shiftFrames.ts
// シフト枠管理（shift_frames / shift_frame_overrides）の純関数群。
// React / DOM 非依存。shiftSlot.ts の流儀（純関数・色は持たない・tone 付き判定型）を踏襲。
//   設計書: .company/engineering/docs/2026-07-20-kintai-shift-frames.md §5/§7.2

import type { Shift, ShiftFrame, ShiftFrameOverride } from '../types';

// ============================================================
// 曜日ラベル（表示順=月→日。value は 0=日 の getDay 値・EXTRACT(DOW) 互換）
// ============================================================

export const FRAME_DAY_LABELS: { value: number; label: string }[] = [
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
  { value: 0, label: '日' },
];

/** "YYYY-MM-DD" の曜日を返す（0=日..6=土。JS Date.getDay() / Postgres EXTRACT(DOW) 互換）。 */
export function getDayOfWeek(date: string): number {
  // new Date('YYYY-MM-DD') は UTC 0時解釈されローカルタイムゾーンでずれ得るため、
  // 年月日を明示的に分解してローカル Date を構築する（date-fns の parseISO 相当の安全策）。
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).getDay();
}

// ============================================================
// 実効枠（あるdateのある店舗）
// ============================================================

export interface EffectiveFrame {
  frameId: string;
  storeId: string;
  date: string;
  name: string;
  startTime: string;
  endTime: string;
  requiredCount: number;
  isOneOff: boolean;
  isModified: boolean;
  sortOrder: number;
}

/**
 * ある店舗・ある日の実効枠一覧を導出する。
 *  - 毎週テンプレ（is_active、day_of_week 一致、cancel override 除外、
 *    modify override は丸ごと差替）
 *  - 単発枠（is_active、date 一致）
 *  - ソート: sort_order → start_time → name
 */
export function getEffectiveFramesForDate(
  frames: ShiftFrame[],
  overrides: ShiftFrameOverride[],
  storeId: string,
  date: string,
): EffectiveFrame[] {
  const dow = getDayOfWeek(date);
  const overrideByFrameId = new Map<string, ShiftFrameOverride>();
  for (const o of overrides) {
    if (o.date === date) overrideByFrameId.set(o.frame_id, o);
  }

  const result: EffectiveFrame[] = [];

  for (const f of frames) {
    if (!f.is_active) continue;
    if (f.store_id !== storeId) continue;

    if (f.day_of_week !== null) {
      // 毎週テンプレ
      if (f.day_of_week !== dow) continue;
      const override = overrideByFrameId.get(f.id);
      if (override?.kind === 'cancel') continue;
      if (override?.kind === 'modify') {
        result.push({
          frameId: f.id,
          storeId: f.store_id,
          date,
          name: override.name!,
          startTime: override.start_time!,
          endTime: override.end_time!,
          requiredCount: override.required_count!,
          isOneOff: false,
          isModified: true,
          sortOrder: f.sort_order,
        });
      } else {
        result.push({
          frameId: f.id,
          storeId: f.store_id,
          date,
          name: f.name,
          startTime: f.start_time,
          endTime: f.end_time,
          requiredCount: f.required_count,
          isOneOff: false,
          isModified: false,
          sortOrder: f.sort_order,
        });
      }
    } else if (f.date === date) {
      // 単発枠
      result.push({
        frameId: f.id,
        storeId: f.store_id,
        date,
        name: f.name,
        startTime: f.start_time,
        endTime: f.end_time,
        requiredCount: f.required_count,
        isOneOff: true,
        isModified: false,
        sortOrder: f.sort_order,
      });
    }
  }

  result.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  return result;
}

// ============================================================
// 充足カウント・判定
// ============================================================

/** 「配置として数える」status 集合（ShiftDayCoverageHeader と同一）。 */
const ASSIGNED_STATUSES = new Set<Shift['status']>(['tentative', 'approved', 'modified']);

/**
 * 枠 frameId・対象日 date に割り当てられているシフト数を数える。
 * status は tentative/approved/modified のみ（pending/cancelled/rejected は数えない）。
 */
export function countFrameAssignments(
  shifts: Pick<Shift, 'frame_id' | 'date' | 'status'>[],
  frameId: string,
  date: string,
): number {
  let count = 0;
  for (const s of shifts) {
    if (s.frame_id === frameId && s.date === date && ASSIGNED_STATUSES.has(s.status)) {
      count += 1;
    }
  }
  return count;
}

export type FrameFulfillmentLevel = 'unfilled' | 'shortage' | 'met' | 'excess';

export interface FrameFulfillmentVerdict {
  level: FrameFulfillmentLevel;
  label: '未配置' | '不足' | '充足' | '超過';
  tone: 'danger' | 'warning' | 'success' | 'info';
}

/**
 * 充足判定（人数の整数のみ。率・割合・パーセントは一切扱わない）。
 *   assigned = 0            → unfilled 「未配置」danger
 *   0 < assigned < required → shortage 「不足」  warning
 *   assigned = required     → met      「充足」  success
 *   assigned > required     → excess   「超過」  info
 */
export function judgeFrameFulfillment(assigned: number, required: number): FrameFulfillmentVerdict {
  if (assigned === 0) {
    return { level: 'unfilled', label: '未配置', tone: 'danger' };
  }
  if (assigned < required) {
    return { level: 'shortage', label: '不足', tone: 'warning' };
  }
  if (assigned === required) {
    return { level: 'met', label: '充足', tone: 'success' };
  }
  return { level: 'excess', label: '超過', tone: 'info' };
}

// ============================================================
// 時刻レンジの重複判定（日跨ぎ対応）
// ============================================================

/** "HH:MM" / "HH:MM:SS" → 分（0..1439）。パース不能時は 0。 */
function toMinutes(t: string): number {
  const s = t.slice(0, 5);
  const [hh, mm] = s.split(':').map(Number);
  const h = Number.isFinite(hh) ? hh : 0;
  const m = Number.isFinite(mm) ? mm : 0;
  return h * 60 + m;
}

/**
 * 2 つの時刻レンジが重複するか（日跨ぎ対応）。
 * end <= start の枠は日跨ぎとみなし終了時刻に +24h（分ベース）して比較する。
 * "HH:MM" / "HH:MM:SS" 両対応（slice(0,5) 方式）。
 */
export function timeRangesOverlapOvernight(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  const DAY = 24 * 60;
  const aS = toMinutes(aStart);
  let aE = toMinutes(aEnd);
  if (aE <= aS) aE += DAY;
  const bS = toMinutes(bStart);
  let bE = toMinutes(bEnd);
  if (bE <= bS) bE += DAY;

  // 24h 円環上の比較を吸収するため、b 側を -DAY / 0 / +DAY で 3 パターン試す。
  for (const offset of [-DAY, 0, DAY]) {
    const shiftedStart = bS + offset;
    const shiftedEnd = bE + offset;
    if (aS < shiftedEnd && shiftedStart < aE) return true;
  }
  return false;
}
