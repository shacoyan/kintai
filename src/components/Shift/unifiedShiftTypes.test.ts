// @vitest-environment jsdom
// readMineOnly/writeMineOnly は window/localStorage の SSR ガード分岐を持つため、
// 実 window を持つ jsdom 環境でテストする (node デフォルト環境では window が無く
// SSR 分岐に落ちてしまう)。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  shouldShowMineOnlyFilter,
  MINE_ONLY_STORAGE_KEY,
  readMineOnly,
  writeMineOnly,
  computeEffectiveMineOnly,
} from './unifiedShiftTypes';

describe('MINE_ONLY_STORAGE_KEY', () => {
  it('は既存 STATUS_FILTER_STORAGE_KEY とは別のキー名', () => {
    expect(MINE_ONLY_STORAGE_KEY).toBe('kintai.shift.mineOnly.v1');
  });
});

describe('shouldShowMineOnlyFilter', () => {
  it('canManageTenant=true かつ currentUserId 確定時のみ true', () => {
    expect(shouldShowMineOnlyFilter(true, 'me')).toBe(true);
  });

  it('canManageTenant=false のときは false (staff は元々自分のみ)', () => {
    expect(shouldShowMineOnlyFilter(false, 'me')).toBe(false);
  });

  it('currentUserId が null/undefined のときは false', () => {
    expect(shouldShowMineOnlyFilter(true, null)).toBe(false);
    expect(shouldShowMineOnlyFilter(true, undefined)).toBe(false);
  });

  it('canManageTenant=false かつ currentUserId=null でも false', () => {
    expect(shouldShowMineOnlyFilter(false, null)).toBe(false);
  });
});

describe('readMineOnly / writeMineOnly', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('未設定時は false を返す', () => {
    expect(readMineOnly()).toBe(false);
  });

  it('writeMineOnly(true) 後は readMineOnly() が true を返す', () => {
    writeMineOnly(true);
    expect(readMineOnly()).toBe(true);
    expect(window.localStorage.getItem(MINE_ONLY_STORAGE_KEY)).toBe('true');
  });

  it('writeMineOnly(false) 後は readMineOnly() が false を返す', () => {
    writeMineOnly(true);
    writeMineOnly(false);
    expect(readMineOnly()).toBe(false);
  });

  it('既存 (旧実装が書き込んだ) 永続値 "true" をそのまま読める (後方互換)', () => {
    window.localStorage.setItem(MINE_ONLY_STORAGE_KEY, 'true');
    expect(readMineOnly()).toBe(true);
  });

  it('既存永続値 "false" をそのまま読める (後方互換)', () => {
    window.localStorage.setItem(MINE_ONLY_STORAGE_KEY, 'false');
    expect(readMineOnly()).toBe(false);
  });

  it('壊れた JSON が入っていても例外を投げず false を返す', () => {
    window.localStorage.setItem(MINE_ONLY_STORAGE_KEY, '{not-json');
    expect(readMineOnly()).toBe(false);
  });

  it('boolean 以外の値 (数値・文字列等) が入っていた場合も false を返す', () => {
    window.localStorage.setItem(MINE_ONLY_STORAGE_KEY, '"true"');
    expect(readMineOnly()).toBe(false);
    window.localStorage.setItem(MINE_ONLY_STORAGE_KEY, '1');
    expect(readMineOnly()).toBe(false);
  });

  it('localStorage.getItem が例外を投げても readMineOnly は例外を投げず false を返す', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('quota / access error');
    });
    expect(() => readMineOnly()).not.toThrow();
    expect(readMineOnly()).toBe(false);
    spy.mockRestore();
  });

  it('localStorage.setItem が例外を投げても writeMineOnly は例外を投げない', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => writeMineOnly(true)).not.toThrow();
    spy.mockRestore();
  });

  it('SSR (window undefined) 環境では readMineOnly は false を返す (例外にならない)', () => {
    vi.stubGlobal('window', undefined);
    expect(readMineOnly()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('SSR (window undefined) 環境では writeMineOnly は何もせず例外にならない', () => {
    vi.stubGlobal('window', undefined);
    expect(() => writeMineOnly(true)).not.toThrow();
    vi.unstubAllGlobals();
  });
});

describe('computeEffectiveMineOnly', () => {
  it('mineOnly=true かつ canManageTenant=true かつ currentUserId が存在するときのみ true', () => {
    expect(computeEffectiveMineOnly(true, true, 'user-1')).toBe(true);
  });

  it('canManageTenant=false (staff) のときは常に false', () => {
    expect(computeEffectiveMineOnly(true, false, 'user-1')).toBe(false);
  });

  it('currentUserId=null のときは常に false（全件消失事故防止）', () => {
    expect(computeEffectiveMineOnly(true, true, null)).toBe(false);
  });

  it('mineOnly=false のときは false', () => {
    expect(computeEffectiveMineOnly(false, true, 'user-1')).toBe(false);
  });

  it('canManageTenant=false かつ currentUserId=null が両方揃っても false のまま', () => {
    expect(computeEffectiveMineOnly(true, false, null)).toBe(false);
  });
});
