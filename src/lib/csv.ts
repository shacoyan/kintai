// kintai/src/lib/csv.ts
export type CsvRow = (string | number | null | undefined)[];

// CSV インジェクション対策: Excel/Sheets はセル先頭が = + - @ TAB CR の場合に
// 数式として評価する（情報漏えい・外部リンク誘導の温床）。先頭に ' を前置して無効化する。
function sanitizeCsvFormula(s: string): string {
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
    return `'${s}`;
  }
  return s;
}

function escapeCsvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = sanitizeCsvFormula(String(v));
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCsv(headers: string[], rows: CsvRow[]): string {
  const lines: string[] = [];
  lines.push(headers.map(escapeCsvField).join(','));
  for (const row of rows) {
    lines.push(row.map(escapeCsvField).join(','));
  }
  // Excel 互換のため UTF-8 BOM を付与
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
