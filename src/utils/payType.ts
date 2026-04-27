import type { TenantMember } from '../types';

/**
 * メンバーの給与支払タイプを取得する。
 * undefined / null の場合は 'hourly' を返す。
 */
export const getPayType = (
  member: Partial<Pick<TenantMember, 'pay_type'>>,
): 'hourly' | 'monthly' => member.pay_type ?? 'hourly';
