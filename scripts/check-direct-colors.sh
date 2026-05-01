#!/usr/bin/env bash
# Loop 43: Tailwind 直接色の使用を検出する。
# 検出対象: (text|bg|border|ring|from|to|via|fill|stroke|divide|placeholder|outline)-<color>-<scale>
# 行末コメント `// loop43-allow` 付きの行はオプトアウトとして除外する。
# 0 終了 = 違反なし、1 終了 = 違反あり。
set -euo pipefail
cd "$(dirname "$0")/.."

PATTERN='(text|bg|border|ring|from|to|via|fill|stroke|divide|placeholder|outline)-(amber|rose|emerald|orange|green|blue|yellow|red|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|lime|stone|zinc|slate|gray)-[0-9]+'
TARGET='src'

# grep 走査 (拡張正規表現・行番号付き) → `// loop43-allow` を含む行を除外
HITS=$(grep -rEn "$PATTERN" "$TARGET" \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  2>/dev/null | grep -v 'loop43-allow' || true)

if [ -n "$HITS" ]; then
  echo "ERROR: Tailwind direct color detected (must use semantic tokens):"
  echo "$HITS"
  echo ""
  echo "Allowed tokens: primary, neutral, success, warning, danger, info, accent.{amber,teal,rose}, weekend.*, member.*, leaveType.*"
  echo "To opt-out a specific line, append '// loop43-allow' (with reason in code review)."
  exit 1
fi

echo "OK: no direct Tailwind colors found in $TARGET/"
exit 0
