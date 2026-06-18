export interface Tenant {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
  owner_id: string;
  deleted_at: string | null;
  invite_code_expires_at?: string | null;
  invite_code_max_uses?: number | null;
  invite_code_used_count?: number;
}

export interface TenantMember {
  id: string;
  tenant_id: string;
  user_id: string;
  role: 'owner' | 'manager' | 'staff';
  display_name: string;
  legal_name: string | null;
  onboarded_at: string | null;
  hourly_rate: number | null;
  night_shift_enabled: boolean | null;
  is_parttime: boolean | null;
  pay_type: 'hourly' | 'monthly';
  monthly_salary: number | null;
  paid_leave_days: number | null;
  role_id: string | null;
  created_at: string;
}

export interface TenantRole {
  id: string;
  tenant_id: string;
  name: string;
  default_hourly_rate: number | null;
  default_monthly_salary: number | null;
  color: string | null;
  sort_order: number;
  created_at: string;
}

export interface Break {
  id: string;
  attendance_record_id: string;
  start_time: string;
  end_time: string | null;
  created_at: string;
}

export interface AttendanceRecord {
  id: string;
  tenant_id: string;
  user_id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  total_work_minutes: number | null;
  note: string | null;
  created_at: string;
  store_id: string | null;
  breaks?: Break[];
}

export type UserRole = 'owner' | 'manager' | 'staff';

export interface UserProfile {
  user_id: string;
  email: string;
  tenants: TenantWithRole[];
}

export interface TenantWithRole extends Tenant {
  role: UserRole;
  display_name: string;
  member_id: string;
}

export interface Shift {
  id: string;
  tenant_id: string;
  user_id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: 'pending' | 'tentative' | 'approved' | 'rejected' | 'modified' | 'cancelled';
  original_start_time: string | null;
  original_end_time: string | null;
  note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  tentative_approved_by: string | null;
  tentative_approved_at: string | null;
  store_id: string | null;
  // 096: 承認元の希望 id。revert/approve が時刻ではなく id で厳密に当該仮承認シフトを扱う。
  preference_id: string | null;
}

export type LeaveType =
  | 'paid' | 'half_am' | 'half_pm' | 'absence' | 'other'
  | 'special' | 'maternity' | 'paternity' | 'compassionate' | 'comp_holiday';

export interface LeaveRequest {
  id: string;
  tenant_id: string;
  user_id: string;
  date: string;
  leave_type: LeaveType;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note?: string | null;
  created_at: string;
  store_id: string | null;
}

export interface ShiftPreset {
  id: string;
  tenant_id: string;
  name: string;
  start_time: string;
  end_time: string;
  sort_order: number;
  created_at: string;
  store_id: string | null;
}

export interface CorrectionRequest {
  id: string;
  tenant_id: string;
  user_id: string;
  date: string;
  attendance_record_id: string | null;
  requested_clock_in: string | null;
  requested_clock_out: string | null;
  reason: string;
  request_type: 'correction' | 'delete';
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  store_id: string | null;
}

export interface Store {
  id: string;
  tenant_id: string;
  name: string;
  created_at: string;
}

export interface StoreMember {
  id: string;
  store_id: string;
  member_id: string;
  is_primary: boolean;
  is_manager: boolean;
  created_at: string;
}

// 店舗別人件費 (Phase 1a)
// 該当 (user_id, store_id) 行が存在しない場合は tenant_members.hourly_rate /
// monthly_salary をフォールバックとして使用する。
export interface MemberStorePayroll {
  id: string;
  tenant_id: string;
  user_id: string;
  store_id: string;
  pay_type: 'hourly' | 'monthly';
  hourly_rate: number | null;
  monthly_salary: number | null;
  night_shift_rate_multiplier: number;
  created_at: string;
  updated_at: string;
}

export interface MemberStorePayrollUpsertPayload {
  tenant_id: string;
  user_id: string;
  store_id: string;
  pay_type: 'hourly' | 'monthly';
  hourly_rate?: number | null;
  monthly_salary?: number | null;
  night_shift_rate_multiplier?: number;
}

export interface MemberStoreRate {
  pay_type: 'hourly' | 'monthly';
  hourly_rate: number | null;
  monthly_salary: number | null;
  night_shift_rate_multiplier: number;
  // どこから値を取ったか (デバッグ/UI 表示用)
  source: 'store_override' | 'member_default';
}

export type ShiftPreferenceType = 'preferred' | 'unavailable';

export interface ShiftPreference {
  id: string;
  tenant_id: string;
  user_id: string;
  date: string;
  preference_type: ShiftPreferenceType;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  store_id: string | null;
}

// === Loop 7 (Engineer A) ===
export interface PayrollRun {
  id: string;
  tenant_id: string;
  store_id: string | null;
  target_month: string;       // YYYY-MM-01
  close_day: number;
  period_start: string;
  period_end: string;
  mode: 'actual' | 'shift';
  total_payment: number;
  finalized_at: string;
  finalized_by: string | null;
  note: string | null;
}

export interface PayrollRunItem {
  id: string;
  run_id: string;
  user_id: string;
  display_name: string;
  pay_type: 'hourly' | 'monthly';
  hourly_rate: number;
  monthly_salary: number;
  work_days: number;
  normal_minutes: number;
  night_minutes: number;
  payment: number;
}

