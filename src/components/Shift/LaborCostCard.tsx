import { useMemo, type CSSProperties } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Badge, Card } from '../ui';
import { ActionMenu, type ActionMenuItem } from '../ui/ActionMenu';
import { MemberAvatar } from './MemberAvatar';
import { getEffectiveMonthlySalary } from '../../utils/payrollCalc';
import { formatYenMan, formatYenManSplit } from '../../utils/formatYenMan';
import { getRoleColorKey, ROLE_COLOR_HEX, ROLE_COLOR_LABEL } from '../../utils/getRoleColor';
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
  const monthlyCount = monthlyMembers.length;
  const hourlyCount = hourlyEstimates.length;
  const totalCost = laborCost.monthlyTotal + laborCost.allHourlyTotal;
  const monthlySplit = formatYenManSplit(laborCost.monthlyTotal);
  const hourlySplit = formatYenManSplit(laborCost.allHourlyTotal);
  const totalSplit = formatYenManSplit(totalCost);

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

  const moreItems: ActionMenuItem[] = [
    {
      key: 'csv',
      label: 'CSV エクスポート',
      onSelect: () => console.info('[LaborCostCard] CSV export (準備中)'),
    },
    {
      key: 'detail',
      label: '詳細を表示',
      onSelect: () => console.info('[LaborCostCard] detail toggle (準備中)'),
    },
  ];

  if ((members?.length ?? 0) === 0) return null;

  return (
    <Card padding="md">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold text-stone-900 dark:text-stone-100">
            {targetMonth ? `${format(targetMonth, 'yyyy年M月', { locale: ja })} の想定人件費` : '想定人件費'}
          </h3>
          {targetMonth && (
            <Badge tone="warning" className="text-[10px]">
              確定前 ({format(targetMonth, 'M月', { locale: ja })})
            </Badge>
          )}
          <div className="flex-1" />
          <ActionMenu
            items={moreItems}
            triggerLabel="人件費メニュー"
            triggerSize="sm"
            align="end"
            bottomSheetTitle="人件費メニュー"
          />
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
            {formatYenMan(totalCost)}
          </span>
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-md p-3">
            <div className="text-xs text-indigo-900 dark:text-indigo-100">月給合計 (固定費)</div>
            <div className="text-indigo-900 dark:text-indigo-100 tabular-nums font-bold text-xl">
              {formatYenMan(laborCost.monthlyTotal)}
            </div>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-900/30 rounded-md p-3">
            <div className="text-xs text-emerald-900 dark:text-emerald-100">時給合計</div>
            <div className="text-emerald-900 dark:text-emerald-100 tabular-nums font-bold text-xl">
              {formatYenMan(laborCost.allHourlyTotal)}
            </div>
            <div className="text-xs text-emerald-900/80 dark:text-emerald-100/80 mt-0.5">
              仮承認分 {formatYenMan(laborCost.tentativeHourlyTotal)}
            </div>
          </div>
        </div>
      </details>

      {/* md 以上: CostStat 風 3 tile */}
      <div className="hidden md:grid md:grid-cols-3 gap-2">
        <div className="rounded-[8px] border border-stone-200/70 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-2.5 py-2">
          <div className="text-[10px] font-medium text-stone-500 dark:text-stone-400">月給合計</div>
          <div className="mt-0.5 tabular-nums font-semibold text-stone-900 dark:text-stone-100" style={{ fontSize: 18, letterSpacing: '-0.02em' }}>
            {monthlySplit.yenMan}
            {monthlySplit.tail && <span className="text-[10px] opacity-60 ml-0.5">{monthlySplit.tail}</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[10px]" style={{ color: '#0d9488' }}>
            <span className="inline-block rounded-full" style={{ width: 5, height: 5, background: '#0d9488' }} />
            {monthlyCount} 名
          </div>
        </div>
        <div className="rounded-[8px] border border-stone-200/70 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-2.5 py-2">
          <div className="text-[10px] font-medium text-stone-500 dark:text-stone-400">時給合計</div>
          <div className="mt-0.5 tabular-nums font-semibold text-stone-900 dark:text-stone-100" style={{ fontSize: 18, letterSpacing: '-0.02em' }}>
            {hourlySplit.yenMan}
            {hourlySplit.tail && <span className="text-[10px] opacity-60 ml-0.5">{hourlySplit.tail}</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[10px]" style={{ color: '#ea580c' }}>
            <span className="inline-block rounded-full" style={{ width: 5, height: 5, background: '#ea580c' }} />
            {hourlyCount} 名
          </div>
        </div>
        <div className="rounded-[8px] border border-stone-200/70 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-2.5 py-2">
          <div className="text-[10px] font-medium text-stone-500 dark:text-stone-400">総計</div>
          <div className="mt-0.5 tabular-nums font-semibold text-blue-600" style={{ fontSize: 18, letterSpacing: '-0.02em' }}>
            {totalSplit.yenMan}
            {totalSplit.tail && <span className="text-[10px] opacity-60 ml-0.5">{totalSplit.tail}</span>}
          </div>
          <div className="mt-0.5 text-[10px] text-stone-500 dark:text-stone-400">月給 + 時給</div>
        </div>
      </div>
      <div className="text-[10px] text-stone-500 dark:text-stone-400 mt-2">
        ※ 月給は固定費として全月給メンバー分を計上
      </div>
      {showDetailTable && (
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
          <div className="hidden md:flex md:flex-col">
            <div className="text-[10px] font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider py-1.5">
              スタッフ別
            </div>
            <ul className="flex flex-col">
              {monthlyMembers.map(m => {
                const estimate = monthlyEstimatesMap.get(m.user_id);
                const cost = getEffectiveMonthlySalary(m, rolesMap);
                const hours = estimate ? Math.round(estimate.shiftMinutes / 60) : 0;
                const colorKey = getRoleColorKey(m);
                const roleColor = ROLE_COLOR_HEX[colorKey];
                const roleLabel = ROLE_COLOR_LABEL[colorKey];
                return (
                  <li
                    key={m.id}
                    className="flex items-center gap-2 py-2 border-t border-stone-200/70 dark:border-stone-700"
                    style={{ '--role-color': roleColor } as CSSProperties}
                  >
                    <MemberAvatar member={m} size={24} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-stone-900 dark:text-stone-50 truncate">{m.display_name}</div>
                      <div className="text-[11px] text-stone-500 dark:text-stone-400 truncate">{roleLabel} · 月給制</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[13px] font-semibold tabular-nums text-stone-900 dark:text-stone-50">¥{cost.toLocaleString()}</div>
                      <div className="text-[10px] text-stone-500 dark:text-stone-400 tabular-nums">{hours}h</div>
                    </div>
                  </li>
                );
              })}
              {hourlyEstimates.map(e => {
                const member = (members ?? []).find(mm => mm.user_id === e.userId);
                const hours = Math.round(e.shiftMinutes / 60);
                const colorKey = member ? getRoleColorKey(member) : 'parttime';
                const roleColor = ROLE_COLOR_HEX[colorKey];
                const roleLabel = ROLE_COLOR_LABEL[colorKey];
                return (
                  <li
                    key={e.userId}
                    className="flex items-center gap-2 py-2 border-t border-stone-200/70 dark:border-stone-700"
                    style={{ '--role-color': roleColor } as CSSProperties}
                  >
                    <MemberAvatar member={member} size={24} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-stone-900 dark:text-stone-50 truncate">{e.displayName}</div>
                      <div className="text-[11px] text-stone-500 dark:text-stone-400 truncate">{roleLabel} · 時給制</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[13px] font-semibold tabular-nums text-stone-900 dark:text-stone-50">¥{e.estimatedCost.toLocaleString()}</div>
                      <div className="text-[10px] text-stone-500 dark:text-stone-400 tabular-nums">{hours}h</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
      </div>
    </Card>
  );
}
