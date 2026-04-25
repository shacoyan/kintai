import { useState, useMemo, useEffect } from 'react';
import { useAdmin } from '../../hooks/useAdmin';
import { useShift } from '../../hooks/useShift';
import { useStoreContext } from '../../contexts/StoreContext';
import { parseISO, differenceInMinutes } from 'date-fns';
import type { AttendanceRecord, TenantMember, Shift } from '../../types';
import { generatePayrollCsv, downloadCsv } from '../../utils/csvExport';
import { getNightMinutesInRange, getNightMinutesForShift } from '../../utils/nightShift';
import { Download, Calculator } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { ErrorBanner } from '../ui/ErrorBanner';
import { PageSkeleton } from '../ui/Skeleton';

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

/**
 * 承認済みシフトをもとに給与を計算する（シフトベース）
 */
function calcMemberShiftPayroll(
  member: TenantMember,
  shifts: Shift[]
): PayrollRow {
  const rate = member.hourly_rate ?? 0;
  const payType = member.pay_type ?? 'hourly';
  const monthlySalary = member.monthly_salary ?? 0;

  // 承認済み（approved / modified）シフトのみを対象とする
  const approvedShifts = shifts.filter(
    (s) => s.user_id === member.user_id && (s.status === 'approved' || s.status === 'modified')
  );

  const dates = new Set<string>();
  let totalMinutes = 0;
  let normalMinutes = 0;
  let nightMinutes = 0;

  for (const s of approvedShifts) {
    dates.add(s.date);

    // 使用する開始・終了時刻（modified の場合は修正後の時刻を使う）
    const startTime = s.start_time;
    const endTime = s.end_time;

    const startParts = startTime.split(':').map(Number);
    const endParts = endTime.split(':').map(Number);
    const startMin = startParts[0] * 60 + startParts[1];
    const endMin = endParts[0] * 60 + endParts[1];
    // 日をまたぐシフトを考慮
    const shiftMins = endMin > startMin ? endMin - startMin : 24 * 60 - startMin + endMin;

    totalMinutes += shiftMins;

    if (member.night_shift_enabled) {
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

/**
 * シフトベースの給与データからCSVを生成する
 */
function generateShiftPayrollCsv(
  payrollData: PayrollRow[],
  _year: number,
  _month: number
): string {
  const csvEscape = (val: string | number): string => {
    const s = String(val);
    return `"${s.replace(/"/g, '""')}"`;
  };

  const fmtTime = (min: number): string => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  };

  const header = ['名前', '稼働予定日数', '通常時間', '深夜時間', '時給/月給', '支払額', '算出モード']
    .map(csvEscape)
    .join(',');

  const lines = payrollData.map((row) => {
    const rateLabel =
      row.payType === 'monthly'
        ? `${row.monthlySalary.toLocaleString()}円/月`
        : `${row.hourlyRate.toLocaleString()}円/時`;
    return [
      row.displayName,
      `${row.workDays}日`,
      fmtTime(row.normalMinutes),
      fmtTime(row.nightMinutes),
      rateLabel,
      row.payment,
      'シフトベース',
    ]
      .map(csvEscape)
      .join(',');
  });

  // 合計行
  const totalPayment = payrollData.reduce((s, r) => s + r.payment, 0);
  const totalNormal = payrollData.reduce((s, r) => s + r.normalMinutes, 0);
  const totalNight = payrollData.reduce((s, r) => s + r.nightMinutes, 0);
  lines.push(
    [
      '合計',
      '-',
      fmtTime(totalNormal),
      fmtTime(totalNight),
      '-',
      totalPayment,
      '',
    ]
      .map(csvEscape)
      .join(',')
  );

  const BOM = '\uFEFF';
  return BOM + header + '\n' + lines.join('\n');
}

export function PayrollCalculation({ tenantId }: PayrollCalculationProps) {
  const { members, allAttendance, loading, error, fetchMembers, fetchAllAttendance } = useAdmin(tenantId);
  const { currentStore } = useStoreContext();
  const { allShifts, loading: shiftsLoading, getAllShifts } = useShift(tenantId, currentStore?.id ?? null);
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [calculated, setCalculated] = useState(false);
  const [payrollMode, setPayrollMode] = useState<'actual' | 'shift'>('actual');

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleCalculate = async () => {
    setCalculated(false);
    const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
    const lastDay = new Date(selectedYear, selectedMonth, 0).getDate();
    const endDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    if (payrollMode === 'actual') {
      await fetchAllAttendance(selectedYear, selectedMonth);
    } else {
      await getAllShifts(startDate, endDate);
    }
    setCalculated(true);
  };

  const isLoading = loading || shiftsLoading;

  const payrollData: PayrollRow[] = useMemo(() => {
    if (!calculated) return [];

    if (payrollMode === 'shift') {
      return members.map((m) => calcMemberShiftPayroll(m, allShifts));
    }

    // 実績ベース
    const grouped: Record<string, AttendanceRecord[]> = {};
    allAttendance.forEach((r) => {
      if (!grouped[r.user_id]) grouped[r.user_id] = [];
      grouped[r.user_id].push(r);
    });
    return members.map((m) => calcMemberPayroll(m, grouped[m.user_id] || []));
  }, [calculated, allAttendance, allShifts, members, payrollMode]);

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

  // データが存在するかどうかの判定
  const hasData =
    payrollMode === 'actual' ? allAttendance.length > 0 : allShifts.length > 0;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">給与計算</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">月次の勤怠データから給与を計算します</p>
      </div>

      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
        <div className="flex flex-wrap items-center gap-3">
          {/* 年月セレクト */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">年</label>
            <select
              value={selectedYear}
              onChange={(e) => { setSelectedYear(Number(e.target.value)); setCalculated(false); }}
              className="block w-28 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white dark:border-gray-600"
            >
              {yearOpts.map((y) => <option key={y} value={y}>{y}年</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">月</label>
            <select
              value={selectedMonth}
              onChange={(e) => { setSelectedMonth(Number(e.target.value)); setCalculated(false); }}
              className="block w-24 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white dark:border-gray-600"
            >
              {monthOpts.map((m) => <option key={m} value={m}>{m}月</option>)}
            </select>
          </div>

          {/* モード切り替えトグル */}
          <div className="flex gap-1 bg-gray-200 dark:bg-gray-600 rounded-lg p-1">
            <button
              onClick={() => { setPayrollMode('actual'); setCalculated(false); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                payrollMode === 'actual'
                  ? 'bg-white dark:bg-gray-800 text-blue-700 dark:text-blue-300 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              実績ベース
            </button>
            <button
              onClick={() => { setPayrollMode('shift'); setCalculated(false); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                payrollMode === 'shift'
                  ? 'bg-white dark:bg-gray-800 text-blue-700 dark:text-blue-300 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              シフトベース
            </button>
          </div>

          {/* 計算ボタン */}
          <button
            onClick={handleCalculate}
            disabled={isLoading}
            className="btn-primary inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isLoading ? '計算中...' : '計算'}
          </button>

          {/* CSVダウンロード */}
          {calculated && hasData && (
            <button
              onClick={() => {
                let csv: string;
                let filename: string;
                if (payrollMode === 'shift') {
                  csv = generateShiftPayrollCsv(payrollData, selectedYear, selectedMonth);
                  filename = `給与計算_シフトベース_${selectedYear}年${selectedMonth}月.csv`;
                } else {
                  csv = generatePayrollCsv(allAttendance, members);
                  filename = `給与計算_${selectedYear}年${selectedMonth}月.csv`;
                }
                downloadCsv(csv, filename);
              }}
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-md hover:bg-green-100 dark:hover:bg-green-900/50 transition"
            >
              <Download className="w-4 h-4 mr-1.5" />
              CSVダウンロード
            </button>
          )}
        </div>

        {/* モード説明バナー */}
        {payrollMode === 'shift' && (
          <p className="mt-2 text-xs text-blue-600 dark:text-blue-400">
            シフトベース: 承認済みシフト（approved / modified）の時間をもとに給与を計算します
          </p>
        )}
      </div>

      {error && (
        <ErrorBanner message={error} onRetry={handleCalculate} />
      )}

      {isLoading && !calculated ? (
        <div className="p-6">
          <PageSkeleton />
        </div>
      ) : calculated && (
        <div className="overflow-x-auto">
          {!hasData ? (
            <EmptyState 
              icon={<Calculator className="w-12 h-12 text-slate-400" />} 
              title={`${selectedYear}年${selectedMonth}月のデータはありません`} 
              description={`${payrollMode === 'shift' ? 'シフト' : '勤怠'}データが該当月にありません`} 
            />
          ) : (
            <>
              {/* モードラベル */}
              <div className="px-6 py-2 flex items-center gap-2 border-b border-gray-100 dark:border-gray-700">
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    payrollMode === 'shift'
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300'
                      : 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300'
                  }`}
                >
                  {payrollMode === 'shift' ? 'シフトベース' : '実績ベース'}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {selectedYear}年{selectedMonth}月 給与計算結果
                </span>
              </div>

              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">名前</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {payrollMode === 'shift' ? '稼働予定日数' : '稼働日数'}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">通常時間</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">深夜時間</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">時給/月給</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">支払額</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {payrollData.map((row) => (
                    <tr key={row.userId} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{row.displayName}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 text-right">{row.workDays}日</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 text-right" title="休憩を除く">{fmtTime(row.normalMinutes)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right" title="22:00〜翌5:00 は 1.25 倍">
                        {row.nightMinutes > 0 ? (
                          <span className="text-purple-700 dark:text-purple-300 font-medium">{fmtTime(row.nightMinutes)}</span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">-</span>
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
                    <td className="px-6 py-4 text-sm font-bold text-gray-900 dark:text-gray-100 text-right" title="休憩を除く">{fmtTime(totalMinutes - totalNightMinutes)}</td>
                    <td className="px-6 py-4 text-sm font-bold text-purple-700 dark:text-purple-300 text-right" title="22:00〜翌5:00 は 1.25 倍">{totalNightMinutes > 0 ? fmtTime(totalNightMinutes) : '-'}</td>
                    <td className="px-6 py-4 text-right">-</td>
                    <td className="px-6 py-4 text-base font-bold text-gray-900 dark:text-gray-100 text-right">¥{totalPayment.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
