// kintai/src/lib/csv.ts
export type CsvRow = (string | number | null | undefined)[];

function escapeCsvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
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
