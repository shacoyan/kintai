import { describe, it, expect } from 'vitest';
import {
  isMineOnlyVisible,
  shouldShowMineOnlyFilter,
  MINE_ONLY_STORAGE_KEY,
} from './unifiedShiftTypes';

describe('MINE_ONLY_STORAGE_KEY', () => {
  it('は既存 STATUS_FILTER_STORAGE_KEY とは別のキー名', () => {
    expect(MINE_ONLY_STORAGE_KEY).toBe('kintai.shift.mineOnly.v1');
  });
});

describe('isMineOnlyVisible', () => {
  it('mineOnly=false のときは常に true (絞り込みなし)', () => {
    expect(isMineOnlyVisible({ user_id: 'other' }, false, 'me')).toBe(true);
    expect(isMineOnlyVisible({ user_id: null }, false, 'me')).toBe(true);
    expect(isMineOnlyVisible({ user_id: 'other' }, false, null)).toBe(true);
  });

  it('mineOnly=true かつ currentUserId が null/undefined のときは全件表示 (フィルタ非適用ガード)', () => {
    expect(isMineOnlyVisible({ user_id: 'other' }, true, null)).toBe(true);
    expect(isMineOnlyVisible({ user_id: 'other' }, true, undefined)).toBe(true);
    expect(isMineOnlyVisible({ user_id: null }, true, null)).toBe(true);
  });

  it('mineOnly=true かつ currentUserId 確定時は自分の行のみ true', () => {
    expect(isMineOnlyVisible({ user_id: 'me' }, true, 'me')).toBe(true);
    expect(isMineOnlyVisible({ user_id: 'other' }, true, 'me')).toBe(false);
  });

  it('row.user_id が null のとき、currentUserId が確定していても false (null===null の罠を避ける)', () => {
    expect(isMineOnlyVisible({ user_id: null }, true, 'me')).toBe(false);
  });

  it('row.user_id が undefined のときも false', () => {
    expect(isMineOnlyVisible({ user_id: undefined }, true, 'me')).toBe(false);
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
