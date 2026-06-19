// FILE: components/Tenant/roleMeta.ts
// ロール肩書ラベルの単一定数（表示層）。TenantSwitcher / TenantSelector が両方これを参照する。
// 注意: getRoleColor.ts の ROLE_COLOR_LABEL（会長/内勤等の色凡例ラベル）とは別物（色凡例≠肩書ラベル）。
import type { UserRole } from '../../types';

/** ロール → 日本語肩書ラベル（表示用の唯一の真実） */
export const ROLE_LABEL: Record<UserRole, string> = {
  owner: 'オーナー',
  manager: '店長',
  staff: 'スタッフ',
};

/** 未知の role 文字列にも安全に肩書ラベルを返す（不明時は staff ラベルにフォールバック） */
export function getRoleLabel(role: string): string {
  return ROLE_LABEL[role as UserRole] ?? ROLE_LABEL.staff;
}
