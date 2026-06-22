// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { useUrlState } from './useUrlState';

const VIEWS = ['current', 'history'] as const;

function wrapperFor(initialEntry: string) {
  return ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: [initialEntry] }, children);
}

describe('useUrlState', () => {
  it('初期 URL ?view=history → 初期値 history を採用する', () => {
    const { result } = renderHook(
      () => useUrlState('view', VIEWS, 'current'),
      { wrapper: wrapperFor('/?view=history') },
    );
    expect(result.current[0]).toBe('history');
  });

  it('setter 呼び出しで state と URL に反映される', () => {
    const { result } = renderHook(
      () => useUrlState('view', VIEWS, 'current'),
      { wrapper: wrapperFor('/?view=current') },
    );
    expect(result.current[0]).toBe('current');

    act(() => {
      result.current[1]('history');
    });

    expect(result.current[0]).toBe('history');
  });

  it('不正値 ?view=xxx → fallback を採用する', () => {
    const { result } = renderHook(
      () => useUrlState('view', VIEWS, 'current'),
      { wrapper: wrapperFor('/?view=xxx') },
    );
    expect(result.current[0]).toBe('current');
  });
});
