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
    const isMonthly = (m: TenantMember) => (m.pay_type ?? 'hourly') === 'monthly';
    const monthlyTotal = ms.filter(isMonthly).reduce((s, m) => s + getEffectiveMonthlySalary(m, rolesMap), 0);
    const tentativeHourlyTotal = (tentativeLaborEstimates ?? []).filter(e => e.payType === 'hourly').reduce((s, e) => s + e.estimatedCost, 0);
    const allHourlyTotal = (allLaborEstimates ?? []).filter(e => e.payType === 'hourly').reduce((s, e) => s + e.estimatedCost, 0);
    return { monthlyTotal, tentativeHourlyTotal, allHourlyTotal };
  }, [members, rolesMap, tentativeLaborEstimates, allLaborEstimates]);

  const monthlyEstimatesMap = useMemo(() => {
    const map = new Map<string, LaborCostEstimate>();
    (allLaborEstimates ?? []).filter(e => e.payType === 'monthly').forEach(e => map.set(e.userId, e));
    return map;
  }, [allLaborEstimates]);

  const monthlyMembers = useMemo(() => {
    return (members ?? [])
      .filter(m => (m.pay_type ?? 'hourly') === 'monthly')
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
    
    const hourlyNormal = hourlyEstimates.reduce((s, e) => s + (e.shiftMinutes - e.nightMinutes), 0);
    const hourlyNight = hourlyEstimates.reduce((s, e) => s + e.nightMinutes, 0);
    const hourlyTotal = hourlyEstimates.reduce((s, e) => s + e.shiftMinutes, 0);
    const hourlyCost = hourlyEstimates.reduce((s, e) => s + e.estimatedCost, 0);
    
    let monthlyNormal = 0;
    let monthlyNight = 0;
    let monthlyTotal = 0;
    monthlyMembers.forEach(m => {
      const est = monthlyEstimatesMap.get(m.user_id);
      if (est) {
        monthlyNormal += est.shiftMinutes - est.nightMinutes;
        monthlyNight += est.nightMinutes;
        monthlyTotal += est.shiftMinutes;
      }
    });

    const cost = laborCost.monthlyTotal + hourlyCost;
    return { 
      normal: hourlyNormal + monthlyNormal, 
      night: hourlyNight + monthlyNight, 
      total: hourlyTotal + monthlyTotal, 
      cost 
    };
  }, [showDetailTable, hourlyEstimates, monthlyMembers, monthlyEstimatesMap, laborCost.monthlyTotal]);

  if ((members?.length ?? 0) === 0) return null;

  return (
    <Card padding="sm">
      <div className="text-sm font-bold mb-3">
        {targetMonth ? `${format(targetMonth, 'yyyy年M月', { locale: ja })} の想定人件費` : '想定人件費'}
      </div>
      {/* SP: details で折畳 (md 未満のみ表示) */}
      <details className="md:hidden group" open>
        <summary className="flex items-baseline justify-between gap-2 cursor-pointer list-none rounded-md bg-stone-50 dark:bg-stone-700/40 p-3 [&::-webkit-details-marker]:hidden">
          <span className="flex items-baseline gap-2">
            <svg className="w-4 h-4 text-stone-600 dark:text-stone-200 transition-transform group-open:rotate-90" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M7 5l6 5-6 5V5z" />
            </svg>
            <span className="text-xs text-stone-900 dark:text-stone-50 font-semibold">総計</span>
          </span>
          <span className="text-stone-900 dark:text-stone-50 tabular-nums font-extrabold text-xl">
            ¥{(laborCost.monthlyTotal + laborCost.allHourlyTotal).toLocaleString()}
          </span>
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-md p-3">
            <div className="text-xs text-indigo-900 dark:text-indigo-100">月給合計 (固定費)</div>
            <div className="text-indigo-900 dark:text-indigo-100 tabular-nums font-bold text-xl">
              ¥{laborCost.monthlyTotal.toLocaleString()}
            </div>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-900/30 rounded-md p-3">
            <div className="text-xs text-emerald-900 dark:text-emerald-100">時給合計</div>
            <div className="text-emerald-900 dark:text-emerald-100 tabular-nums font-bold text-xl">
              ¥{laborCost.allHourlyTotal.toLocaleString()}
            </div>
            <div className="text-xs text-emerald-900/80 dark:text-emerald-100/80 mt-0.5">
              仮承認分 ¥{laborCost.tentativeHourlyTotal.toLocaleString()}
            </div>
          </div>
        </div>
      </details>

      {/* md 以上: 既存の横並び 3 カード */}
      <div className="hidden md:flex flex-wrap gap-2">
        <div className="flex-1 basis-full sm:basis-auto sm:min-w-[150px] bg-indigo-50 dark:bg-indigo-900/30 rounded-md p-3">
          <div className="text-xs text-indigo-900 dark:text-indigo-100">月給合計 (固定費)</div>
          <div className="text-indigo-900 dark:text-indigo-100 tabular-nums font-bold text-xl sm:text-lg">
            ¥{laborCost.monthlyTotal.toLocaleString()}
          </div>
        </div>
        <div className="flex-1 basis-full sm:basis-auto sm:min-w-[150px] bg-emerald-50 dark:bg-emerald-900/30 rounded-md p-3">
          <div className="text-xs text-emerald-900 dark:text-emerald-100">時給合計</div>
          <div className="text-emerald-900 dark:text-emerald-100 tabular-nums font-bold text-xl sm:text-lg">
            ¥{laborCost.allHourlyTotal.toLocaleString()}
          </div>
          <div className="text-xs text-emerald-900/80 dark:text-emerald-100/80 mt-0.5">
            仮承認分 ¥{laborCost.tentativeHourlyTotal.toLocaleString()}
          </div>
        </div>
        <div className="flex-1 basis-full sm:basis-auto sm:min-w-[150px] bg-stone-50 dark:bg-stone-700/40 rounded-md p-3">
          <div className="text-xs text-stone-900 dark:text-stone-50">総計</div>
          <div className="text-stone-900 dark:text-stone-50 tabular-nums font-extrabold text-2xl sm:text-xl">
            ¥{(laborCost.monthlyTotal + laborCost.allHourlyTotal).toLocaleString()}
          </div>
        </div>
      </div>
      <div className="text-[10px] text-stone-600 dark:text-stone-300 mt-2">
        ※ 月給は固定費として全月給メンバー分を計上
      </div>
      {showDetailTable && (
        // 理由: オーナー要望によりスクロール撤廃。max-h と overflow-y を削除し、
        // 全員常時表示。横幅対応の overflow-x-auto のみ残す。
        <>
          <ul className="md:hidden mt-3 space-y-2">
            {monthlyMembers.length > 0 && (
              <>
                <li className="text-xs font-semibold text-stone-700 dark:text-stone-300 bg-stone-50 dark:bg-stone-700/40 rounded-md px-3 py-2">
                  月給メンバー
                </li>
                {monthlyMembers.map(m => {
                  const estimate = monthlyEstimatesMap.get(m.user_id);
                  return (
                    <li key={m.id} className="rounded-md border border-stone-200 dark:border-stone-700 p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-stone-900 dark:text-stone-50 truncate">{m.display_name}</span>
                        <span className="text-xs font-semibold tabular-nums text-blue-600 dark:text-blue-400 shrink-0">
                          ¥{getEffectiveMonthlySalary(m, rolesMap).toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <p className="text-stone-600 dark:text-stone-300">通常</p>
                          <p className="font-semibold tabular-nums text-stone-900 dark:text-stone-50">{estimate ? fmtTime(estimate.shiftMinutes - estimate.nightMinutes) : '-'}</p>
                        </div>
                        <div>
                          <p className="text-stone-600 dark:text-stone-300">深夜</p>
                          <p className="font-semibold tabular-nums text-stone-900 dark:text-stone-50">{estimate ? fmtTime(estimate.nightMinutes) : '-'}</p>
                        </div>
                        <div>
                          <p className="text-stone-600 dark:text-stone-300">合計</p>
                          <p className="font-semibold tabular-nums text-stone-900 dark:text-stone-50">{estimate ? fmtTime(estimate.shiftMinutes) : '-'}</p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </>
            )}
            {hourlyEstimates.length > 0 && (
              <>
                <li className="text-xs font-semibold text-stone-700 dark:text-stone-300 bg-stone-50 dark:bg-stone-700/40 rounded-md px-3 py-2">
                  時給メンバー
                </li>
                {hourlyEstimates.map(e => (
                  <li key={e.userId} className="rounded-md border border-stone-200 dark:border-stone-700 p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-stone-900 dark:text-stone-50 truncate">{e.displayName}</span>
                      <span className="text-xs font-semibold tabular-nums text-blue-600 dark:text-blue-400 shrink-0">
                        ¥{e.estimatedCost.toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-stone-600 dark:text-stone-300">通常</p>
                        <p className="font-semibold tabular-nums text-stone-900 dark:text-stone-50">{fmtTime(e.shiftMinutes - e.nightMinutes)}</p>
                      </div>
                      <div>
                        <p className="text-stone-600 dark:text-stone-300">深夜</p>
                        <p className="font-semibold tabular-nums text-stone-900 dark:text-stone-50">{fmtTime(e.nightMinutes)}</p>
                      </div>
                      <div>
                        <p className="text-stone-600 dark:text-stone-300">合計</p>
                        <p className="font-semibold tabular-nums text-stone-900 dark:text-stone-50">{fmtTime(e.shiftMinutes)}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </>
            )}
            <li className="rounded-md border-2 border-stone-300 dark:border-stone-600 bg-stone-100 dark:bg-stone-700/40 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-bold text-stone-900 dark:text-stone-50">合計</span>
                <span className="text-sm font-bold tabular-nums text-blue-700 dark:text-blue-300 shrink-0">
                  ¥{detailTotals.cost.toLocaleString()}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-stone-600 dark:text-stone-300">通常</p>
                  <p className="font-bold tabular-nums text-stone-900 dark:text-stone-50">{fmtTime(detailTotals.normal)}</p>
                </div>
                <div>
                  <p className="text-stone-600 dark:text-stone-300">深夜</p>
                  <p className="font-bold tabular-nums text-stone-900 dark:text-stone-50">{fmtTime(detailTotals.night)}</p>
                </div>
                <div>
                  <p className="text-stone-600 dark:text-stone-300">合計</p>
                  <p className="font-bold tabular-nums text-stone-900 dark:text-stone-50">{fmtTime(detailTotals.total)}</p>
                </div>
              </div>
            </li>
          </ul>
          <div className="mt-3 overflow-x-auto hidden md:block">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-stone-600 dark:text-stone-300">
                  <th className="px-3 py-2 font-medium sticky left-0 bg-white dark:bg-stone-800 z-10 sm:static sm:bg-transparent">スタッフ名</th>
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
                  {monthlyMembers.map(m => {
                    const estimate = monthlyEstimatesMap.get(m.user_id);
                    return (
                      <tr key={m.id}>
                        <td className="px-3 py-2 text-left sticky left-0 bg-white dark:bg-stone-800 z-10 sm:static sm:bg-transparent">{m.display_name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{estimate ? fmtTime(estimate.shiftMinutes - estimate.nightMinutes) : '-'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{estimate ? fmtTime(estimate.nightMinutes) : '-'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{estimate ? fmtTime(estimate.shiftMinutes) : '-'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">¥{getEffectiveMonthlySalary(m, rolesMap).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </>
              )}
              {hourlyEstimates.length > 0 && (
                <>
                  <tr>
                    <td colSpan={5} className="px-3 py-2 bg-stone-50 dark:bg-stone-700/40 text-xs font-semibold text-stone-700 dark:text-stone-300">時給メンバー</td>
                  </tr>
                  {hourlyEstimates.map(e => (
                    <tr key={e.userId}>
                      <td className="px-3 py-2 text-left sticky left-0 bg-white dark:bg-stone-800 z-10 sm:static sm:bg-transparent">{e.displayName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtTime(e.shiftMinutes - e.nightMinutes)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtTime(e.nightMinutes)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtTime(e.shiftMinutes)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">¥{e.estimatedCost.toLocaleString()}</td>
                    </tr>
                  ))}
                </>
              )}
              <tr className="bg-stone-100 dark:bg-stone-700/40 font-bold">
                <td className="px-3 py-2 text-left sticky left-0 bg-stone-100 dark:bg-stone-700/40 z-10 sm:static">合計</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtTime(detailTotals.normal)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtTime(detailTotals.night)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtTime(detailTotals.total)}</td>
                <td className="px-3 py-2 text-right tabular-nums">¥{detailTotals.cost.toLocaleString()}</td>
              </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
