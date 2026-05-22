import type { TenantMember, TenantRole } from '../types';

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
