import { describe, it, expect } from 'vitest';
import { formatYen } from './utils';

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
