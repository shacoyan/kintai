// =============================================================================
// Phase 0 — 権限判定の単一窓口（純関数 can）
// 設計書: .company/engineering/docs/2026-06-29-kintai-permissions-phase0-can.md
//
// 【鉄則】挙動を1ミリも変えない（behavior-identical）。
//   各 capability の本体は、現行フロントのインライン条件を「逐語移植」したもの。
//   新ロジック・新しい短絡順・新しい null 扱いを一切入れない。
//
// 【DB 強制について（Phase0 はフロント表示判定の集約のみ・DB は不変）】
//   ここで返す bool は「表示/操作の UI 可否」。実データ保護は別途 DB 側で強制済:
//     - members 昇格/降格・店長任命: migration 082（書込 RLS）
//     - payroll finalize/unfinalize: RPC（087/090）
//     - 給与/本名表示: VIEW089 + RLS
//     - タスク/PJ: migration 058 / 076 RLS
//     - shifts/勤怠 tenant-wide SELECT (C14/C15): ⚠️ 現状 UI のみ・Phase1 で RLS 化予定
//   Phase0 では DB を一切変更しない。can() は現行インライン条件の bool を返すだけ。
// =============================================================================

import type { UserRole } from '../../types';

// 権限判定に必要な最小コンテキスト（TenantContext / StoreContext の現フィールド写像）。
// isOwner/isManager/isStaff は role から導出するため ctx に含めない（単一の真実源 = role）。
export interface PermissionContext {
  role: UserRole | null;
  isParttime: boolean;
  userId: string | null | undefined;
  myStoreIds: string[];
  managedStoreIds: string[];
}

// 引数あり capability の args 型（capability 別に discriminated）。
export interface CanActOnTaskArgs {
  assigneeUserIds: string[] | null | undefined;
}
export interface StoreScopedArgs {
  storeId: string | null;
}

// capability 名の union（設計 §5.3）。
export type Capability =
  | 'accessAdmin'
  | 'viewManagerialNav'
  | 'manageMembers'
  | 'toggleMemberRole'
  | 'toggleMemberParttime'
  | 'assignStoreManager'
  | 'viewOwnerDashboardOps'
  | 'manageTenantSettings'
  | 'editShiftDeadline'
  | 'finalizePayroll'
  | 'unfinalizePayroll'
  | 'editMemberStorePayroll'
  | 'viewManagerialReports'
  | 'viewAllStaffShifts'
  | 'switchAttendanceUser'
  | 'showRoleBadge'
  | 'manageTasks'
  | 'manageProjects'
  | 'isTaskReadonly'
  | 'forceMineOnlyTasks'
  | 'canActOnTask'
  | 'canEditProject'
  | 'canDeleteProject'
  | 'isManagerOfStore'
  | 'viewAllSales'
  | 'viewAllReportStores';

// 引数を取らない capability。
export type NoArgCapability = Exclude<
  Capability,
  'canActOnTask' | 'canEditProject' | 'isManagerOfStore'
>;

// 共通の役割述語（現行式の逐語移植のための内部ヘルパ）。
// 「myRole === 'owner' || myRole === 'manager'」が現行で多用される managerial 述語。
function isManagerial(role: UserRole | null): boolean {
  return role === 'owner' || role === 'manager';
}

