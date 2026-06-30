// =============================================================================
// Phase 0 — can() 網羅パリティ単体テスト（本番ゲート相当）
// 設計書: .company/engineering/docs/2026-06-29-kintai-permissions-phase0-can.md §7
//
// 目的: 全 capability × 全 role/context/args の直積で、旧インライン条件（oracle）と
//   can() の bool が完全一致することを固定する。1件でも不一致 = 挙動が変わった証拠。
//
// oracle は §4「現行条件式」を逐語コピーした参照実装。can 実装とは独立に書くことで
// 「同じバグを両方に書く」を防ぐ。
// =============================================================================

import { describe, it, expect } from 'vitest';
import { can, ALL_CAPABILITIES, type Capability, type PermissionContext } from './can';
import type { UserRole } from '../../types';

const ROLES: (UserRole | null)[] = ['owner', 'manager', 'staff', null];
const PARTTIMES = [true, false];
const USER_IDS: (string | null)[] = ['U1', null];
const MY_STORE_IDS: string[][] = [[], ['S1'], ['S1', 'S2']];
const MANAGED_STORE_IDS: string[][] = [[], ['S1']];
const ASSIGNEES: (string[] | null)[] = [[], ['U1'], ['U2'], null];
const STORE_IDS: (string | null)[] = [null, 'S1', 'S9'];

function makeCtx(over: Partial<PermissionContext>): PermissionContext {
  return {
    role: 'staff',
    isParttime: false,
    userId: null,
    myStoreIds: [],
    managedStoreIds: [],
    ...over,
  };
}

// ── oracle 群（§4 現行条件式の逐語移植）───────────────────────────────
const managerial = (role: UserRole | null): boolean => role === 'owner' || role === 'manager';

// 引数なし capability の oracle（ctx → boolean）。
const noArgOracles: Record<string, (ctx: PermissionContext) => boolean> = {
  accessAdmin: (c) => c.role === 'owner' || c.role === 'manager',
  viewManagerialNav: (c) => c.role === 'owner' || c.role === 'manager',
  manageMembers: (c) => c.role === 'owner' || c.role === 'manager',
  toggleMemberRole: (c) => c.role === 'owner',
  toggleMemberParttime: (c) => c.role !== 'staff', // disabled の isStaffViewer 否定
  assignStoreManager: (c) => c.role === 'owner',
  viewOwnerDashboardOps: (c) => c.role === 'owner',
  manageTenantSettings: (c) => c.role === 'owner' || c.role === 'manager',
  editShiftDeadline: (c) => c.role === 'owner' || c.role === 'manager',
  finalizePayroll: (c) => c.role === 'owner' || c.role === 'manager',
  unfinalizePayroll: (c) => c.role === 'owner',
  editMemberStorePayroll: (c) => c.role === 'owner' || c.role === 'manager',
  viewManagerialReports: (c) => c.role === 'owner' || c.role === 'manager',
  viewAllStaffShifts: (c) => c.role === 'owner' || c.role === 'manager',
  switchAttendanceUser: (c) => c.role === 'owner' || c.role === 'manager',
  showRoleBadge: (c) => c.role === 'owner' || c.role === 'manager',
  manageTasks: (c) => c.role === 'owner' || c.role === 'manager',
  manageProjects: (c) => c.role === 'owner' || c.role === 'manager',
  isTaskReadonly: (c) => c.isParttime,
  forceMineOnlyTasks: (c) => c.isParttime,
  canDeleteProject: (c) => !c.isParttime && managerial(c.role),
  viewAllSales: (c) => c.role === 'owner' || c.role === 'manager',
  viewAllReportStores: (c) => c.role === 'owner' || c.role === 'manager',
  manageViewScopes: (c) => c.role === 'owner', // C27 閲覧範囲設定（Phase2）= owner のみ
};

describe('can() — role 基底（引数なし）capability パリティ', () => {
  for (const [cap, oracle] of Object.entries(noArgOracles)) {
    describe(cap, () => {
      for (const role of ROLES) {
        for (const isParttime of PARTTIMES) {
          it(`role=${role} parttime=${isParttime}`, () => {
            const ctx = makeCtx({ role, isParttime });
            expect(can(cap as Exclude<Capability, 'canActOnTask' | 'canEditProject' | 'isManagerOfStore'>, ctx)).toBe(
              oracle(ctx),
            );
          });
        }
      }
    });
  }
});

describe('can() — C21 canActOnTask パリティ（args 直積）', () => {
  // oracle: canManage || (!!userId && (assigneeUserIds ?? []).includes(userId))
  for (const role of ROLES) {
    for (const userId of USER_IDS) {
      for (const assigneeUserIds of ASSIGNEES) {
        it(`role=${role} userId=${userId} assignees=${JSON.stringify(assigneeUserIds)}`, () => {
          const ctx = makeCtx({ role, userId });
          const oracle =
            managerial(role) || (!!userId && (assigneeUserIds ?? []).includes(userId));
          expect(can('canActOnTask', ctx, { assigneeUserIds })).toBe(oracle);
        });
      }
    }
  }
});

describe('can() — C22 canEditProject パリティ（args 直積）', () => {
  // oracle: readonly→false; managerial→true; staff→ storeId!==null && myStoreIds.includes(storeId); else false
  for (const role of ROLES) {
    for (const isParttime of PARTTIMES) {
      for (const myStoreIds of MY_STORE_IDS) {
        for (const storeId of STORE_IDS) {
          it(`role=${role} parttime=${isParttime} myStores=${JSON.stringify(myStoreIds)} storeId=${storeId}`, () => {
            const ctx = makeCtx({ role, isParttime, myStoreIds });
            let oracle: boolean;
            if (isParttime) oracle = false;
            else if (managerial(role)) oracle = true;
            else if (role === 'staff') oracle = storeId !== null && myStoreIds.includes(storeId);
            else oracle = false;
            expect(can('canEditProject', ctx, { storeId })).toBe(oracle);
          });
        }
      }
    }
  }
});

describe('can() — C24 isManagerOfStore パリティ（args 直積）', () => {
  // oracle: owner→true; manager→managedStoreIds.includes(storeId); else false
  for (const role of ROLES) {
    for (const managedStoreIds of MANAGED_STORE_IDS) {
      for (const storeId of STORE_IDS) {
        it(`role=${role} managed=${JSON.stringify(managedStoreIds)} storeId=${storeId}`, () => {
          const ctx = makeCtx({ role, managedStoreIds });
          let oracle: boolean;
          if (role === 'owner') oracle = true;
          else if (role === 'manager') oracle = storeId !== null && managedStoreIds.includes(storeId);
          else oracle = false;
          expect(can('isManagerOfStore', ctx, { storeId })).toBe(oracle);
        });
      }
    }
  }
});

describe('網羅性ガード — 全 capability が ALL_CAPABILITIES と一致し検証される', () => {
  it('ALL_CAPABILITIES に重複なし', () => {
    expect(new Set(ALL_CAPABILITIES).size).toBe(ALL_CAPABILITIES.length);
  });

  it('全 capability が本テストで検証されている（取りこぼし検出）', () => {
    const tested = new Set<string>([
      ...Object.keys(noArgOracles),
      'canActOnTask',
      'canEditProject',
      'isManagerOfStore',
    ]);
    const missing = ALL_CAPABILITIES.filter((c) => !tested.has(c));
    expect(missing).toEqual([]);
    // 逆方向: テスト対象が ALL_CAPABILITIES に存在する（綴り違い検出）。
    const extra = [...tested].filter((c) => !ALL_CAPABILITIES.includes(c as Capability));
    expect(extra).toEqual([]);
  });
});
