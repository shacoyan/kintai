/**
 * 表示名を 2〜3 文字で識別可能な略称に変換
 *  - "テストスタッフ3" → "ス3"
 *  - "テスト店長1"     → "店1"
 *  - "テストオーナー"  → "ナー"
 *  - "山田 太郎"       → "山太" (姓1 + 名1)
 *  - "tanaka taro"     → "ta" (ASCII 先頭2文字)
 *  - フォールバック: 末尾 2 文字
 *
 * 末尾の連続数字は必ず保持する。
 */
export function abbreviateName(name: string | undefined | null): string {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  // 末尾連続数字を抽出
  const tailNumMatch = trimmed.match(/(\d+)$/);
  const tailNum = tailNumMatch ? tailNumMatch[1] : '';
  const base = tailNum ? trimmed.slice(0, trimmed.length - tailNum.length) : trimmed;
  // 半角/全角スペースで姓名分割（複数語）
  const parts = base.split(/[\s　]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0].slice(0, 1) + parts[1].slice(0, 1) + tailNum).slice(0, 4);
  }
  // ASCII の場合は先頭 2 文字
  if (/^[\x00-\x7F]+$/.test(base)) return (base.slice(0, 2) + tailNum).slice(0, 4);
  // 日本語: 末尾 1 文字 + 数字
  const suffix = base.length >= 2 ? base.slice(-1) : base;
  return (suffix + tailNum).slice(0, 4);
}
