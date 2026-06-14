import { describe, it, expect } from 'vitest';
import {
  getEffectiveHourlyRate,
  getEffectiveMonthlySalary,
  getMemberPayrollForStore,
} from './payrollCalc';
import type { TenantMember, TenantRole, MemberStorePayroll } from '../types';

const TENANT = 't1';
const STORE = 's1';
const USER = 'u1';
const ROLE = 'r1';

function member(over: Partial<TenantMember> = {}): TenantMember {
  return {
    id: 'm1',
    tenant_id: TENANT,
    user_id: USER,
    role: 'staff',
    display_name: 'Test',
    legal_name: null,
    onboarded_at: null,
    hourly_rate: null,
    night_shift_enabled: true,
    is_parttime: true,
    pay_type: 'hourly',
    monthly_salary: null,
    paid_leave_days: null,
    role_id: ROLE,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function role(over: Partial<TenantRole> = {}): TenantRole {
  return {
    id: ROLE,
    tenant_id: TENANT,
    name: 'スタッフ',
    default_hourly_rate: null,
    default_monthly_salary: null,
    color: null,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function payroll(over: Partial<MemberStorePayroll> = {}): MemberStorePayroll {
  return {
    id: 'p1',
    tenant_id: TENANT,
    user_id: USER,
    store_id: STORE,
    pay_type: 'hourly',
    hourly_rate: null,
    monthly_salary: null,
    night_shift_rate_multiplier: 1.25,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('getEffectiveHourlyRate (member → role default → 0)', () => {
  it('member.hourly_rate 優先', () => {
    const roles = new Map([[ROLE, role({ default_hourly_rate: 1500 })]]);
    expect(getEffectiveHourlyRate(member({ hourly_rate: 1200 }), roles)).toBe(1200);
  });
  it('member null → role.default_hourly_rate', () => {
    const roles = new Map([[ROLE, role({ default_hourly_rate: 1500 })]]);
    expect(getEffectiveHourlyRate(member({ hourly_rate: null }), roles)).toBe(1500);
  });
  it('両方 null → 0', () => {
    const roles = new Map([[ROLE, role({ default_hourly_rate: null })]]);
    expect(getEffectiveHourlyRate(member({ hourly_rate: null }), roles)).toBe(0);
  });
  it('rolesMap 無し → member のみ', () => {
    expect(getEffectiveHourlyRate(member({ hourly_rate: 1100 }))).toBe(1100);
    expect(getEffectiveHourlyRate(member({ hourly_rate: null }))).toBe(0);
  });
  it('member.hourly_rate=0 は明示値として採用（null とは区別）', () => {
    const roles = new Map([[ROLE, role({ default_hourly_rate: 1500 })]]);
    expect(getEffectiveHourlyRate(member({ hourly_rate: 0 }), roles)).toBe(0);
  });
});

describe('getEffectiveMonthlySalary (member → role default → 0)', () => {
  it('member.monthly_salary 優先', () => {
    const roles = new Map([[ROLE, role({ default_monthly_salary: 300000 })]]);
    expect(getEffectiveMonthlySalary(member({ monthly_salary: 250000 }), roles)).toBe(250000);
  });
  it('member null → role default', () => {
    const roles = new Map([[ROLE, role({ default_monthly_salary: 300000 })]]);
    expect(getEffectiveMonthlySalary(member({ monthly_salary: null }), roles)).toBe(300000);
  });
  it('両方 null → 0', () => {
    expect(getEffectiveMonthlySalary(member({ monthly_salary: null }))).toBe(0);
  });
});

describe('getMemberPayrollForStore 3段フォールバック (store override → tenant 既定 → role default → 0)', () => {
  it('storeId null → tenant 既定（role default fallback 有効）', () => {
    const roles = new Map([[ROLE, role({ default_hourly_rate: 1500 })]]);
    const res = getMemberPayrollForStore(member({ hourly_rate: null }), null, new Map(), roles);
    expect(res.hourlyRate).toBe(1500);
    expect(res.payType).toBe('hourly');
    expect(res.nightMultiplier).toBe(1.25);
  });

  it('override 行あり・hourly_rate 明示 → override 採用', () => {
    const roles = new Map([[ROLE, role({ default_hourly_rate: 1500 })]]);
    const map = new Map([[`${USER}:${STORE}`, payroll({ hourly_rate: 1800, night_shift_rate_multiplier: 1.3 })]]);
    const res = getMemberPayrollForStore(member({ hourly_rate: 1200 }), STORE, map, roles);
    expect(res.hourlyRate).toBe(1800);
    expect(res.nightMultiplier).toBe(1.3);
  });

  it('override 行あり・hourly_rate null → member 既定にフォールバック', () => {
    const roles = new Map([[ROLE, role({ default_hourly_rate: 1500 })]]);
    const map = new Map([[`${USER}:${STORE}`, payroll({ hourly_rate: null })]]);
    const res = getMemberPayrollForStore(member({ hourly_rate: 1200 }), STORE, map, roles);
    expect(res.hourlyRate).toBe(1200);
  });

  it('override 行あり・hourly_rate null・member null → role default まで降りる', () => {
    const roles = new Map([[ROLE, role({ default_hourly_rate: 1500 })]]);
    const map = new Map([[`${USER}:${STORE}`, payroll({ hourly_rate: null })]]);
    const res = getMemberPayrollForStore(member({ hourly_rate: null }), STORE, map, roles);
    expect(res.hourlyRate).toBe(1500);
  });

  it('override なし(storeId 有・map ヒットなし) → tenant 既定 → role default', () => {
    const roles = new Map([[ROLE, role({ default_hourly_rate: 1500 })]]);
    const res = getMemberPayrollForStore(member({ hourly_rate: null }), STORE, new Map(), roles);
    expect(res.hourlyRate).toBe(1500);
    expect(res.nightMultiplier).toBe(1.25);
  });

  it('全て未設定 → 0', () => {
    const roles = new Map([[ROLE, role({ default_hourly_rate: null })]]);
    const res = getMemberPayrollForStore(member({ hourly_rate: null }), STORE, new Map(), roles);
    expect(res.hourlyRate).toBe(0);
  });

  it('payType: override の pay_type を採用', () => {
    const map = new Map([[`${USER}:${STORE}`, payroll({ pay_type: 'monthly', monthly_salary: 300000 })]]);
    const res = getMemberPayrollForStore(member(), STORE, map);
    expect(res.payType).toBe('monthly');
    expect(res.monthlySalary).toBe(300000);
  });

  it('RPC 095 と同順: role default 保持者の時給解決が RPC COALESCE と一致', () => {
    // RPC 095 resolved: COALESCE(msp.hourly_rate, tm.hourly_rate, r.default_hourly_rate, 0)
    // フロント: getEffectiveHourlyRate = member.hourly_rate ?? role.default_hourly_rate ?? 0
    // role default のみ保持 → 両者 1500 で一致。
    const roles = new Map([[ROLE, role({ default_hourly_rate: 1500 })]]);
    const res = getMemberPayrollForStore(member({ hourly_rate: null }), STORE, new Map(), roles);
    expect(res.hourlyRate).toBe(1500);
  });
});
