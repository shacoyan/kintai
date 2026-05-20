import { useMemo } from 'react';
import { format } from 'date-fns';
import { Heading } from '../ui/Heading';
import type { TenantMember, TenantRole } from '../../types';

interface LaborCostEstimate {
  userId: string;
  displayName: string;
  payType: 'hourly' | 'monthly';
  shiftMinutes: number;
  nightMinutes: number;
  estimatedCost: number;
}

interface LaborCostSummaryProps {
  tentativeEstimates: LaborCostEstimate[];
  allEstimates: LaborCostEstimate[];
  members: TenantMember[];
  roles: TenantRole[];
  targetMonth?: Date;
}

function getEffectiveMonthlySalary(m: TenantMember, rolesMap: Map<string, TenantRole>): number {
  if (m.monthly_salary != null) return m.monthly_salary;
  if (m.role_id) {
    const role = rolesMap.get(m.role_id);
    if (role?.default_monthly_salary != null) return role.default_monthly_salary;
  }
  return 0;
}

export function LaborCostSummary({ tentativeEstimates, allEstimates, members, roles, targetMonth }: LaborCostSummaryProps) {
  const fmtTime = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  };

  const rolesMap = useMemo(() => new Map(roles.map(r => [r.id, r])), [roles]);

  const isMonthlyMember = (m: TenantMember) =>
    (m.pay_type ?? 'hourly') === 'monthly' && getEffectiveMonthlySalary(m, rolesMap) > 0;

  const monthlyTotal = members.filter(isMonthlyMember).reduce((s, m) => s + getEffectiveMonthlySalary(m, rolesMap), 0);
  const tentativeHourlyTotal = tentativeEstimates.filter(e => e.payType === 'hourly').reduce((s, e) => s + e.estimatedCost, 0);
  const allHourlyTotal = allEstimates.filter(e => e.payType === 'hourly').reduce((s, e) => s + e.estimatedCost, 0);

  const hasTentative = tentativeEstimates.length > 0;
  const hasAll = allEstimates.length > 0;

  if (!hasTentative && !hasAll && monthlyTotal === 0) return null;

  const allHourlyEstimates = allEstimates.filter(e => e.payType === 'hourly');
  const allHourlyTotalMinutes = allHourlyEstimates.reduce((s, e) => s + e.shiftMinutes, 0);
  const allHourlyTotalNightMinutes = allHourlyEstimates.reduce((s, e) => s + e.nightMinutes, 0);

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-700">
        <Heading level={2}>人件費サマリー</Heading>
        <p className="text-sm text-neutral-500 dark:text-neutral-300 mt-0.5">
          {targetMonth
            ? `${format(targetMonth, 'yyyy年M月')} の見込み人件費（上段：仮承認分、下段：申請中含む全体見込み）`
            : '見込み人件費（上段：仮承認分、下段：申請中含む全体見込み）'}
        </p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">※ 月給は仮承認の有無に関わらず固定費として全月給メンバー分を計上しています</p>
      </div>

      <div aria-label="仮承認分の人件費" className="px-6 py-5 border-b border-neutral-200 dark:border-neutral-700">
        <div className="flex items-baseline gap-3 mb-3">
          <span className="text-base font-bold text-neutral-800 dark:text-neutral-200 whitespace-nowrap">仮承認分の人件費</span>
          {!hasTentative && tentativeHourlyTotal === 0 && (
            <span className="text-sm font-medium text-neutral-600 dark:text-neutral-400 whitespace-nowrap">(まだ仮承認なし)</span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-md p-3">
            <div className="text-xs text-indigo-900 dark:text-indigo-100 mb-1 flex items-center gap-1.5">
              月給合計
              <span className="text-[10px] bg-indigo-200 dark:bg-indigo-800 text-indigo-800 dark:text-indigo-200 px-1.5 py-0.5 rounded-full leading-none">(固定費)</span>
            </div>
            <div className="text-lg font-bold text-indigo-900 dark:text-indigo-100 tabular-nums">¥{monthlyTotal.toLocaleString()}</div>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-900/30 rounded-md p-3">
            <div className="text-xs text-emerald-900 dark:text-emerald-100 mb-1">時給合計</div>
            <div className="text-lg font-bold text-emerald-900 dark:text-emerald-100 tabular-nums">¥{tentativeHourlyTotal.toLocaleString()}</div>
          </div>
          <div className="bg-neutral-50 dark:bg-neutral-700/50 rounded-md p-3">
            <div className="text-xs text-neutral-900 dark:text-neutral-50 mb-1">総計</div>
            <div className="text-xl font-extrabold text-neutral-900 dark:text-neutral-50 tabular-nums">¥{(monthlyTotal + tentativeHourlyTotal).toLocaleString()}</div>
          </div>
        </div>
      </div>

      {(hasAll || monthlyTotal > 0) && (
        <div aria-label="申請中含む全体見込み人件費" className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-700">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
            <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-md p-3">
              <div className="text-xs text-indigo-900 dark:text-indigo-100 mb-1 flex items-center gap-1.5">
                月給合計
                <span className="text-[10px] bg-indigo-200 dark:bg-indigo-800 text-indigo-800 dark:text-indigo-200 px-1.5 py-0.5 rounded-full leading-none">(固定費)</span>
              </div>
              <div className="text-lg font-bold text-indigo-900 dark:text-indigo-100 tabular-nums">¥{monthlyTotal.toLocaleString()}</div>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-900/30 rounded-md p-3">
              <div className="text-xs text-emerald-900 dark:text-emerald-100 mb-1">時給合計</div>
              <div className="text-lg font-bold text-emerald-900 dark:text-emerald-100 tabular-nums">¥{allHourlyTotal.toLocaleString()}</div>
            </div>
            <div className="bg-neutral-50 dark:bg-neutral-700/50 rounded-md p-3">
              <div className="text-xs text-neutral-900 dark:text-neutral-50 mb-1">総計</div>
              <div className="text-xl font-extrabold text-neutral-900 dark:text-neutral-50 tabular-nums">¥{(monthlyTotal + allHourlyTotal).toLocaleString()}</div>
            </div>
          </div>

          {allHourlyEstimates.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-[600px] w-full divide-y divide-neutral-200 dark:divide-neutral-700">
                <thead className="bg-neutral-50 dark:bg-neutral-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 min-w-[120px] whitespace-nowrap">名前</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 dark:text-neutral-300 whitespace-nowrap">通常</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 dark:text-neutral-300 whitespace-nowrap">深夜</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 dark:text-neutral-300 whitespace-nowrap">合計</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 dark:text-neutral-300 whitespace-nowrap">見込み額</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-700 tabular-nums">
                  {allHourlyEstimates.map((e) => (
                    <tr key={e.userId} className="hover:bg-neutral-50 dark:hover:bg-neutral-700/50">
                      <td className="px-6 py-3 text-sm font-medium text-neutral-900 dark:text-neutral-100 whitespace-nowrap">{e.displayName}</td>
                      <td className="px-6 py-3 text-sm text-neutral-700 dark:text-neutral-300 text-right whitespace-nowrap">{fmtTime(e.shiftMinutes - e.nightMinutes)}</td>
                      <td className="px-6 py-3 text-sm text-neutral-700 dark:text-neutral-300 text-right whitespace-nowrap">{fmtTime(e.nightMinutes)}</td>
                      <td className="px-6 py-3 text-sm text-neutral-700 dark:text-neutral-300 text-right whitespace-nowrap">{fmtTime(e.shiftMinutes)}</td>
                      <td className="px-6 py-3 text-sm font-medium text-neutral-900 dark:text-neutral-100 text-right whitespace-nowrap">
                        ¥{e.estimatedCost.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-neutral-50 dark:bg-neutral-700/50 border-t-2 border-neutral-300 dark:border-neutral-600">
                    <td className="px-6 py-3 text-sm font-bold text-neutral-900 dark:text-neutral-100 whitespace-nowrap">合計</td>
                    <td className="px-6 py-3 text-sm font-bold text-neutral-900 dark:text-neutral-100 text-right whitespace-nowrap">{fmtTime(allHourlyTotalMinutes - allHourlyTotalNightMinutes)}</td>
                    <td className="px-6 py-3 text-sm font-bold text-neutral-900 dark:text-neutral-100 text-right whitespace-nowrap">{fmtTime(allHourlyTotalNightMinutes)}</td>
                    <td className="px-6 py-3 text-sm font-bold text-neutral-900 dark:text-neutral-100 text-right whitespace-nowrap">{fmtTime(allHourlyTotalMinutes)}</td>
                    <td className="px-6 py-3 text-base font-bold text-neutral-900 dark:text-neutral-100 text-right whitespace-nowrap">¥{allHourlyTotal.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
