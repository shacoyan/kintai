import type { TenantMember, TenantRole, MemberStorePayroll } from '../types';

/**
 * メンバーの実効月給を取得する。
 * 優先順:
 *   1. member.monthly_salary が設定されていればそれを採用
 *   2. role.default_monthly_salary が設定されていればそれを採用
 *   3. それ以外は 0
 *
 * UnifiedShiftSidebar と useShift.getLaborCostEstimate の両方から参照される共通ロジック。
 */
export function getEffectiveMonthlySalary(
  member: TenantMember,
  rolesMap?: Map<string, TenantRole>
): number {
  if (member.monthly_salary != null) return member.monthly_salary;
  if (rolesMap && member.role_id) {
    const role = rolesMap.get(member.role_id);
    if (role?.default_monthly_salary != null) return role.default_monthly_salary;
  }
  return 0;
}

/**
 * 特定店舗におけるメンバーの給与情報を取得する (Phase 2 / 店舗別人件費)。
 *
 * 優先順:
 *   1. storeId 有 + payrollsMap に (user_id:store_id) ヒット → override 採用
 *      - 個別フィールドが null の場合は tenant_members 既定値にフォールバック
 *   2. fallback: tenant_members 既定値 (= テナント全体の hourly_rate / monthly_salary / pay_type)
 *
 * payrollsMap のキー形式は `${user_id}:${store_id}` (useMemberStorePayrolls.ts と統一)。
 * storeId が null の shift (legacy / 店舗未指定) はテナント既定値で計算 (既存挙動互換)。
 *
 * payType が 'monthly' の場合でも、深夜計算 / UI 表示等で参照される可能性があるため、
 * hourlyRate / monthlySalary は両方とも計算済みの値を返す。
 */
export function getMemberPayrollForStore(
  member: TenantMember,
  storeId: string | null | undefined,
  payrollsMap: Map<string, MemberStorePayroll>,
  rolesMap?: Map<string, TenantRole>
): {
  payType: 'hourly' | 'monthly';
  hourlyRate: number;
  monthlySalary: number;
  nightMultiplier: number;
} {
  const DEFAULT_NIGHT_MULTIPLIER = 1.25;

  if (storeId) {
    const payrollKey = `${member.user_id}:${storeId}`;
    const override = payrollsMap.get(payrollKey);

    if (override) {
      return {
        payType: override.pay_type,
        hourlyRate: override.hourly_rate ?? member.hourly_rate ?? 0,
        monthlySalary: override.monthly_salary ?? getEffectiveMonthlySalary(member, rolesMap),
        nightMultiplier: override.night_shift_rate_multiplier ?? DEFAULT_NIGHT_MULTIPLIER,
      };
    }
  }

  return {
    payType: member.pay_type ?? 'hourly',
    hourlyRate: member.hourly_rate ?? 0,
    monthlySalary: getEffectiveMonthlySalary(member, rolesMap),
    nightMultiplier: DEFAULT_NIGHT_MULTIPLIER,
  };
}
