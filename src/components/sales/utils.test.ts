import { describe, it, expect } from 'vitest';
import { formatYen, formatYenCompact } from './utils';

describe('formatYen', () => {
  it('正常値を3桁区切りで整形する', () => {
    expect(formatYen(1234567)).toBe('¥1,234,567');
  });

  it('0 を ¥0 として整形する', () => {
    expect(formatYen(0)).toBe('¥0');
  });

  it('負値を符号付きで整形する', () => {
    expect(formatYen(-1234)).toBe('¥-1,234');
  });

  it('小数を toLocaleString の既定挙動で整形する', () => {
    // Number.isFinite(1234.5) === true なのでガードを通過し従来書式
    expect(formatYen(1234.5)).toBe(`¥${(1234.5).toLocaleString()}`);
  });

  it('NaN を ¥0 に倒す', () => {
    expect(formatYen(NaN)).toBe('¥0');
  });

  it('Infinity を ¥0 に倒す', () => {
    expect(formatYen(Infinity)).toBe('¥0');
  });

  it('-Infinity を ¥0 に倒す', () => {
    expect(formatYen(-Infinity)).toBe('¥0');
  });
});

describe('formatYenCompact', () => {
  it('億超え（7店ALL合算）を ¥N.N億 に短縮する', () => {
    expect(formatYenCompact(123456789)).toBe('¥1.2億');
  });

  it('ちょうど 1 億を ¥1.0億 とする', () => {
    expect(formatYenCompact(100000000)).toBe('¥1.0億');
  });

  it('万単位を四捨五入＋3桁区切りで短縮する', () => {
    expect(formatYenCompact(34567890)).toBe('¥3,457万');
  });

  it('ちょうど 1 万を ¥1万 とする', () => {
    expect(formatYenCompact(10000)).toBe('¥1万');
  });

  it('1 万未満は formatYen にフォールバックする', () => {
    expect(formatYenCompact(9999)).toBe('¥9,999');
  });

  it('負値（返金）は符号を維持して億短縮する', () => {
    expect(formatYenCompact(-123456789)).toBe('-¥1.2億');
  });

  it('負値（返金）は符号を維持して万短縮する', () => {
    expect(formatYenCompact(-34567890)).toBe('-¥3,457万');
  });

  it('0 は ¥0 とする', () => {
    expect(formatYenCompact(0)).toBe('¥0');
  });

  it('NaN を ¥0 に倒す', () => {
    expect(formatYenCompact(NaN)).toBe('¥0');
  });

  it('Infinity を ¥0 に倒す', () => {
    expect(formatYenCompact(Infinity)).toBe('¥0');
  });
});
