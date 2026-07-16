// shiftSlot.ts — スマホシフト画面リデザイン用 純関数ユーティリティ（§C）
// React / DOM 非依存。色は持たない純データ層（色は呼び出し側のローカル const で管理）。

import type { Shift } from '../types';
import type { RoleColorKey } from './getRoleColor';

/** 日本語の姓を五十音順で比較するための collator（UTF-16 コードポイント順を避ける）。 */
const collator = new Intl.Collator('ja');

// ============================================================
// C-1. 早 / 中 / 遅 区分
// ============================================================

export type ShiftSlot = 'early' | 'mid' | 'late';

/** スロット境界（設計確定。実態と合わない場合はここ 1 箇所で調整）。 */
export const SLOT_BOUNDARY_EARLY = 15; // hour < 15 → early
export const SLOT_BOUNDARY_LATE = 18; // hour >= 18 → late

/**
 * start_time の開始 hour を取り出す内部ヘルパ。
 * "HH:mm" / "HH:mm:ss" の双方に対応。パース不能なら 0 を返す。
 */
function parseStartHour(startTime: string | undefined | null): number {
  if (!startTime) return 0;
  const head = String(startTime).trim().split(':')[0];
  const h = parseInt(head, 10);
  return Number.isFinite(h) ? h : 0;
}

/**
 * 開始時刻 hour から早/中/遅を導出。境界（設計確定）:
 *   hour < 15        → 'early'(早番)
 *   15 <= hour < 18  → 'mid'  (中番)
 *   hour >= 18       → 'late' (遅番)
 */
export function getShiftSlot(startTime: string): ShiftSlot {
  const hour = parseStartHour(startTime);
  if (hour < SLOT_BOUNDARY_EARLY) return 'early';
  if (hour < SLOT_BOUNDARY_LATE) return 'mid';
  return 'late';
}

// ============================================================
// C-2. 短ラベル / 長ラベル
// ============================================================

export const SHIFT_SLOT_LABEL: Record<ShiftSlot, string> = {
  early: '早',
  mid: '中',
  late: '遅',
};

export const SHIFT_SLOT_LABEL_LONG: Record<ShiftSlot, string> = {
  early: '早番',
  mid: '中番',
  late: '遅番',
};

// ============================================================
// C-3. カバレッジ集計（早 / 中 / 遅 人数）
// ============================================================

export interface SlotCoverage {
  early: number;
  mid: number;
  late: number;
  total: number;
}

/**
 * その日の確定シフト配列からスロット別人数を集計。
 * 引数 shifts は「対象日・フィルタ通過済み」を渡す前提（純関数）。
 */
export function computeSlotCoverage(shifts: Pick<Shift, 'start_time'>[]): SlotCoverage {
  const coverage: SlotCoverage = { early: 0, mid: 0, late: 0, total: 0 };
  if (!shifts || shifts.length === 0) return coverage;
  for (const s of shifts) {
    const slot = getShiftSlot(s.start_time);
    coverage[slot] += 1;
    coverage.total += 1;
  }
  return coverage;
}

// ============================================================
// C-4. 適正度判定（未配置 / 人手薄 / 適正 / 手厚い）
// ============================================================

export type StaffingLevel = 'unstaffed' | 'thin' | 'adequate' | 'rich';

export interface StaffingVerdict {
  level: StaffingLevel;
  label: string; // '未配置' | '人手薄' | '適正' | '手厚い'
  tone: 'danger' | 'warning' | 'success' | 'info';
}

/** 適正度の閾値（仮置き。運用と乖離あれば 1 箇所で調整）。 */
export const STAFF_THIN_MAX = 1; // total === 1 → thin
export const STAFF_ADEQUATE_MAX = 4; // 2 <= total <= 4 → adequate（5 以上 → rich）

/**
 * 当日確定人数（total）から適正度を判定。
 *   total === 0        → unstaffed (未配置 / danger)
 *   total === 1        → thin      (人手薄 / warning)
 *   2 <= total <= 4    → adequate  (適正 / success)
 *   total >= 5         → rich      (手厚い / info)
 */
export function judgeStaffing(total: number): StaffingVerdict {
  if (total <= 0) {
    return { level: 'unstaffed', label: '未配置', tone: 'danger' };
  }
  if (total <= STAFF_THIN_MAX) {
    return { level: 'thin', label: '人手薄', tone: 'warning' };
  }
  if (total <= STAFF_ADEQUATE_MAX) {
    return { level: 'adequate', label: '適正', tone: 'success' };
  }
  return { level: 'rich', label: '手厚い', tone: 'info' };
}

// ============================================================
// C-5. 早 / 遅 ゼロ警告（任意）
// ============================================================

/** スロット数値が 0 のとき warning 色にする判定。 */
export function isSlotWarning(n: number): boolean {
  return n === 0;
}

// ============================================================
// C-6. 優先表示ソート（§B-7）
// ============================================================

export interface DayChipItem {
  kind: 'shift' | 'preference';
  userId: string;
  startTime: string; // ソート用。preference で未指定なら '99:99' 等で末尾送り。表示は formatChipTimeRange がセンチネルを吸収。
  endTime: string | null; // 表示専用。shift.end_time(非null)/preference.end_time(null可)。ソートには未使用。
  lastName: string;
  roleType: RoleColorKey;
  status: string; // shift.status or 'pending'
  isMine: boolean;
  isManager: boolean;
}

