export function formatYen(amount: number): string {
  if (!Number.isFinite(amount)) return '¥0';
  return `¥${amount.toLocaleString()}`;
}

/**
 * Y 軸ラベルなど幅の限られた箇所向けに、金額を「億 / 万」短縮で整形する。
 * - |v| >= 1e8 → 「¥N.N億」（小数1桁、符号維持）
 * - |v| >= 1e4 → 「¥N万」（万単位四捨五入、3桁区切り、符号維持）
 * - それ未満 → formatYen にフォールバック
 * 非有限値は formatYen 同様 ¥0 に倒す。
 */
export function formatYenCompact(v: number): string {
  if (!Number.isFinite(v)) return '¥0';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1e8) {
    // 小数1桁。1.0億 のような末尾0も維持（桁あふれ回避が目的なので短さ優先で OK）
    return `${sign}¥${(abs / 1e8).toFixed(1)}億`;
  }
  if (abs >= 1e4) {
    return `${sign}¥${Math.round(abs / 1e4).toLocaleString()}万`;
  }
  return formatYen(v);
}
