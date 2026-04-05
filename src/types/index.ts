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
  created_at: string;
}

export interface AttendanceRecord {
  id: string;
  tenant_id: string;
  user_id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  break_start: string | null;
  break_end: string | null;
  total_work_minutes: number | null;
  note: string | null;
  created_at: string;
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
