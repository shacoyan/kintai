// @vitest-environment jsdom
// 2026-08-05 kintai-shift-mine-filter 機能1: readMineOnly/writeMineOnly は
// ShiftStatusFilter.tsx の readStatusFilter/writeStatusFilter と同型
// (`typeof window === 'undefined'` ガード) のため、実 window/localStorage を
// 持つ jsdom 環境でテストする（node デフォルト環境では window が無く SSR 分岐に落ちてしまう）。
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ShiftPage.tsx はモジュールトップレベルで '../lib/supabase' を import しており、
// そちらは import.meta.env の Supabase 環境変数が無いと throw する（テスト環境では未設定）。
// 本テストは ShiftPage.tsx が export する純関数のみを対象とするため、supabase クライアント
// 自体は不要 — 実クライアント初期化を避けるためモック化する（実装ロジックには一切影響しない）。
vi.mock('../lib/supabase', () => ({ supabase: {} }));

import {
  MINE_ONLY_STORAGE_KEY,
  readMineOnly,
  writeMineOnly,
  computeEffectiveMineOnly,
  filterRowsByMine,
} from './ShiftPage';

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

describe('filterRowsByMine', () => {
  type Row = { user_id: string; label: string };
  const rows: Row[] = [
    { user_id: 'user-1', label: 'mine-1' },
    { user_id: 'user-2', label: 'other-1' },
    { user_id: 'user-1', label: 'mine-2' },
  ];

  it('effectiveMineOnly=true のとき currentUserId と一致する行のみ返す', () => {
    const result = filterRowsByMine(rows, true, 'user-1');
    expect(result).toEqual([
      { user_id: 'user-1', label: 'mine-1' },
      { user_id: 'user-1', label: 'mine-2' },
    ]);
  });

  it('effectiveMineOnly=false のときは全件そのまま返す', () => {
    expect(filterRowsByMine(rows, false, 'user-1')).toEqual(rows);
  });

  it('currentUserId=null のときは effectiveMineOnly=true でも全件返す（ガード）', () => {
    expect(filterRowsByMine(rows, true, null)).toEqual(rows);
  });

  it('一致する行が無ければ空配列を返す', () => {
    expect(filterRowsByMine(rows, true, 'user-999')).toEqual([]);
  });

  it('元の配列を変更しない（非破壊）', () => {
    const original = [...rows];
    filterRowsByMine(rows, true, 'user-1');
    expect(rows).toEqual(original);
  });
});
