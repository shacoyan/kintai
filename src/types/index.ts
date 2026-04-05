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
  hourly_rate: number;
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
  /** @deprecated Use breaks table instead */
  break_start: string | null;
  /** @deprecated Use breaks table instead */
  break_end: string | null;
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

export interface CorrectionRequest {
  id: string;
  tenant_id: string;
  user_id: string;
  date: string;
  attendance_record_id: string | null;
  requested_clock_in: string | null;
  requested_clock_out: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}
