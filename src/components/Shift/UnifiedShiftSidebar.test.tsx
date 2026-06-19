// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { UnifiedShiftSidebar } from './UnifiedShiftSidebar';
import type { UnifiedShiftSidebarProps } from './UnifiedShiftSidebar';
import type { Shift, ShiftPreference } from '../../types';

// 子コンポーネント(ShiftPreferenceForm / AddMemberShiftForm 等)は本テストの対象外。
// 「あなたの申請」セクションの自己仮承認導線(Batch C で消えた regression の復旧)だけを固定する。

const ME = 'me-user-id';
const DATE = '2026-06-20';
const STORE = 'store-1';

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    tenant_id: 't',
    user_id: ME,
    date: DATE,
    start_time: '10:00',
    end_time: '18:00',
    status: 'pending',
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

function baseProps(overrides: Partial<UnifiedShiftSidebarProps> = {}): UnifiedShiftSidebarProps {
  return {
    mode: 'manager',
    selectedDate: DATE,
    onSelectedDateChange: vi.fn(),
    shifts: [],
    preferences: [],
    myPreferences: [],
    memberNames: new Map(),
    storeNames: new Map(),
    onTentativeApproveShift: vi.fn().mockResolvedValue(undefined),
    onApprovePreference: vi.fn().mockResolvedValue(undefined),
    onRejectPreference: vi.fn().mockResolvedValue(undefined),
    canManageStore: () => true,
    currentUserId: ME,
    presets: [],
    stores: [{ id: STORE, tenant_id: 't', name: 'Store 1', created_at: '' }],
    defaultStoreId: STORE,
    onMutated: vi.fn(),
    ...overrides,
  };
}

afterEach(() => cleanup());

describe('UnifiedShiftSidebar 自己仮承認導線 (Bug #2 復旧)', () => {
  it('owner/manager: 自分の pending シフトに「自分で仮承認」ボタンが出る', () => {
    render(<UnifiedShiftSidebar {...baseProps({ shifts: [makeShift({ status: 'pending' })] })} />);
    expect(screen.getByTestId('self-tentative-approve')).toBeTruthy();
  });

  it('owner/manager: 自分の pending preferred 希望に「自分で仮承認」ボタンが出る', () => {
    render(
      <UnifiedShiftSidebar
        {...baseProps({ myPreferences: [makePreference({ status: 'pending', preference_type: 'preferred' })] })}
      />,
    );
    expect(screen.getByTestId('self-tentative-approve')).toBeTruthy();
  });

  it('一般スタッフ(canManageStore=false): 自己仮承認ボタンは出ない', () => {
    render(
      <UnifiedShiftSidebar
        {...baseProps({
          canManageStore: () => false,
          shifts: [makeShift({ status: 'pending' })],
          myPreferences: [makePreference()],
        })}
      />,
    );
    expect(screen.queryByTestId('self-tentative-approve')).toBeNull();
  });

  it('approved 済みシフトには自己仮承認ボタンを出さない', () => {
    render(<UnifiedShiftSidebar {...baseProps({ shifts: [makeShift({ status: 'approved' })] })} />);
    expect(screen.queryByTestId('self-tentative-approve')).toBeNull();
  });

  it('ボタン押下で onTentativeApproveShift と onMutated が呼ばれる', async () => {
    const onTentativeApproveShift = vi.fn().mockResolvedValue(undefined);
    const onMutated = vi.fn();
    render(
      <UnifiedShiftSidebar
        {...baseProps({ shifts: [makeShift({ id: 's9', status: 'pending' })], onTentativeApproveShift, onMutated })}
      />,
    );
    fireEvent.click(screen.getByTestId('self-tentative-approve'));
    await vi.waitFor(() => {
      expect(onTentativeApproveShift).toHaveBeenCalledWith('s9');
      expect(onMutated).toHaveBeenCalled();
    });
  });
});
