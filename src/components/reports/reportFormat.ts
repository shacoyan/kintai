// =============================================================================
// components/reports/reportFormat.ts — 日報/月報の表示フォーマット補助（Loop D/E）
// -----------------------------------------------------------------------------
// 設計書 §3。円フォーマットは既存 sales/utils の formatYen を再 export して流用し、
// reports 固有の軽い整形（整数客数・違算符号ラベル等）のみ最小限に追加する。
// =============================================================================

// 円フォーマットは Loop2 の実装を流用（再実装しない・§3 末尾）。
export { formatYen } from '../sales/utils';

/** 整数（人数・本数・枚数）を 1,234 形式に。null/NaN は 0。 */
export function formatCount(n: number | null | undefined): string {
  const v = Number(n);
  return Number.isFinite(v) ? Math.trunc(v).toLocaleString('ja-JP') : '0';
}

/**
 * 違算（過不足）の符号付き円表示。
 * 設計書 §9 R2: RPC の符号をそのまま尊重し中立ラベルで表示する。
 * 正は「+」を明示、負は「−」、0 は「±0」。
 */
export function formatSignedYen(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '±0 円';
  const abs = Math.abs(Math.trunc(v)).toLocaleString('ja-JP');
  return `${v > 0 ? '+' : '−'}${abs} 円`;
}

/** 違算額に応じた Badge tone（過剰=success / 不足=danger / 一致=neutral）。 */
export function discrepancyTone(n: number | null | undefined): 'success' | 'danger' | 'neutral' {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return 'neutral';
  return v > 0 ? 'success' : 'danger';
}
