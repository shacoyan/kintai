/**
 * ShiftPayrollPreview.tsx
 *
 * 目的: 指定月の「仮承認・本承認」シフトから想定人件費をプレビュー表示する。
 * 集計対象: currentMonth 月初〜月末の shifts × status IN ('tentative','approved')
 *
 * 計算ロジック由来: PayrollCalculation.tsx calcMemberShiftPayroll と同等
 *   - 現コンポーネントでは status filter を ('tentative','approved') に拡張した版をインライン実装
 *   - 重複コード: PayrollCalculation.tsx calcMemberShiftPayroll の status filter を ('tentative','approved') に拡張した版
 *
 * TODO: 将来 utils/payrollCalc.ts への切り出しを検討 (共通化 & 二重保守回避)
 */
import React, { useMemo } from 'react';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { ja } from 'date-fns/locale';
import type { TenantMember, Shift, TenantRole } from '../../types';
import { getNightMinutesForShift } from '../../utils/nightShift';

/** 表示用 row データ */
interface PreviewRow {
  userId: string;
  displayName: string;
  payType: 'hourly' | 'monthly';
  totalMinutes: number;
  workDays: number;
  payment: number;
}

/** 有効時給 (member 個別 → 役職デフォルト → 0) */
function getEffectiveHourlyRate(
  m: TenantMember,
  rolesMap: Map<string, TenantRole>
): number {
  if (m.hourly_rate != null) return m.hourly_rate;
  if (m.role_id) {
    const role = rolesMap.get(m.role_id);
    if (role?.default_hourly_rate != null) return role.default_hourly_rate;
  }
  return 0;
}

/** 有効月給 (member 個別 → 役職デフォルト → 0) */
function getEffectiveMonthlySalary(
  m: TenantMember,
  rolesMap: Map<string, TenantRole>
): number {
  if (m.monthly_salary != null) return m.monthly_salary;
  if (m.role_id) {
    const role = rolesMap.get(m.role_id);
    if (role?.default_monthly_salary != null) return role.default_monthly_salary;
  }
  return 0;
}

/**
 * メンバー別プレビュー行の集計
 * 重複コード: PayrollCalculation.tsx calcMemberShiftPayroll の status filter を
 * ('tentative','approved') に拡張した版
 */
function calcMemberPreviewRow(
  member: TenantMember,
  shifts: Shift[],
  rolesMap: Map<string, TenantRole>
): PreviewRow {
  const rate = getEffectiveHourlyRate(member, rolesMap);
  const payType = member.pay_type ?? 'hourly';
  const monthlySalary = getEffectiveMonthlySalary(member, rolesMap);

  // 仮承認 / 本承認のみ
  const targetShifts = shifts.filter(
    (s) =>
      s.user_id === member.user_id &&
      (s.status === 'tentative' || s.status === 'approved')
  );

  const dates = new Set<string>();
  let totalMinutes = 0;
  let normalMinutes = 0;
  let nightMinutes = 0;

  for (const s of targetShifts) {
    dates.add(s.date);

    const startTime = s.start_time;
    const endTime = s.end_time;

    const startParts = startTime.split(':').map(Number);
    const endParts = endTime.split(':').map(Number);
    const startMin = startParts[0] * 60 + startParts[1];
    const endMin = endParts[0] * 60 + endParts[1];
    // 日跨ぎ考慮
    const shiftMins =
      endMin > startMin ? endMin - startMin : 24 * 60 - startMin + endMin;

    totalMinutes += shiftMins;

    if (member.night_shift_enabled !== false) {
      const nightMins = getNightMinutesForShift(s.date, startTime, endTime);
      nightMinutes += nightMins;
      normalMinutes += shiftMins - nightMins;
    } else {
      normalMinutes += shiftMins;
    }
  }

  let payment: number;
  if (payType === 'monthly') {
    payment = monthlySalary;
  } else {
    const normalPay = (normalMinutes / 60) * rate;
    const nightPay = (nightMinutes / 60) * rate * 1.25;
    payment = Math.ceil(normalPay + nightPay);
  }

  return {
    userId: member.user_id,
    displayName: member.display_name,
    payType,
    totalMinutes,
    workDays: dates.size,
    payment,
  };
}

/** 分 → 「Xh Ym」表記 */
function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

