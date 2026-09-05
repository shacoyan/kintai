// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { ShiftMobileCalendar } from './ShiftMobileCalendar';
import type { Shift, ShiftPreference, ShiftFrame } from '../../types';

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

function makeFrame(overrides: Partial<ShiftFrame> = {}): ShiftFrame {
  return {
    id: 'frame-1',
    tenant_id: 't',
    store_id: STORE,
    day_of_week: 1, // 2026-06-15 は月曜
    date: null,
    name: '早番',
    start_time: '10:00:00',
    end_time: '18:00:00',
    required_count: 2,
    sort_order: 0,
    is_active: true,
    created_at: '',
    updated_at: '',
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

describe('ShiftMobileCalendar 2段チップ・枠バー（§4.2）', () => {
  it('確定シフトは2段チップになり、姓は単独ノード・titleに姓/時刻/状態が入る', () => {
    render(
      <ShiftMobileCalendar
        shiftViewMonth={VIEW_MONTH}
        shifts={[makeShift()]}
        preferences={[]}
        currentUserId={ME}
        selectedDate={null}
        isBulkMode={false}
        onDateClick={vi.fn()}
        memberNames={memberNames}
      />,
    );
    expect(screen.getByTitle('山田 10-18 本承認')).toBeTruthy();
    expect(screen.getByText('山田')).toBeTruthy();
  });

  it('枠バー + 配下グループ: 枠に紐づくシフトはグループへ分配され、titleに配置/必要人数と判定が出る', () => {
    render(
      <ShiftMobileCalendar
        shiftViewMonth={VIEW_MONTH}
        shifts={[makeShift({ id: 's-me', frame_id: 'frame-1' })]}
        preferences={[]}
        currentUserId={ME}
        selectedDate={null}
        isBulkMode={false}
        onDateClick={vi.fn()}
        memberNames={memberNames}
        frames={[makeFrame()]}
        frameStoreId={STORE}
      />,
    );
    expect(screen.getByTitle(/枠 早番 .*配置1人\/必要2人 不足/)).toBeTruthy();
    expect(within(screen.getByTestId('sp-frame-group-frame-1')).getByText('山田')).toBeTruthy();
  });

  it('frameCountShifts を渡すと充足カウントは他人を含めて数えるが、表示（分配）は shifts のみから行う', () => {
    render(
      <ShiftMobileCalendar
        shiftViewMonth={VIEW_MONTH}
        shifts={[makeShift({ id: 's-me', frame_id: 'frame-1' })]}
        preferences={[]}
        currentUserId={ME}
        selectedDate={null}
        isBulkMode={false}
        onDateClick={vi.fn()}
        memberNames={memberNames}
        frames={[makeFrame()]}
        frameStoreId={STORE}
        frameCountShifts={[
          makeShift({ id: 's-me', frame_id: 'frame-1' }),
          makeShift({ id: 's-other', user_id: OTHER, frame_id: 'frame-1' }),
        ]}
      />,
    );
    expect(screen.getByTitle(/枠 早番 .*配置2人\/必要2人 充足/)).toBeTruthy();
    expect(screen.queryByText('鈴木')).toBeFalsy();
  });

  it('frameStoreId 未指定なら frames を渡していても枠バー・グループは非描画（完全従来挙動）', () => {
    render(
      <ShiftMobileCalendar
        shiftViewMonth={VIEW_MONTH}
        shifts={[makeShift({ id: 's-me', frame_id: 'frame-1' })]}
        preferences={[]}
        currentUserId={ME}
        selectedDate={null}
        isBulkMode={false}
        onDateClick={vi.fn()}
        memberNames={memberNames}
        frames={[makeFrame()]}
      />,
    );
    expect(screen.queryByTitle(/枠 早番/)).toBeFalsy();
    expect(screen.queryByTestId(/sp-frame-group/)).toBeFalsy();
  });

  it('セル aria-label に 枠N件 が追加される', () => {
    render(
      <ShiftMobileCalendar
        shiftViewMonth={VIEW_MONTH}
        shifts={[makeShift({ id: 's-me', frame_id: 'frame-1' })]}
        preferences={[]}
        currentUserId={ME}
        selectedDate={null}
        isBulkMode={false}
        onDateClick={vi.fn()}
        memberNames={memberNames}
        frames={[makeFrame()]}
        frameStoreId={STORE}
      />,
    );
    // makeFrame は毎週月曜テンプレのため月内の他の月曜にも「枠1件」が付く。対象日 6/15 のセルで検証する。
    expect(screen.getByRole('button', { name: /^6月15日.*枠1件/ })).toBeTruthy();
  });
});
