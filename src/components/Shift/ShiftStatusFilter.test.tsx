// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ShiftStatusFilter } from './ShiftStatusFilter';
import { DEFAULT_STATUS_FILTER } from './unifiedShiftTypes';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
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

  it('mineOnly=true のとき aria-checked=true になる（バナー表示は ShiftPage 側の責務）', () => {
    renderFilter({ mineOnly: true });
    const chips = screen.getAllByLabelText('自分のみ表示');
    for (const chip of chips) {
      expect(chip.getAttribute('aria-checked')).toBe('true');
    }
    expect(screen.queryByText(/自分のみ表示中/)).toBeNull();
  });

  it('mineOnly=false のときも自分のみ表示中バナーは描画されない', () => {
    renderFilter({ mineOnly: false });
    expect(screen.queryByText(/自分のみ表示中/)).toBeNull();
  });
});
