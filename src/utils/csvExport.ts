/**
 * 給与CSV用のメンバー集計行。
 * PayrollCalculation の PayrollRow と互換（CSV 生成に必要なフィールドのみを要求）。
 * actual / shift / 印刷 / 画面で同一の payrollData を消費し、値の整合を保証する。
 */
export interface PayrollCsvRow {
  displayName: string;
  payType: 'hourly' | 'monthly';
  hourlyRate: number;
  monthlySalary: number;
  workDays: number;
  normalMinutes: number;
  nightMinutes: number;
  payment: number;
}

function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/**
 * CSV セル 1 個分のエスケープ（正本）。
 * 1) CSV インジェクション対策: 先頭が = + - @ TAB CR なら ' を前置して
 *    Excel / Sheets / LibreOffice の数式評価（=HYPERLINK / =cmd 等）を防ぐ。
 * 2) ダブルクォートで括り、内部の " を "" にエスケープ（RFC 4180）。
 * 給与 CSV（実績/シフト両系統）はこの 1 関数に一本化して防御の取りこぼしを防ぐ。
 */
export function csvEscape(val: string | number): string {
  let s = String(val);
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * 実績ベースの給与データ（PayrollRow 集計済み）から CSV を生成する。
 *
 * 旧実装は member.hourly_rate と深夜倍率 1.25 ハードコードで record 単位に独自再計算していたが、
 * store override / role 既定時給 / 行ごと vs 合算後 ceil の粒度差で画面・印刷と乖離する問題があった。
 * getMemberPayrollForStore を通した calcMemberPayroll の payrollData.payment を集計源にすることで
 * actual / shift / CSV / 印刷 で同一値になることを保証する。
 */
export function generatePayrollCsv(payrollData: PayrollCsvRow[]): string {
  // CSV インジェクション対策・引用符エスケープは共通の csvEscape に一本化。
  const header = ['名前', '稼働日数', '通常時間', '深夜時間', '時給/月給', '支給額', '算出モード']
    .map(csvEscape)
    .join(',');

  const lines = payrollData.map((row) => {
    const rateLabel =
      row.payType === 'monthly'
        ? `${row.monthlySalary.toLocaleString()}円/月`
        : `${row.hourlyRate.toLocaleString()}円/時`;
    return [
      row.displayName,
      `${row.workDays}日`,
      fmtTime(row.normalMinutes),
      fmtTime(row.nightMinutes),
      rateLabel,
      row.payment,
      '実績ベース',
    ]
      .map(csvEscape)
      .join(',');
  });

  // 合計行（画面・印刷の合計と同一の payrollData.payment を集計源にする）
  const totalPayment = payrollData.reduce((s, r) => s + r.payment, 0);
  const totalNormal = payrollData.reduce((s, r) => s + r.normalMinutes, 0);
  const totalNight = payrollData.reduce((s, r) => s + r.nightMinutes, 0);
  const totalHourly = payrollData
    .filter((r) => r.payType !== 'monthly')
    .reduce((s, r) => s + r.payment, 0);
  const totalMonthly = payrollData
    .filter((r) => r.payType === 'monthly')
    .reduce((s, r) => s + r.payment, 0);

  lines.push(['時給合計', '-', '-', '-', '-', totalHourly, ''].map(csvEscape).join(','));
  lines.push(['月給合計', '-', '-', '-', '-', totalMonthly, ''].map(csvEscape).join(','));
  lines.push(
    ['総支給額', '-', fmtTime(totalNormal), fmtTime(totalNight), '-', totalPayment, ''].map(csvEscape).join(',')
  );

  // UTF-8 BOM\u3002\u884C\u533A\u5207\u308A\u306F CRLF\uFF08Excel \u4E92\u63DB\uFF09+ \u672B\u5C3E CRLF \u306B\u7D71\u4E00\u3002
  const BOM = '\uFEFF';
  return BOM + header + '\r\n' + lines.join('\r\n') + '\r\n';
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