// === Loop 11b L11b-1 (Engineer A) — in-app 通知 ===
export type NotificationType =
  | 'shift_approved'
  | 'shift_rejected'
  | 'preference_approved'
  | 'preference_rejected'
  | 'preference_reverted'
  | 'preference_unavailable_submitted'
  | 'correction_approved'
  | 'correction_rejected'
  | 'leave_approved'
  | 'leave_rejected'
  | 'generic';

export interface NotificationItem {
  id: string;
  tenant_id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

// === 2026-05-12 per-store invite URL (Loop) ===
// 設計書: .company/engineering/docs/2026-05-12-kintai-invite-url-per-store-techdesign.md §7.1
export interface InviteCode {
  id: string;
  tenant_id: string;
  code: string;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  created_by: string;
  created_at: string;
  revoked_at: string | null;
  label: string | null;
  stores: InviteCodeStore[]; // join 済みリスト (TenantContext で composition)
}

export interface InviteCodeStore {
  store_id: string;
  store_name: string;
  sort_order: number;
}

export interface IssueInviteCodeOptions {
  expiresInDays: 1 | 7 | 30 | null;
  maxUses: 1 | 3 | 10 | null;
  storeIds: string[];
  label?: string | null;
}

export interface UpdateInviteCodeOptions {
  expiresInDays?: 1 | 7 | 30 | null;
  maxUses?: 1 | 3 | 10 | null;
  storeIds?: string[]; // undefined=保持, []=全削除, [...]=置換
  label?: string | null;
}

// === 2026-05-13 一括シフト申請 (Engineer A) ===
// 設計書: .company/engineering/docs/2026-05-13-kintai-bulk-shift-preference-techdesign.md §6.1 / §9 Engineer A
export interface BulkSubmitPreferenceArgs {
  dates: string[];                       // 'YYYY-MM-DD'[]
  type: 'preferred' | 'unavailable';
  startTime: string | null;              // preferred のみ意味あり ('HH:mm' or 'HH:mm:ss')
  endTime: string | null;
  presetId?: string | null;              // 利用元プリセット ID（任意・将来監査用）
}

export interface BulkSubmitResult {
  successCount: number;
  failedDates: string[];
  lockedDates: string[];   // 承認済 preferred で事前除外された日付
}

// === 2026-05-22 タスク管理 Phase 1 (Engineer C / Loop 3) ===
// 設計書: .company/engineering/docs/2026-05-22-kintai-task-management-phase1-techdesign.md §7-Loop-3
import type { Database } from './supabase';

// --- Task ---
// status は CHECK 制約 ('todo' | 'in_progress' | 'done' | 'cancelled') があるため
// supabase 生成型 (`string`) より narrow な union 型を別途定義する
export type TaskRow = Database['public']['Tables']['tasks']['Row'];
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
// priority は SMALLINT (0=low / 1=normal / 2=high / 3=urgent) CHECK BETWEEN 0 AND 3
export type TaskPriority = 0 | 1 | 2 | 3;

// task_assignees 中間テーブル (067)。tasks.assignee_user_id は primary (後方互換) として残置。
export type TaskAssigneeRow = Database['public']['Tables']['task_assignees']['Row'];

export type Task = Omit<TaskRow, 'status' | 'priority'> & {
  status: TaskStatus;
  priority: TaskPriority;
  // task_assignees から集約した担当者 user_id 配列 (created_at 昇順)。
  // DB Row には無い派生フィールド。useTasks が詰める。空配列 = 未割当。
  assignee_user_ids: string[];
  // ▼ 068 子タスク: parent_task_id は TaskRow に含まれる (生成型)。
  // subtask_total/done は DB 列ではない派生フィールド (親のみ意味を持つ。useTasks が集計して詰める)。
  subtask_total?: number; // 子タスク総数 (cancelled 含む。分母除外したい場合は useTasks 集計を参照)
  subtask_done?: number; // 完了 (status==='done') の子タスク数
};
export type TaskInsert = Omit<Database['public']['Tables']['tasks']['Insert'], 'status' | 'priority'> & {
  status?: TaskStatus;
  priority?: TaskPriority;
};
export type TaskUpdate = Omit<Database['public']['Tables']['tasks']['Update'], 'status' | 'priority'> & {
  status?: TaskStatus;
  priority?: TaskPriority;
};

// --- Project ---
// status は CHECK 制約 ('active' | 'archived') があるため narrow 化
export type ProjectRow = Database['public']['Tables']['projects']['Row'];
export type ProjectStatus = 'active' | 'archived';

export type Project = Omit<ProjectRow, 'status'> & { status: ProjectStatus };
export type ProjectInsert = Omit<Database['public']['Tables']['projects']['Insert'], 'status'> & {
  status?: ProjectStatus;
};
export type ProjectUpdate = Omit<Database['public']['Tables']['projects']['Update'], 'status'> & {
  status?: ProjectStatus;
};

// --- ラベル定数 (UI 表示用) ---
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  0: '低',
  1: '通常',
  2: '高',
  3: '緊急',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '未着手',
  in_progress: '進行中',
  done: '完了',
  cancelled: 'キャンセル',
};
