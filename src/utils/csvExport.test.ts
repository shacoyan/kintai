import { describe, it, expect } from 'vitest';
import { csvEscape, generatePayrollCsv, type PayrollCsvRow } from './csvExport';

describe('csvEscape — CSV 数式インジェクション対策', () => {
  it.each([
    ['=HYPERLINK("http://x","y")'],
    ['=cmd'],
    ['+1'],
    ['-1'],
    ['@a'],
    ['\tTAB'],
    ['\rCR'],
  ])('先頭が危険文字の %s には \' を前置する', (input) => {
    const out = csvEscape(input);
    // 値部分（外側の " を剥がす）が ' で始まること
    expect(out).toBe(`"'${input.replace(/"/g, '""')}"`);
  });

  it('安全な文字列には ' + "'" + ' を前置しない', () => {
    expect(csvEscape('田中太郎')).toBe('"田中太郎"');
    expect(csvEscape('abc')).toBe('"abc"');
  });

  it('途中に = があっても先頭でなければ前置しない', () => {
    expect(csvEscape('a=b')).toBe('"a=b"');
  });

  it('内部の " は "" にエスケープする', () => {
    expect(csvEscape('a"b')).toBe('"a""b"');
  });

  it('数値はそのまま引用符で括る', () => {
    expect(csvEscape(12345)).toBe('"12345"');
    // 負数は先頭が - なので前置される
    expect(csvEscape(-1)).toBe(`"'-1"`);
  });

  it('空文字は前置しない', () => {
    expect(csvEscape('')).toBe('""');
  });
});

describe('generatePayrollCsv — 共通 csvEscape を使い名前列を防御する', () => {
  it('悪性 displayName が CSV 行で無害化される', () => {
    const rows: PayrollCsvRow[] = [
      {
        displayName: '=HYPERLINK("http://x","y")',
        payType: 'hourly',
        hourlyRate: 1000,
        monthlySalary: 0,
        workDays: 10,
        normalMinutes: 600,
        nightMinutes: 0,
        payment: 10000,
      },
    ];
    const csv = generatePayrollCsv(rows);
    // 名前セルが '= で始まること（数式評価無効化）
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
  });
});