/** 数値 → ¥表記 */
function fmtYen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`;
}

interface ShiftPayrollPreviewProps {
  tenantId: string;
  storeId: string | null;
  currentMonth: Date;
  allShifts: Shift[];
  members: TenantMember[];
  roles: TenantRole[];
}

const ShiftPayrollPreview: React.FC<ShiftPayrollPreviewProps> = ({
  currentMonth,
  allShifts,
  members,
  roles,
}) => {
  // monthStart/monthEnd は将来 props/表示用に保持 (Date 参照固定で再 render 抑止)
  const monthStart = useMemo(() => startOfMonth(currentMonth), [currentMonth]);
  const monthEnd = useMemo(() => endOfMonth(currentMonth), [currentMonth]);
  void monthStart;
  void monthEnd;

  const rolesMap = useMemo(() => {
    const map = new Map<string, TenantRole>();
    for (const r of roles) {
      map.set(r.id, r);
    }
    return map;
  }, [roles]);

  const targetShifts = useMemo(
    () =>
      allShifts.filter(
        (s) => s.status === 'tentative' || s.status === 'approved'
      ),
    [allShifts]
  );

  const rows = useMemo(
    () =>
      members.map((m) => calcMemberPreviewRow(m, targetShifts, rolesMap)),
    [members, targetShifts, rolesMap]
  );

  const totals = useMemo(() => {
    let totalMinutes = 0;
    let workDays = 0;
    let payment = 0;
    for (const r of rows) {
      totalMinutes += r.totalMinutes;
      workDays += r.workDays;
      payment += r.payment;
    }

    const monthlyTotal = rows
      .filter((r) => r.payType === 'monthly')
      .reduce((s, r) => s + r.payment, 0);
    const hourlyTotal = rows
      .filter((r) => r.payType === 'hourly')
      .reduce((s, r) => s + r.payment, 0);
    const grandTotal = monthlyTotal + hourlyTotal;

    return { totalMinutes, workDays, payment, monthlyTotal, hourlyTotal, grandTotal };
  }, [rows]);

  const titleMonth = format(currentMonth, 'yyyy年M月', { locale: ja });
  const isEmpty = targetShifts.length === 0;

  return (
    <div className="w-full">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-neutral-100 mb-3">
        想定人件費 ({titleMonth})
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
        <div className="rounded-md p-3 bg-indigo-50 dark:bg-indigo-900/30">
          <div className="text-xs text-indigo-900 dark:text-indigo-100 mb-1 flex items-center gap-1.5">
            月給合計
            <span className="text-[10px] bg-indigo-200 dark:bg-indigo-800 text-indigo-800 dark:text-indigo-200 px-1.5 py-0.5 rounded-full leading-none">(固定費)</span>
          </div>
          <div className="text-lg font-bold text-indigo-900 dark:text-indigo-100 tabular-nums">{fmtYen(totals.monthlyTotal)}</div>
        </div>
        <div className="rounded-md p-3 bg-emerald-50 dark:bg-emerald-900/30">
          <div className="text-xs text-emerald-900 dark:text-emerald-100 mb-1">時給合計</div>
          <div className="text-lg font-bold text-emerald-900 dark:text-emerald-100 tabular-nums">{fmtYen(totals.hourlyTotal)}</div>
        </div>
        <div className="rounded-md p-3 bg-neutral-50 dark:bg-neutral-700/50">
          <div className="text-xs text-neutral-900 dark:text-neutral-50 mb-1">総計</div>
          <div className="text-xl font-extrabold text-neutral-900 dark:text-neutral-50 tabular-nums">{fmtYen(totals.grandTotal)}</div>
        </div>
      </div>

      <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3">※ 月給は仮承認の有無に関わらず固定費として全月給メンバー分を計上しています</p>

      {isEmpty ? (
        <p className="text-sm text-gray-500 dark:text-neutral-400 py-6 text-center">
          該当する仮承認・本承認シフトはありません（月給は上記サマリに計上済み）
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-neutral-700">
                <th className="py-2 px-2 text-left font-medium text-gray-600 dark:text-neutral-400">
                  名前
                </th>
                <th className="py-2 px-2 text-right font-medium text-gray-600 dark:text-neutral-400">
                  勤務時間
                </th>
                <th className="py-2 px-2 text-right font-medium text-gray-600 dark:text-neutral-400">
                  出勤日数
                </th>
                <th className="py-2 px-2 text-right font-medium text-gray-600 dark:text-neutral-400">
                  想定人件費
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.userId}
                  className="border-b border-gray-100 dark:border-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-800"
                >
                  <td className="py-2 px-2 text-gray-900 dark:text-neutral-100 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <span>{row.displayName}</span>
                      {row.payType === 'monthly' && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                          月給
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right text-gray-700 dark:text-neutral-300 tabular-nums">
                    {fmtTime(row.totalMinutes)}
                  </td>
                  <td className="py-2 px-2 text-right text-gray-700 dark:text-neutral-300 tabular-nums">
                    {row.workDays}
                  </td>
                  <td className="py-2 px-2 text-right text-gray-900 dark:text-neutral-100 font-medium tabular-nums">
                    {fmtYen(row.payment)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 dark:border-neutral-600 font-semibold">
                <td className="py-2 px-2 text-gray-900 dark:text-neutral-100">合計</td>
                <td className="py-2 px-2 text-right text-gray-900 dark:text-neutral-100 tabular-nums">
                  {fmtTime(totals.totalMinutes)}
                </td>
                <td className="py-2 px-2 text-right text-gray-900 dark:text-neutral-100 tabular-nums">
                  {totals.workDays}
                </td>
                <td className="py-2 px-2 text-right text-gray-900 dark:text-neutral-100 tabular-nums">
                  {fmtYen(totals.payment)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
};

export default ShiftPayrollPreview;