// オーバーロード: args 不要 capability には args を渡せない / 必要 capability は必須。
export function can(capability: NoArgCapability, ctx: PermissionContext): boolean;
export function can(capability: 'canActOnTask', ctx: PermissionContext, args: CanActOnTaskArgs): boolean;
export function can(capability: 'canEditProject', ctx: PermissionContext, args: StoreScopedArgs): boolean;
export function can(capability: 'isManagerOfStore', ctx: PermissionContext, args: StoreScopedArgs): boolean;
export function can(
  capability: Capability,
  ctx: PermissionContext,
  args?: CanActOnTaskArgs | StoreScopedArgs,
): boolean {
  const { role, isParttime, userId, myStoreIds, managedStoreIds } = ctx;

  switch (capability) {
    // ── role 基底（引数なし）─────────────────────────────────────────
    // C1 accessAdmin: AdminPage.tsx:19（否定形 myRole!=='owner'&&!=='manager' で Navigate）
    case 'accessAdmin':
      return role === 'owner' || role === 'manager';

    // C2 viewManagerialNav: Sidebar.tsx / BottomNav.tsx（isManagerial）
    case 'viewManagerialNav':
      return role === 'owner' || role === 'manager';

    // C3 manageMembers: MemberManagement.tsx:286（!owner&&!manager で return null）
    case 'manageMembers':
      return role === 'owner' || role === 'manager';

    // C4 toggleMemberRole: MemberManagement.tsx:401,689 の閲覧者側 myRole === 'owner'。
    //   ※対象メンバー側の `member.role !== 'owner'` は呼び出し側のローカル条件として残す（§4.5）。
    case 'toggleMemberRole':
      return role === 'owner';

    // C5 toggleMemberParttime: MemberManagement.tsx:369-371,794-796。
    //   現行 disabled = isStaffViewer || isSelf || member.role==='owner'、
    //   isStaffViewer = (myRole === 'staff')。閲覧者側の役割述語のみ = role !== 'staff'。
    //   ※isSelf / member.role==='owner' は呼び出し側ローカルのまま（§4.5）。
    case 'toggleMemberParttime':
      return role !== 'staff';

    // C6 assignStoreManager: StoreManagement.tsx:31,199（isOwner。disabled=!isOwner）
    case 'assignStoreManager':
      return role === 'owner';

    // C7 viewOwnerDashboardOps: DashboardPage.tsx:128（isOwnerView）
    case 'viewOwnerDashboardOps':
      return role === 'owner';

    // C8 manageTenantSettings: InviteCodeSettingsSection.tsx:55 / InviteUrlIssueModal.tsx:67
    //   （canManageInvite / canIssue = isOwner || isManager）
    case 'manageTenantSettings':
      return role === 'owner' || role === 'manager';

    // C9 editShiftDeadline: AdminDashboard.tsx:158 / useShiftSubmissionDeadline.ts:38
    //   （canEditDeadline / canEdit = isOwner || myRole === 'manager'）
    case 'editShiftDeadline':
      return role === 'owner' || role === 'manager';

    // C10 finalizePayroll: PayrollCalculation.tsx:608（myRole === 'owner' || myRole === 'manager'）
    //   ※UI 状態 !isFinalized && calculated && hasData は呼び出し側に残す。
    case 'finalizePayroll':
      return role === 'owner' || role === 'manager';

    // C11 unfinalizePayroll: PayrollCalculation.tsx:622（myRole === 'owner'）
    //   ※isFinalized は呼び出し側。
    case 'unfinalizePayroll':
      return role === 'owner';

    // C12 editMemberStorePayroll: MemberStorePayrollModal.tsx:60（canEdit）
    case 'editMemberStorePayroll':
      return role === 'owner' || role === 'manager';

    // C13 viewManagerialReports: MonthlyReportPanel.tsx:38（isManagerial）
    case 'viewManagerialReports':
      return role === 'owner' || role === 'manager';

    // C14 viewAllStaffShifts: ShiftPage.tsx:58（canManageTenant）⚠️ UI のみ・Phase1 で RLS 化予定
    case 'viewAllStaffShifts':
      return role === 'owner' || role === 'manager';

    // C15 switchAttendanceUser: HistoryPage.tsx:365（canSwitchUser = isOwner || myRole === 'manager'）
    //   ⚠️ UI のみ・Phase1 で RLS 化予定
    case 'switchAttendanceUser':
      return role === 'owner' || role === 'manager';

    // C16 showRoleBadge: UserMenuPopover.tsx:115（myRole === 'owner' || myRole === 'manager'）
    //   ※call site の `showRoleBadge` prop（UI 状態）は呼び出し側に残す。
    case 'showRoleBadge':
      return role === 'owner' || role === 'manager';

    // C17 manageTasks: TasksPage.tsx:156 / KanbanBoard.tsx:61 / kanbanTransition.ts:104（canManage / managerial）
    case 'manageTasks':
      return role === 'owner' || role === 'manager';

    // C18 manageProjects: ProjectsPage.tsx:136（managerial）
    case 'manageProjects':
      return role === 'owner' || role === 'manager';

    // C19 isTaskReadonly: ProjectsPage.tsx:137 / TasksPage.tsx（readonly = isParttime）
    case 'isTaskReadonly':
      return isParttime;

    // C20 forceMineOnlyTasks: TasksPage.tsx:176（effectiveMineOnly の強制 ON 側 = isParttime）
    case 'forceMineOnlyTasks':
      return isParttime;

    // C21 canActOnTask(args): TasksPage.tsx:529-534
    //   canManage || (!!user?.id && (assignee_user_ids ?? []).includes(user.id))。
    //   現行は: if (canManage) return true; if (!user?.id) return false; return includes。
    case 'canActOnTask': {
      const { assigneeUserIds } = args as CanActOnTaskArgs;
      if (isManagerial(role)) return true;
      if (!userId) return false;
      return (assigneeUserIds ?? []).includes(userId);
    }

    // C22 canEditProject(args): ProjectsPage.tsx:319-330
    //   if (readonly) return false; if (managerial) return true;
    //   if (myRole==='staff') return storeId!==null && myStoreIds.includes(storeId); return false。
    case 'canEditProject': {
      const { storeId } = args as StoreScopedArgs;
      if (isParttime) return false; // readonly = isParttime
      if (isManagerial(role)) return true;
      if (role === 'staff') {
        return storeId !== null && myStoreIds.includes(storeId);
      }
      return false;
    }

    // C23 canDeleteProject: ProjectsPage.tsx:339-345
    //   if (readonly) return false; if (isParttime) return false; return managerial。
    //   = !isParttime && managerial。
    case 'canDeleteProject':
      return !isParttime && isManagerial(role);

    // C24 isManagerOfStore(args): StoreContext.tsx:209-213（isManagerOf）
    //   if (isOwner) return true; if (myRole==='manager') return managedStoreIds.includes(storeId); return false。
    case 'isManagerOfStore': {
      const { storeId } = args as StoreScopedArgs;
      if (role === 'owner') return true;
      if (role === 'manager') return storeId !== null && managedStoreIds.includes(storeId);
      return false;
    }

    // C25 viewAllSales: useSalesScope.ts:39（canViewAll = isOwner || isManager）
    //   ※allowedLocationNames 算出（fetch + intersection）は hook 側に据え置き。
    case 'viewAllSales':
      return role === 'owner' || role === 'manager';

    // C26 viewAllReportStores: useReportStores.ts:30（isManagerial）
    //   ※fetch ロジックは hook 側に据え置き。
    case 'viewAllReportStores':
      return role === 'owner' || role === 'manager';

    default: {
      // 網羅性ガード（union 追加忘れを型でも検出）。
      const _exhaustive: never = capability;
      return _exhaustive;
    }
  }
}

// テスト/網羅性ガード用: 全 capability 名の配列（can.test.ts が網羅性を assert）。
export const ALL_CAPABILITIES: Capability[] = [
  'accessAdmin',
  'viewManagerialNav',
  'manageMembers',
  'toggleMemberRole',
  'toggleMemberParttime',
  'assignStoreManager',
  'viewOwnerDashboardOps',
  'manageTenantSettings',
  'editShiftDeadline',
  'finalizePayroll',
  'unfinalizePayroll',
  'editMemberStorePayroll',
  'viewManagerialReports',
  'viewAllStaffShifts',
  'switchAttendanceUser',
  'showRoleBadge',
  'manageTasks',
  'manageProjects',
  'isTaskReadonly',
  'forceMineOnlyTasks',
  'canActOnTask',
  'canEditProject',
  'canDeleteProject',
  'isManagerOfStore',
  'viewAllSales',
  'viewAllReportStores',
];
