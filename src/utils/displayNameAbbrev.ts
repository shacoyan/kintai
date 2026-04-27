/**
 * 表示名を 2〜4 文字で識別可能な略称に変換 (Loop 11a 改訂版)
 *  - "テストスタッフ3" → "ﾃｽ3" (初期2文字 + 末尾数字)
 *  - "テスト店長1"     → "ﾃｽ1"
 *  - "テストオーナー"  → "ﾃｽ"
 *  - "山田 太郎"       → "山太" (姓1 + 名1) ※従来踏襲
 *  - "tanaka taro"     → "ta"  ※従来踏襲
 *  - フォールバック: 末尾 2 文字
 *
 * 末尾の連続数字は必ず保持する。
 *
 * TODO (将来): 同名衝突時の「3 文字 + 数字」拡張、および全角→半角カナ変換。
 */
export function abbreviateName(name: string | undefined | null): string {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';

  const tailNumMatch = trimmed.match(/(\d+)$/);
  const tailNum = tailNumMatch ? tailNumMatch[1] : '';
  const base = tailNum ? trimmed.slice(0, trimmed.length - tailNum.length) : trimmed;

  // 半角/全角スペースで姓名分割 (複数語: 従来踏襲)
  const parts = base.split(/[\s　]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0].slice(0, 1) + parts[1].slice(0, 1) + tailNum).slice(0, 4);
  }

  // ASCII の場合は先頭 2 文字 (従来踏襲)
  if (/^[\x00-\x7F]+$/.test(base)) return (base.slice(0, 2) + tailNum).slice(0, 4);

  // ★ 改訂: 日本語単一語は「先頭 2 文字 + 数字」に変更 (旧: 末尾 1 文字)
  const head = base.length >= 2 ? base.slice(0, 2) : base;
  return (head + tailNum).slice(0, 4);
}
