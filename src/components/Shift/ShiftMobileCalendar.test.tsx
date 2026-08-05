// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ShiftMobileCalendar } from './ShiftMobileCalendar';
import type { Shift, ShiftPreference } from '../../types';

// 機能1「自分のみ」表示（mineOnly）を SP カレンダーに適用した際の
// シフトチップ・希望ゴーストチップ・出勤不可マーカーの全経路と、
// currentUserId=null ガードを固定する。

const ME = 'me-user-id';
const OTHER = 'other-user-id';
const STORE = 'store-1';
const VIEW_MONTH = new Date(2026, 5, 1); // 2026-06
const DATE = '2026-06-15';

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    tenant_id: 't',
    user_id: ME,
    date: DATE,
    start_time: '10:00',
    end_time: '18:00',
    status: 'approved',
    original_start_time: null,
    original_end_time: null,
    note: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: '',
    tentative_approved_by: null,
    tentative_approved_at: null,
    store_id: STORE,
    preference_id: null,
    frame_id: null,
    ...overrides,
  };
}

function makePreference(overrides: Partial<ShiftPreference> = {}): ShiftPreference {
  return {
    id: 'pref-1',
    tenant_id: 't',
    user_id: ME,
    date: DATE,
    preference_type: 'preferred',
    start_time: '10:00',
    end_time: '18:00',
    note: null,
    status: 'pending',
    created_at: '',
    store_id: STORE,
    ...overrides,
  };
}

const memberNames = new Map<string, string>([
  [ME, '山田太郎'],
  [OTHER, '鈴木花子'],
]);

afterEach(() => {
  cleanup();
});

describe('ShiftMobileCalendar mineOnly', () => {
  it('mineOnly=false のときは自分と他人の両方のシフトチップが表示される', () => {
    const shifts = [makeShift({ id: 's-me', user_id: ME }), makeShift({ id: 's-other', user_id: OTHER })];
    render(
      <ShiftMobileCalendar
        shiftViewMonth={VIEW_MONTH}
        shifts={shifts}
        preferences={[]}
        currentUserId={ME}
        selectedDate={null}
        isBulkMode={false}
        mineOnly={false}
        onDateClick={vi.fn()}
        memberNames={memberNames}
      />,
    );
    expect(screen.getByText('山田')).toBeTruthy();
    expect(screen.getByText('鈴木')).toBeTruthy();
  });

  it('mineOnly=true のときは他人のシフトチップが消え自分のみ残る', () => {
    const shifts = [makeShift({ id: 's-me', user_id: ME }), makeShift({ id: 's-other', user_id: OTHER })];
    render(
      <ShiftMobileCalendar
        shiftViewMonth={VIEW_MONTH}
        shifts={shifts}
        preferences={[]}
        currentUserId={ME}
        selectedDate={null}
        isBulkMode={false}
        mineOnly
        onDateClick={vi.fn()}
        memberNames={memberNames}
      />,
    );
    expect(screen.getByText('山田')).toBeTruthy();
    expect(screen.queryByText('鈴木')).not.toBeTruthy();
  });

  it('mineOnly=true でも currentUserId=null のときはフィルタを適用せず全件表示する（事故防止ガード）', () => {
    const shifts = [makeShift({ id: 's-me', user_id: ME }), makeShift({ id: 's-other', user_id: OTHER })];
    render(
      <ShiftMobileCalendar
        shiftViewMonth={VIEW_MONTH}
        shifts={shifts}
        preferences={[]}
        currentUserId={null}
        selectedDate={null}
        isBulkMode={false}
        mineOnly
        onDateClick={vi.fn()}
        memberNames={memberNames}
      />,
    );
    expect(screen.getByText('山田')).toBeTruthy();
    expect(screen.getByText('鈴木')).toBeTruthy();
  });

  it('mineOnly=true のときは他人の希望ゴーストチップ(preferred/pending)も消える', () => {
    const preferences = [
      makePreference({ id: 'p-me', user_id: ME }),
      makePreference({ id: 'p-other', user_id: OTHER }),
    ];
    render(
      <ShiftMobileCalendar
        shiftViewMonth={VIEW_MONTH}
        shifts={[]}
        preferences={preferences}
        currentUserId={ME}
        selectedDate={null}
        isBulkMode={false}
        mineOnly
        showPreferenceStatus
        onDateClick={vi.fn()}
        memberNames={memberNames}
      />,
    );
    expect(screen.getByText('山田')).toBeTruthy();
    expect(screen.queryByText('鈴木')).not.toBeTruthy();
  });

  it('mineOnly=true のときは他人の出勤不可マーカーは件数に含まれず自分の分のみ数えられる', () => {
    const preferences = [
      makePreference({ id: 'u-me', user_id: ME, preference_type: 'unavailable' }),
      makePreference({ id: 'u-other', user_id: OTHER, preference_type: 'unavailable' }),
    ];
    render(
      <ShiftMobileCalendar
        shiftViewMonth={VIEW_MONTH}
        shifts={[]}
        preferences={preferences}
        currentUserId={ME}
        selectedDate={null}
        isBulkMode={false}
        mineOnly
        showPreferenceStatus
        onDateClick={vi.fn()}
        memberNames={memberNames}
      />,
    );
    // 自分の分1件のみ → 「出勤不可1件」の button aria-label になる（2件なら「2」表記になる）
    expect(screen.getByRole('button', { name: /出勤不可1件/ })).toBeTruthy();
  });
});
