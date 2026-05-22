import { useMemo } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Card } from '../ui';
import { getEffectiveMonthlySalary } from '../../utils/payrollCalc';
import type { TenantMember, TenantRole } from '../../types';
import type { LaborCostEstimate } from '../../hooks/useShift';

// 理由: UnifiedShiftSidebar から移植した時間フォーマット helper。動作不変。
const fmtTime = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
};

export interface LaborCostCardProps {
  members?: TenantMember[];
  roles?: TenantRole[];
  tentativeLaborEstimates?: LaborCostEstimate[];
  allLaborEstimates?: LaborCostEstimate[];
  targetMonth?: Date;
}

/**
 * 想定人件費 Card (Loop17 で UnifiedShiftSidebar から分離)。
 * - 月給合計 / 時給合計 / 総計 のサマリ + スタッフ別詳細テーブル
 * - manager 判定は呼び出し側で行う（給与情報セキュリティ責任は ShiftPage 側）
 * - スクロール撤廃: 詳細テーブルは max-h を持たず、全員常時表示
 */
export function LaborCostCard({
  members,
  roles,
  tentativeLaborEstimates,
  allLaborEstimates,
  targetMonth,
}: LaborCostCardProps) {
  const rolesMap = useMemo(() => new Map((roles ?? []).map(r => [r.id, r])), [roles]);

  const laborCost = useMemo(() => {
    const ms = members ?? [];
    const isMonthly = (m: TenantMember) => (m.pay_type ?? 'hourly') === 'monthly' && getEffectiveMonthlySalary(m, rolesMap) > 0;
    const monthlyTotal = ms.filter(isMonthly).reduce((s, m) => s + getEffectiveMonthlySalary(m, rolesMap), 0);
    const tentativeHourlyTotal = (tentativeLaborEstimates ?? []).filter(e => e.payType === 'hourly').reduce((s, e) => s + e.estimatedCost, 0);
    const allHourlyTotal = (allLaborEstimates ?? []).filter(e => e.payType === 'hourly').reduce((s, e) => s + e.estimatedCost, 0);
    return { monthlyTotal, tentativeHourlyTotal, allHourlyTotal };
  }, [members, rolesMap, tentativeLaborEstimates, allLaborEstimates]);

  const monthlyMembers = useMemo(() => {
    return (members ?? [])
      .filter(m => (m.pay_type ?? 'hourly') === 'monthly' && getEffectiveMonthlySalary(m, rolesMap) > 0)
      .sort((a, b) => a.display_name.localeCompare(b.display_name, 'ja'));
  }, [members, rolesMap]);

  const hourlyEstimates = useMemo(() => {
    return (allLaborEstimates ?? [])
      .filter(e => e.payType === 'hourly')
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'));
  }, [allLaborEstimates]);

  const showDetailTable = monthlyMembers.length > 0 || hourlyEstimates.length > 0;

  const detailTotals = useMemo(() => {
    if (!showDetailTable) return { normal: 0, night: 0, total: 0, cost: 0 };
    const normal = hourlyEstimates.reduce((s, e) => s + (e.shiftMinutes - e.nightMinutes), 0);
    const night = hourlyEstimates.reduce((s, e) => s + e.nightMinutes, 0);
    const total = hourlyEstimates.reduce((s, e) => s + e.shiftMinutes, 0);
    const hourlyCost = hourlyEstimates.reduce((s, e) => s + e.estimatedCost, 0);
    const cost = laborCost.monthlyTotal + hourlyCost;
    return { normal, night, total, cost };
  }, [showDetailTable, hourlyEstimates, laborCost.monthlyTotal]);

  if ((members?.length ?? 0) === 0) return null;

  return (
    <Card padding="sm">
      <div className="text-sm font-bold mb-3">
        {targetMonth ? `${format(targetMonth, 'yyyy年M月', { locale: ja })} の想定人件費` : '想定人件費'}
      </div>
      <div className="space-y-2">
        <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-md p-3">
          <div className="text-xs text-indigo-900 dark:text-indigo-100">月給合計 (固定費)</div>
          <div className="text-indigo-900 dark:text-indigo-100 tabular-nums font-bold text-lg">
            ¥{laborCost.monthlyTotal.toLocaleString()}
          </div>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-900/30 rounded-md p-3">
          <div className="text-xs text-emerald-900 dark:text-emerald-100">時給合計</div>
          <div className="text-emerald-900 dark:text-emerald-100 tabular-nums font-bold text-lg">
            ¥{laborCost.allHourlyTotal.toLocaleString()}
          </div>
          <div className="text-xs text-emerald-900/80 dark:text-emerald-100/80 mt-0.5">
            仮承認分 ¥{laborCost.tentativeHourlyTotal.toLocaleString()}
          </div>
        </div>
        <div className="bg-stone-50 dark:bg-stone-700/40 rounded-md p-3">
          <div className="text-xs text-stone-900 dark:text-stone-50">総計</div>
          <div className="text-stone-900 dark:text-stone-50 tabular-nums font-extrabold text-xl">
            ¥{(laborCost.monthlyTotal + laborCost.allHourlyTotal).toLocaleString()}
          </div>
        </div>
      </div>
      <div className="text-[10px] text-stone-500 dark:text-stone-400 mt-2">
        ※ 月給は固定費として全月給メンバー分を計上
      </div>
      {showDetailTable && (
        // 理由: オーナー要望によりスクロール撤廃。max-h と overflow-y を削除し、
        // 全員常時表示。横幅対応の overflow-x-auto のみ残す。
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-stone-500 dark:text-stone-400">
                <th className="px-3 py-2 font-medium">スタッフ名</th>
                <th className="px-3 py-2 font-medium text-right tabular-nums">通常時間</th>
                <th className="px-3 py-2 font-medium text-right tabular-nums">深夜時間</th>
                <th className="px-3 py-2 font-medium text-right tabular-nums">合計時間</th>
                <th className="px-3 py-2 font-medium text-right tabular-nums">支払い予定人件費</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
              {monthlyMembers.length > 0 && (
                <>
                  <tr>
                    <td colSpan={5} className="px-3 py-2 bg-stone-50 dark:bg-stone-700/40 text-xs font-semibold text-stone-700 dark:text-stone-300">月給メンバー</td>
                  </tr>
                  {monthlyMembers.map(m => (
                    <tr key={m.id}>
                      <td className="px-3 py-2 text-left">{m.display_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">-</td>
                      <td className="px-3 py-2 text-right tabular-nums">-</td>
                      <td className="px-3 py-2 text-right tabular-nums">-</td>
                      <td className="px-3 py-2 text-right tabular-nums">¥{getEffectiveMonthlySalary(m, rolesMap).toLocaleString()}</td>
                    </tr>
                  ))}
                </>
              )}
              {hourlyEstimates.length > 0 && (
                <>
                  <tr>
                    <td colSpan={5} className="px-3 py-2 bg-stone-50 dark:bg-stone-700/40 text-xs font-semibold text-stone-700 dark:text-stone-300">時給メンバー</td>
                  </tr>
                  {hourlyEstimates.map(e => (
                    <tr key={e.userId}>
                      <td className="px-3 py-2 text-left">{e.displayName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtTime(e.shiftMinutes - e.nightMinutes)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtTime(e.nightMinutes)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtTime(e.shiftMinutes)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">¥{e.estimatedCost.toLocaleString()}</td>
                    </tr>
                  ))}
                </>
              )}
              <tr className="bg-stone-100 dark:bg-stone-700/40 font-bold">
                <td className="px-3 py-2 text-left">合計</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtTime(detailTotals.normal)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtTime(detailTotals.night)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtTime(detailTotals.total)}</td>
                <td className="px-3 py-2 text-right tabular-nums">¥{detailTotals.cost.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
