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
  status: 'pending' | 'approved' | 'rejected' | 'modified' | 'cancelled';
  original_start_time: string | null;
  original_end_time: string | null;
  note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  store_id: string | null;
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
