/**
 * 円を「¥80万」形式で表示するための utility。
 * 正典 `KINTAI design/screen-shift.jsx` の `CostStat` 表記に合わせる。
 *
 * - 1 万円未満は全額表記 (¥5,000)
 * - 1 万円以上は万単位四捨五入 (¥80万)
 */
export function formatYenMan(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '¥0';
  if (n < 10000) return `¥${n.toLocaleString()}`;
  return `¥${Math.round(n / 10000)}万`;
}

/**
 * `LaborCostCard` の大文字 stat 用に金額本体と単位 ("万") を分離する。
 * `<span class="big">¥80</span><span class="small">万</span>` のような描画に使う。
 */
export function formatYenManSplit(n: number): { yenMan: string; tail: string } {
  if (!Number.isFinite(n) || n <= 0) return { yenMan: '¥0', tail: '' };
  if (n < 10000) return { yenMan: `¥${n.toLocaleString()}`, tail: '' };
  return { yenMan: `¥${Math.round(n / 10000)}`, tail: '万' };
}
