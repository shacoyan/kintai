export interface Tenant {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
  owner_id: string;
}

export interface TenantMember {
  id: string;
  tenant_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'staff';
  display_name: string;
  hourly_rate: number | null;
  night_shift_enabled: boolean | null;
  pay_type: 'hourly' | 'monthly';
  monthly_salary: number | null;
  paid_leave_days: number | null;
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
  breaks?: Break[];
}

export type UserRole = 'owner' | 'admin' | 'staff';

export interface UserProfile {
  user_id: string;
  email: string;
  tenants: TenantWithRole[];
}

export interface TenantWithRole extends Tenant {
  role: UserRole;
  display_name: string;
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
}

export type LeaveType = 'paid' | 'half_paid' | 'absence' | 'other';

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
  created_at: string;
}

export interface ShiftPreset {
  id: string;
  tenant_id: string;
  name: string;
  start_time: string;
  end_time: string;
  sort_order: number;
  created_at: string;
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
}
