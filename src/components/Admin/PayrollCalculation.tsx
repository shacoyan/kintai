import { useState, useMemo, useEffect } from 'react';
import { useAdmin } from '../../hooks/useAdmin';
import { parseISO, differenceInMinutes } from 'date-fns';
import type { AttendanceRecord, TenantMember } from '../../types';

interface PayrollCalculationProps {
  tenantId: string;
}

interface PayrollRow {
  userId: string;
  displayName: string;
  hourlyRate: number;
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

  let nightMins = 0;
  // 1分単位でチェック（精度と速度のバランス）
  const cursor = new Date(start);
  for (let i = 0; i < totalMins; i++) {
    const h = cursor.getHours();
    // 22:00〜23:59 or 0:00〜4:59 = 深夜帯
    if (h >= 22 || h < 5) {
      nightMins++;
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

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
    totalMinutes += r.total_work_minutes || 0;
    if (r.clock_in) dates.add(r.date);

    if (member.night_shift_enabled && r.clock_in && r.clock_out) {
      const { normal, night } = splitNightMinutes(r.clock_in, r.clock_out);
      // 休憩分を差し引く（total_work_minutesが実労働時間）
      const breakMins = differenceInMinutes(parseISO(r.clock_out), parseISO(r.clock_in)) - (r.total_work_minutes || 0);
      // 休憩を通常時間から優先的に差し引く
      const adjustedNormal = Math.max(0, normal - breakMins);
      const adjustedNight = Math.min(night, (r.total_work_minutes || 0) - adjustedNormal);
      normalMinutes += adjustedNormal;
      nightMinutes += Math.max(0, adjustedNight);
    } else {
      normalMinutes += r.total_work_minutes || 0;
    }
  }

  const normalPay = (normalMinutes / 60) * rate;
  const nightPay = (nightMinutes / 60) * rate * 1.25;
  const payment = Math.ceil(normalPay + nightPay);

  return {
    userId: member.user_id,
    displayName: member.display_name,
    hourlyRate: rate,
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
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">給与計算</h2>
        <p className="mt-1 text-sm text-gray-500">月次の勤怠データから給与を計算します</p>
      </div>

      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">年</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="block w-28 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {yearOpts.map((y) => <option key={y} value={y}>{y}年</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">月</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="block w-24 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
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
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {calculated && (
        <div className="overflow-x-auto">
          {payrollData.every((r) => r.totalMinutes === 0) ? (
            <div className="px-6 py-12 text-center text-gray-500">
              {selectedYear}年{selectedMonth}月の勤怠データはありません
              <p className="mt-2 text-xs text-gray-400">
                取得件数: {allAttendance.length}件 / メンバー: {members.length}人
              </p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">名前</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">稼働日数</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">通常時間</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">深夜時間</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">時給</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">支払額</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {payrollData.map((row) => (
                  <tr key={row.userId} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{row.displayName}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 text-right">{row.workDays}日</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 text-right">{fmtTime(row.normalMinutes)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                      {row.nightMinutes > 0 ? (
                        <span className="text-purple-700 font-medium">{fmtTime(row.nightMinutes)}</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 text-right">¥{row.hourlyRate.toLocaleString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">¥{row.payment.toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 border-t-2 border-gray-300">
                  <td className="px-6 py-4 text-sm font-bold text-gray-900">合計</td>
                  <td className="px-6 py-4 text-sm font-bold text-gray-900 text-right">-</td>
                  <td className="px-6 py-4 text-sm font-bold text-gray-900 text-right">{fmtTime(totalMinutes - totalNightMinutes)}</td>
                  <td className="px-6 py-4 text-sm font-bold text-purple-700 text-right">{totalNightMinutes > 0 ? fmtTime(totalNightMinutes) : '-'}</td>
                  <td className="px-6 py-4 text-right">-</td>
                  <td className="px-6 py-4 text-base font-bold text-gray-900 text-right">¥{totalPayment.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
