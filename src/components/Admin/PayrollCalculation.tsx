import { useState, useMemo, useEffect } from 'react';
import { useAdmin } from '../../hooks/useAdmin';
import { parseISO, differenceInMinutes } from 'date-fns';
import type { AttendanceRecord, TenantMember } from '../../types';
import { generatePayrollCsv, downloadCsv } from '../../utils/csvExport';
import { getNightMinutesInRange } from '../../utils/nightShift';

interface PayrollCalculationProps {
  tenantId: string;
}

interface PayrollRow {
  userId: string;
  displayName: string;
  payType: 'hourly' | 'monthly';
  hourlyRate: number;
  monthlySalary: number;
  nightShiftEnabled: boolean;
  workDays: number;
  totalMinutes: number;
  normalMinutes: number;
  nightMinutes: number;
  payment: number;
}

/**
 * 勤務時間を通常時間と深夜時間（22:00〜翌5:00）に分割する
 */
function splitNightMinutes(clockIn: string, clockOut: string): { normal: number; night: number } {
  const start = parseISO(clockIn);
  const end = parseISO(clockOut);
  const totalMins = differenceInMinutes(end, start);
  if (totalMins <= 0) return { normal: 0, night: 0 };

  const nightMins = getNightMinutesInRange(start, end);
  return { normal: totalMins - nightMins, night: nightMins };
}

function calcMemberPayroll(
  member: TenantMember,
  records: AttendanceRecord[]
): PayrollRow {
  const rate = member.hourly_rate ?? 0;
  const dates = new Set<string>();
  let totalMinutes = 0;
  let normalMinutes = 0;
  let nightMinutes = 0;

  for (const r of records) {
    if (!r.clock_in) continue;
    dates.add(r.date);

    // total_work_minutes が null の場合、clock_in/clock_out から再計算
    let workMins = r.total_work_minutes;
    if (workMins == null && r.clock_in && r.clock_out) {
      const gross = differenceInMinutes(parseISO(r.clock_out), parseISO(r.clock_in));
      const breakMins = (r.breaks || []).reduce((sum, b) => {
        if (b.start_time && b.end_time) {
          return sum + differenceInMinutes(parseISO(b.end_time), parseISO(b.start_time));
        }
        return sum;
      }, 0);
      workMins = Math.max(0, gross - breakMins);
    }
    if (workMins == null || workMins <= 0) continue;

    totalMinutes += workMins;

    if (member.night_shift_enabled && r.clock_in && r.clock_out) {
      const { normal, night } = splitNightMinutes(r.clock_in, r.clock_out);
      // 休憩時間を通常/深夜に分割
      let breakNormalMins = 0;
      let breakNightMins = 0;
      if (r.breaks && r.breaks.length > 0) {
        for (const b of r.breaks) {
          if (b.start_time && b.end_time) {
            const bStart = parseISO(b.start_time);
            const bEnd = parseISO(b.end_time);
            const bNight = getNightMinutesInRange(bStart, bEnd);
            const bTotal = differenceInMinutes(bEnd, bStart);
            breakNightMins += bNight;
            breakNormalMins += bTotal - bNight;
          }
        }
      }
      const adjustedNormal = Math.max(0, normal - breakNormalMins);
      const adjustedNight = Math.max(0, night - breakNightMins);
      normalMinutes += adjustedNormal;
      nightMinutes += adjustedNight;
    } else {
      normalMinutes += workMins;
    }
  }

  const payType = member.pay_type ?? 'hourly';
  const monthlySalary = member.monthly_salary ?? 0;

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
    hourlyRate: rate,
    monthlySalary,
    nightShiftEnabled: member.night_shift_enabled ?? false,
    workDays: dates.size,
    totalMinutes,
    normalMinutes,
    nightMinutes,
    payment,
  };
}

export function PayrollCalculation({ tenantId }: PayrollCalculationProps) {
  const { members, allAttendance, loading, error, fetchMembers, fetchAllAttendance } = useAdmin(tenantId);
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [calculated, setCalculated] = useState(false);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleCalculate = async () => {
    setCalculated(false);
    await fetchAllAttendance(selectedYear, selectedMonth);
    setCalculated(true);
  };

  const payrollData: PayrollRow[] = useMemo(() => {
    if (!calculated) return [];

    const grouped: Record<string, AttendanceRecord[]> = {};
    allAttendance.forEach((r) => {
      if (!grouped[r.user_id]) grouped[r.user_id] = [];
      grouped[r.user_id].push(r);
    });

    return members.map((m) => calcMemberPayroll(m, grouped[m.user_id] || []));
  }, [calculated, allAttendance, members]);

  const totalPayment = payrollData.reduce((s, r) => s + r.payment, 0);
  const totalMinutes = payrollData.reduce((s, r) => s + r.totalMinutes, 0);
  const totalNightMinutes = payrollData.reduce((s, r) => s + r.nightMinutes, 0);

  const fmtTime = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  };

  const yearOpts = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);
  const monthOpts = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">給与計算</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">月次の勤怠データから給与を計算します</p>
      </div>

      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">年</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="block w-28 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white dark:border-gray-600"
            >
              {yearOpts.map((y) => <option key={y} value={y}>{y}年</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">月</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="block w-24 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white dark:border-gray-600"
            >
              {monthOpts.map((m) => <option key={m} value={m}>{m}月</option>)}
            </select>
          </div>
          <button
            onClick={handleCalculate}
            disabled={loading}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {loading ? '計算中...' : '計算'}
          </button>
          {calculated && allAttendance.length > 0 && (
            <button
              onClick={() => {
                const csv = generatePayrollCsv(allAttendance, members);
                downloadCsv(csv, `給与計算_${selectedYear}年${selectedMonth}月.csv`);
              }}
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-md hover:bg-green-100 dark:hover:bg-green-900/50 transition"
            >
              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              CSVダウンロード
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-gray-700 rounded-md">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {calculated && (
        <div className="overflow-x-auto">
          {allAttendance.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
              {selectedYear}年{selectedMonth}月の勤怠データはありません
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">名前</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">稼働日数</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">通常時間</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">深夜時間</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">時給/月給</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">支払額</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {payrollData.map((row) => (
                  <tr key={row.userId} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{row.displayName}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 text-right">{row.workDays}日</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 text-right">{fmtTime(row.normalMinutes)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                      {row.nightMinutes > 0 ? (
                        <span className="text-purple-700 dark:text-purple-300 font-medium">{fmtTime(row.nightMinutes)}</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 text-right">
                      {row.payType === 'monthly' ? (
                        <span>¥{row.monthlySalary.toLocaleString()}/月</span>
                      ) : (
                        <span>¥{row.hourlyRate.toLocaleString()}/時</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 text-right font-medium">¥{row.payment.toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 dark:bg-gray-700 border-t-2 border-gray-300 dark:border-gray-600">
                  <td className="px-6 py-4 text-sm font-bold text-gray-900 dark:text-gray-100">合計</td>
                  <td className="px-6 py-4 text-sm font-bold text-gray-900 dark:text-gray-100 text-right">-</td>
                  <td className="px-6 py-4 text-sm font-bold text-gray-900 dark:text-gray-100 text-right">{fmtTime(totalMinutes - totalNightMinutes)}</td>
                  <td className="px-6 py-4 text-sm font-bold text-purple-700 dark:text-purple-300 text-right">{totalNightMinutes > 0 ? fmtTime(totalNightMinutes) : '-'}</td>
                  <td className="px-6 py-4 text-right">-</td>
                  <td className="px-6 py-4 text-base font-bold text-gray-900 dark:text-gray-100 text-right">¥{totalPayment.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
