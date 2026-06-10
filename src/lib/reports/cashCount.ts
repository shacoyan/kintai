// =============================================================================
// lib/reports/cashCount.ts — 金種9 → 現金合計の純関数（Loop D）
// -----------------------------------------------------------------------------
// 設計書 §4.4 / §6。daily_reports.cash_total（DB GENERATED）と同式を
// クライアント側でリアルタイム再現する。送信はしない（表示専用）。
// =============================================================================

import { DENOMINATIONS, type CashCounts } from './types';

/**
 * 単一の枚数値を非負整数に正規化する。
 * 空文字・null・undefined・NaN・負数・小数は安全側（floor / 0）に倒す。
 */
function normalizeCount(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * 金種ごとの枚数マップ（{ "10000": 枚数, ... }）から現金合計を計算する純関数。
 *
 *   cashTotal = Σ（額面 × 枚数）
 *
 * - 欠落キー・不正値（負数/小数/非数/空）は 0 枚として扱う（防御的）。
 * - DENOMINATIONS に無いキーは無視する。
 * - 大金額でも JS の安全整数範囲（< 2^53）に収まる想定（現実の現金枚数では overflow しない）。
 */
export function cashTotal(counts: CashCounts | null | undefined): number {
  if (!counts || typeof counts !== 'object') return 0;
  let total = 0;
  for (const denom of DENOMINATIONS) {
    const count = normalizeCount(counts[String(denom)]);
    total += denom * count;
  }
  return total;
}

/**
 * 全額面キーを 0 で埋めた空の CashCounts を返す（フォーム初期化用）。
 */
export function emptyCashCounts(): CashCounts {
  const out: CashCounts = {};
  for (const denom of DENOMINATIONS) {
    out[String(denom)] = 0;
  }
  return out;
}

/**
 * 任意の入力（RPC の cash_counts 等）を全額面キーを持つ正規化済み CashCounts に整える。
 * 欠落キーは 0、不正値は 0 枚に倒す。
 */
export function normalizeCashCounts(raw: unknown): CashCounts {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: CashCounts = {};
  for (const denom of DENOMINATIONS) {
    out[String(denom)] = normalizeCount(src[String(denom)]);
  }
  return out;
}
