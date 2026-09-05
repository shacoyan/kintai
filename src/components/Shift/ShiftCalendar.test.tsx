// @vitest-environment jsdom
// 設計書 .company/engineering/docs/2026-08-05-kintai-shift-mine-filter.md 機能1:
// PC カレンダーの mineOnly 適用。
//   - 自分以外のシフトバー/希望バー/出勤不可(休暇)マーカーを非表示にする
//   - status==='pending' の常時表示例外より mineOnly を優先する
//   - currentUserId が null のときは mineOnly=true でも一切適用しない(全件消失事故防止)
//   - 枠(shift_frames)の充足カウントは mineOnly の影響を受けない(生 shifts から算出)
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ShiftCalendar } from './ShiftCalendar';
import type { Shift, ShiftPreference, LeaveRequest, ShiftFrame, TenantMember } from '../../types';

const ME = 'me-user-id';
const OTHER = 'other-user-id';
const STORE = 'store-1';
// 当月内の固定日(テスト実行日に依存しないよう、テスト側で baseDate を明示指定する)。
const BASE_DATE = new Date('2026-08-15T00:00:00');
const DATE = '2026-08-15';

const membersById = new Map<string, TenantMember>([
  [ME, { id: 'm1', tenant_id: 't', user_id: ME, role: 'staff', display_name: '自分', legal_name: null, legal_name_kana: null, onboarded_at: null, hourly_rate: null, night_shift_enabled: null, is_parttime: null, pay_type: 'hourly', monthly_salary: null, paid_leave_days: null, role_id: null, created_at: '' }],
  [OTHER, { id: 'm2', tenant_id: 't', user_id: OTHER, role: 'staff', display_name: '他人', legal_name: null, legal_name_kana: null, onboarded_at: null, hourly_rate: null, night_shift_enabled: null, is_parttime: null, pay_type: 'hourly', monthly_salary: null, paid_leave_days: null, role_id: null, created_at: '' }],
]);

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