/**
 * 表示優先順でソートし、上限 N 件 + overflow 件数を返す。
 * 優先: isMine → isManager → startTime 昇順 → lastName。
 * 安定ソート（同条件は入力順を保持）。
 */
export function prioritizeDayItems(
  items: DayChipItem[],
  limit: number
): { visible: DayChipItem[]; overflow: number } {
  if (!items || items.length === 0) {
    return { visible: [], overflow: 0 };
  }

  // 安定ソートを保証するため index を併用。
  const indexed = items.map((item, index) => ({ item, index }));
  indexed.sort((a, b) => {
    // isMine（true が先）
    if (a.item.isMine !== b.item.isMine) return a.item.isMine ? -1 : 1;
    // isManager（true が先）
    if (a.item.isManager !== b.item.isManager) return a.item.isManager ? -1 : 1;
    // startTime 昇順
    if (a.item.startTime !== b.item.startTime) {
      return a.item.startTime < b.item.startTime ? -1 : 1;
    }
    // lastName 昇順（五十音順。UTF-16 コードポイント順だと漢字が正しく並ばない）
    const nameCmp = collator.compare(a.item.lastName, b.item.lastName);
    if (nameCmp !== 0) return nameCmp;
    // 同条件 → 入力順維持（安定ソート）
    return a.index - b.index;
  });

  const sorted = indexed.map((x) => x.item);
  const safeLimit = limit < 0 ? 0 : limit;
  const visible = sorted.slice(0, safeLimit);
  const overflow = Math.max(0, sorted.length - safeLimit);
  return { visible, overflow };
}

// ============================================================
// C-7. 開始時刻 2 桁 + 姓抽出
// ============================================================

/** "18:00" / "18:00:00" → "18"。"9:30" → "09"（2 桁固定, tnum 前提）。 */
export function formatStartHour2(startTime: string): string {
  const hour = parseStartHour(startTime);
  return String(hour).padStart(2, '0');
}

/**
 * display_name から「姓」を抽出。
 *  - スペース（半角/全角）区切りがあれば先頭トークン = 姓（「高橋 太郎」→「高橋」）。
 *  - 区切り無しの日本語名は先頭 2 文字を姓とみなす（「高橋太郎」→「高橋」, 「林大」→「林大」）。
 *  - 英字名（"Taro Tanaka"）はスペース区切りで先頭トークン。
 *  - 空 / undefined → '—'。
 */
export function extractLastName(displayName: string | undefined | null): string {
  if (displayName == null) return '—';
  const trimmed = String(displayName).trim();
  if (trimmed === '') return '—';

  // 半角/全角スペースで分割（連続スペースは空トークンを除去）。
  const tokens = trimmed.split(/[\s　]+/).filter((t) => t !== '');
  if (tokens.length === 0) return '—';
  if (tokens.length >= 2) {
    return tokens[0];
  }

  // 区切り無し → 先頭 2 文字（サロゲートペア対応のため Array.from）。
  const chars = Array.from(tokens[0]);
  if (chars.length <= 2) return tokens[0];
  return chars.slice(0, 2).join('');
}

// ============================================================
// C-9. チップ時間帯レンジ
// ============================================================

/** preference.start_time が null のときソート用に代入するセンチネル。表示時は「時刻なし」扱い。 */
export const NO_START_TIME_SENTINEL = '99:99';

function parseHM(t: string): { hour: number; minute: number } | null {
  const parts = String(t).trim().split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] ?? '0', 10);
  if (!Number.isFinite(h)) return null;
  return { hour: h, minute: Number.isFinite(m) ? m : 0 };
}

function formatClock(hour: number, minute: number): string {
  const hh = String(hour).padStart(2, '0'); // 24+ もそのまま2桁（24,26,29…）
  return minute === 0 ? hh : `${hh}:${String(minute).padStart(2, '0')}`;
}

/**
 * SPシフト/希望チップ用の時間帯レンジ文字列（純関数・色/DOM非依存）。
 *  - start が null/''/NO_START_TIME_SENTINEL → '' （呼び側は時間帯を出さず姓のみ）。"99"は絶対に出さない。
 *  - end が null/''/NO_START_TIME_SENTINEL → `${startFmt}-`（開始のみ・末尾ハイフン）。
 *  - end<=start（HH:mm再構成の文字列比較, formatTimeRange と同境界）は翌日跨ぎ→end hour に +24（24+表記）。
 *    ※既に24+で来た値は再加算しない（"24:30">"18:00" で分岐に入らないため冪等）。
 *  - 分0は省略、非0は ':MM'(2桁)。hour は常に2桁 padStart。
 */
export function formatChipTimeRange(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): string {
  if (startTime == null || startTime === '' || startTime === NO_START_TIME_SENTINEL) return '';
  const s = parseHM(startTime);
  if (s == null) return '';
  const startFmt = formatClock(s.hour, s.minute);
  if (endTime == null || endTime === '' || endTime === NO_START_TIME_SENTINEL) return `${startFmt}-`;
  const e = parseHM(endTime);
  if (e == null) return `${startFmt}-`;
  const sHM = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
  const eHM = `${String(e.hour).padStart(2, '0')}:${String(e.minute).padStart(2, '0')}`;
  const endHour = eHM <= sHM ? e.hour + 24 : e.hour; // 翌日跨ぎ→24+
  return `${startFmt}-${formatClock(endHour, e.minute)}`;
}
