// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import {
  ShiftStatusFilter,
  readMineOnly,
  writeMineOnly,
} from './ShiftStatusFilter';
import { MINE_ONLY_STORAGE_KEY, DEFAULT_STATUS_FILTER } from './unifiedShiftTypes';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('readMineOnly / writeMineOnly', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('未設定時は false を返す', () => {
    expect(readMineOnly()).toBe(false);
  });

  it('write した値を read できる (true)', () => {
    writeMineOnly(true);
    expect(localStorage.getItem(MINE_ONLY_STORAGE_KEY)).toBe('true');
    expect(readMineOnly()).toBe(true);
  });

  it('write した値を read できる (false)', () => {
    writeMineOnly(true);
    writeMineOnly(false);
    expect(readMineOnly()).toBe(false);
  });

  it('SSR (window undefined) 環境では readMineOnly は false を返す (例外にならない)', () => {
    vi.stubGlobal('window', undefined);
    expect(readMineOnly()).toBe(false);
  });

  it('SSR (window undefined) 環境では writeMineOnly は何もせず例外にならない', () => {
    vi.stubGlobal('window', undefined);
    expect(() => writeMineOnly(true)).not.toThrow();
  });

  it('localStorage.getItem が例外を投げても readMineOnly は false を返す', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(readMineOnly()).toBe(false);
    spy.mockRestore();
  });

  it('localStorage.setItem が例外を投げても writeMineOnly は例外にならない', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => writeMineOnly(true)).not.toThrow();
    spy.mockRestore();
  });
});

describe('ShiftStatusFilter - 自分のみチップ', () => {
  function renderFilter(overrides: Partial<Parameters<typeof ShiftStatusFilter>[0]> = {}) {
    const onChange = vi.fn();
    const onMineOnlyChange = vi.fn();
    render(
      <ShiftStatusFilter
        value={new Set(DEFAULT_STATUS_FILTER)}
        onChange={onChange}
        showMineOnlyFilter
        mineOnly={false}
        onMineOnlyChange={onMineOnlyChange}
        {...overrides}
      />
    );
    return { onChange, onMineOnlyChange };
  }

  it('showMineOnlyFilter=false のときはチップもバナーも描画しない', () => {
    render(
      <ShiftStatusFilter
        value={new Set(DEFAULT_STATUS_FILTER)}
        onChange={vi.fn()}
        showMineOnlyFilter={false}
        mineOnly
        onMineOnlyChange={vi.fn()}
      />
    );
    expect(screen.queryAllByLabelText('自分のみ表示')).toHaveLength(0);
    expect(screen.queryByText(/自分のみ表示中/)).toBeNull();
  });

  it('onMineOnlyChange が無いときはチップを描画しない (安全側)', () => {
    render(
      <ShiftStatusFilter
        value={new Set(DEFAULT_STATUS_FILTER)}
        onChange={vi.fn()}
        showMineOnlyFilter
        mineOnly={false}
      />
    );
    expect(screen.queryAllByLabelText('自分のみ表示')).toHaveLength(0);
  });

  it('showMineOnlyFilter=true のとき PC/SP 両 fieldset にチップが描画される', () => {
    renderFilter();
    // PC fieldset + SP fieldset の 2 箇所に「表示するメンバー」fieldset がある
    expect(screen.getAllByRole('group', { name: '表示するメンバー' })).toHaveLength(2);
    expect(screen.getAllByLabelText('自分のみ表示')).toHaveLength(2);
  });

  it('チップクリックで onMineOnlyChange(!mineOnly) が呼ばれる', () => {
    const { onMineOnlyChange } = renderFilter({ mineOnly: false });
    const chips = screen.getAllByLabelText('自分のみ表示');
    fireEvent.click(chips[0]);
    expect(onMineOnlyChange).toHaveBeenCalledWith(true);
  });

  it('mineOnly=true のとき aria-checked=true でバナーが表示される', () => {
    renderFilter({ mineOnly: true });
    const chips = screen.getAllByLabelText('自分のみ表示');
    for (const chip of chips) {
      expect(chip.getAttribute('aria-checked')).toBe('true');
    }
    expect(screen.getByText(/自分のみ表示中/)).not.toBeNull();
  });

  it('mineOnly=false のときはバナーが表示されない', () => {
    renderFilter({ mineOnly: false });
    expect(screen.queryByText(/自分のみ表示中/)).toBeNull();
  });
});