function makeLeave(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: 'leave-1',
    tenant_id: 't',
    user_id: ME,
    date: DATE,
    leave_type: 'paid',
    reason: null,
    status: 'approved',
    reviewed_by: null,
    reviewed_at: null,
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
    day_of_week: null,
    date: DATE,
    name: '早番',
    start_time: '10:00',
    end_time: '18:00',
    required_count: 2,
    sort_order: 0,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

afterEach(() => cleanup());

describe('ShiftCalendar mineOnly (機能1)', () => {
  it('mineOnly=false のときは自分/他人 両方のシフトバーが表示される', () => {
    render(
      <ShiftCalendar
        shifts={[makeShift({ id: 's-me', user_id: ME }), makeShift({ id: 's-other', user_id: OTHER })]}
        onDateClick={vi.fn()}
        currentUserId={ME}
        membersById={membersById}
        baseDate={BASE_DATE}
        mineOnly={false}
      />,
    );
    expect(screen.getAllByText('自分').length).toBeGreaterThan(0);
    expect(screen.getAllByText('他人').length).toBeGreaterThan(0);
  });

  it('mineOnly=true のときは他人のシフトバーが消え、自分のバーだけ残る', () => {
    render(
      <ShiftCalendar
        shifts={[makeShift({ id: 's-me', user_id: ME }), makeShift({ id: 's-other', user_id: OTHER })]}
        onDateClick={vi.fn()}
        currentUserId={ME}
        membersById={membersById}
        baseDate={BASE_DATE}
        mineOnly
      />,
    );
    expect(screen.getAllByText('自分').length).toBeGreaterThan(0);
    expect(screen.queryByText('他人')).toBeNull();
  });

  it('mineOnly=true のときは他人の希望バーも消える', () => {
    render(
      <ShiftCalendar
        shifts={[]}
        preferences={[
          makePreference({ id: 'p-me', user_id: ME }),
          makePreference({ id: 'p-other', user_id: OTHER }),
        ]}
        onDateClick={vi.fn()}
        currentUserId={ME}
        membersById={membersById}
        baseDate={BASE_DATE}
        mineOnly
      />,
    );
    expect(screen.getAllByText('自分').length).toBeGreaterThan(0);
    expect(screen.queryByText('他人')).toBeNull();
  });

  it('mineOnly=true のときは他人の出勤不可(休暇)マーカーも消える', () => {
    const { container } = render(
      <ShiftCalendar
        shifts={[]}
        leaves={[makeLeave({ id: 'l-me', user_id: ME }), makeLeave({ id: 'l-other', user_id: OTHER })]}
        onDateClick={vi.fn()}
        currentUserId={ME}
        membersById={membersById}
        baseDate={BASE_DATE}
        mineOnly
      />,
    );
    // 休暇 dot は member 名を持たない小さな span なので件数で検証する。
    const dots = container.querySelectorAll('.absolute.bottom-1.right-1 > span');
    expect(dots.length).toBe(1);
  });

  it('mineOnly=true でも status==="pending" の他人シフトは表示されない(常時表示例外より mineOnly が優先)', () => {
    render(
      <ShiftCalendar
        shifts={[
          makeShift({ id: 's-me-pending', user_id: ME, status: 'pending' }),
          makeShift({ id: 's-other-pending', user_id: OTHER, status: 'pending' }),
        ]}
        onDateClick={vi.fn()}
        currentUserId={ME}
        membersById={membersById}
        baseDate={BASE_DATE}
        statusFilter={new Set()}
        mineOnly
      />,
    );
    expect(screen.getAllByText('自分').length).toBeGreaterThan(0);
    expect(screen.queryByText('他人')).toBeNull();
  });

  it('currentUserId が null のときは mineOnly=true でも全件表示のまま(ガード)', () => {
    render(
      <ShiftCalendar
        shifts={[makeShift({ id: 's-me', user_id: ME }), makeShift({ id: 's-other', user_id: OTHER })]}
        onDateClick={vi.fn()}
        currentUserId={null}
        membersById={membersById}
        baseDate={BASE_DATE}
        mineOnly
      />,
    );
    expect(screen.getAllByText('自分').length).toBeGreaterThan(0);
    expect(screen.getAllByText('他人').length).toBeGreaterThan(0);
  });

  it('mineOnly=true でも枠の充足カウントは生 shifts から算出され、他人の割当も数える', () => {
    render(
      <ShiftCalendar
        shifts={[
          makeShift({ id: 's-me', user_id: ME, frame_id: 'frame-1', status: 'approved' }),
          makeShift({ id: 's-other', user_id: OTHER, frame_id: 'frame-1', status: 'approved' }),
        ]}
        onDateClick={vi.fn()}
        currentUserId={ME}
        membersById={membersById}
        baseDate={BASE_DATE}
        frames={[makeFrame()]}
        frameStoreId={STORE}
        canAssignFrames
        mineOnly
      />,
    );
    // 枠バーの aria-label に "配置2人/必要2人" が含まれる(mineOnly の影響を受けない = 2人のまま)。
    const frameBar = screen.getByRole('button', { name: /配置2人\/必要2人/ });
    expect(frameBar).toBeTruthy();
    // 枠グループ配下の member 行は mineOnly により自分だけ表示される。
    expect(screen.getAllByText('自分').length).toBeGreaterThan(0);
    expect(screen.queryByText('他人')).toBeNull();
  });
});

describe('ShiftCalendar 枠外しゾーン (T5 dnd-unassign)', () => {
  it('idle 時は「枠外へ」ゾーンが存在しない・既存の枠バー aria は非退行', () => {
    render(
      <ShiftCalendar
        shifts={[makeShift({ id: 's-me', user_id: ME, frame_id: 'frame-1', status: 'approved' })]}
        onDateClick={vi.fn()}
        currentUserId={ME}
        membersById={membersById}
        baseDate={BASE_DATE}
        frames={[makeFrame()]}
        frameStoreId={STORE}
        canAssignFrames
        onUnassignShiftFromFrame={vi.fn()}
      />,
    );
    expect(screen.queryByText('枠外へ')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: /配置1人\/必要2人/ })).toBeTruthy();
  });

  it('onUnassignShiftFromFrame 未指定でも DOM は同一(枠バー aria 取得・「枠外へ」なし)', () => {
    render(
      <ShiftCalendar
        shifts={[makeShift({ id: 's-me', user_id: ME, frame_id: 'frame-1', status: 'approved' })]}
        onDateClick={vi.fn()}
        currentUserId={ME}
        membersById={membersById}
        baseDate={BASE_DATE}
        frames={[makeFrame()]}
        frameStoreId={STORE}
        canAssignFrames
      />,
    );
    expect(screen.queryByText('枠外へ')).toBeNull();
    expect(screen.getByRole('button', { name: /配置1人\/必要2人/ })).toBeTruthy();
  });
});
