import type { TenantMember } from '../types';

export type RoleColorKey = 'owner' | 'manager' | 'fulltime' | 'parttime';

type RoleColorMember =
  | Pick<TenantMember, 'role' | 'pay_type' | 'is_parttime'>
  | { role?: string | null; pay_type?: string | null; is_parttime?: boolean | null };

export const ROLE_COLOR_HEX: Record<RoleColorKey, string> = {
  owner: '#7c3aed',
  manager: '#2563eb',
  fulltime: '#0d9488',
  parttime: '#ea580c',
};

export const ROLE_COLOR_LABEL: Record<RoleColorKey, string> = {
  owner: '会長 / 内勤',
  manager: '店長',
  fulltime: '正社員',
  parttime: 'バイト',
};

/**
 * Tailwind JIT のため static class 文字列で持つ。
 * border は左 borderLeft 2px 用の色 utility (使用箇所では style で hex を直接当てる方が
 * 安全だが、ここでも一応 mapping を持つ)。
 */
export const ROLE_COLOR_TAILWIND: Record<RoleColorKey, { border: string; bg: string; text: string; bgSoft: string }> = {
  owner:    { border: 'border-violet-600', bg: 'bg-violet-600', text: 'text-violet-700', bgSoft: 'bg-violet-50' },
  manager:  { border: 'border-blue-600',   bg: 'bg-blue-600',   text: 'text-blue-700',   bgSoft: 'bg-blue-50' },
  fulltime: { border: 'border-teal-600',   bg: 'bg-teal-600',   text: 'text-teal-700',   bgSoft: 'bg-teal-50' },
  parttime: { border: 'border-orange-500', bg: 'bg-orange-500', text: 'text-orange-700', bgSoft: 'bg-orange-50' },
};

/**
 * member の role + pay_type から正典 4 色のいずれかを返す。
 *
 * mapping:
 * - role === 'owner'   → owner
 * - role === 'manager' → manager
 * - is_parttime === true → parttime (フィールド優先)
 * - pay_type === 'monthly' → fulltime
 * - pay_type === 'hourly'  → parttime
 * - その他/フォールバック → fulltime
 *
 * 注: PC (CalShiftBar) と SP (ShiftMobileTodayList 等) で同一スタッフが
 * 異なる色になっていた不具合を解消するための単一情報源。
 */
export function getRoleColorKey(
  member: RoleColorMember | undefined | null
): RoleColorKey {
  if (!member) return 'fulltime';
  if (member.role === 'owner') return 'owner';
  if (member.role === 'manager') return 'manager';
  if (member.is_parttime === true) return 'parttime';
  if (member.pay_type === 'monthly') return 'fulltime';
  if (member.pay_type === 'hourly') return 'parttime';
  return 'fulltime';
}

/** member 直接 → hex */
export function getRoleColorHex(
  member: RoleColorMember | undefined | null
): string {
  return ROLE_COLOR_HEX[getRoleColorKey(member)];
}

/** member 直接 → ラベル */
export function getRoleColorLabel(
  member: RoleColorMember | undefined | null
): string {
  return ROLE_COLOR_LABEL[getRoleColorKey(member)];
}

/** roleType 文字列 → hex (ShiftMobileTodayList が roleTypeMap を受け取るため互換用) */
export function getRoleColorHexFromKey(key: RoleColorKey | undefined): string {
  return ROLE_COLOR_HEX[key ?? 'fulltime'];
}
