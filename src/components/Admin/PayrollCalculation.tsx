import { useState, useMemo, useEffect } from 'react';
import { useTenantAdmin } from '../../hooks/useTenantAdmin';
import { useShift } from '../../hooks/useShift';
import { useStoreContext } from '../../contexts/StoreContext';
import { parseISO, differenceInMinutes } from 'date-fns';
import type { AttendanceRecord, TenantMember, Shift, TenantRole } from '../../types';
import { useTenantRoles } from '../../hooks/useTenantRoles';
import { generatePayrollCsv, downloadCsv } from '../../utils/csvExport';
import { getNightMinutesInRange, getNightMinutesForShift } from '../../utils/nightShift';
import { Download, Calculator, Lock, Printer } from 'lucide-react';
import { EmptyState, ErrorBanner, PageSkeleton, Button, Card, Select, Badge, StatCard, Heading } from '../ui';
import { usePayrollRun } from '../../hooks/usePayrollRun';
import { useTenant, usePayrollCloseDay } from '../../hooks/useTenant';
import { PayrollSlipPrintView } from './PayrollSlipPrintView';
import { messages } from '../../lib/messages';

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

/**
 * Loop 11b L11b-3: 役職フォールバック付き時給/月給算出
 * 個別 hourly_rate が設定されていればそれを優先、未設定なら役職の default を継承、それも無ければ 0。
 */
function getEffectiveHourlyRate(m: TenantMember, rolesMap: Map<string, TenantRole>): number {
  if (m.hourly_rate != null) return m.hourly_rate;
  if (m.role_id) {
    const role = rolesMap.get(m.role_id);
    if (role?.default_hourly_rate != null) return role.default_hourly_rate;
  }
  return 0;
}

function getEffectiveMonthlySalary(m: TenantMember, rolesMap: Map<string, TenantRole>): number {
  if (m.monthly_salary != null) return m.monthly_salary;
  if (m.role_id) {
    const role = rolesMap.get(m.role_id);
    if (role?.default_monthly_salary != null) return role.default_monthly_salary;
  }
  return 0;
}

function calcMemberPayroll(
  member: TenantMember,
  records: AttendanceRecord[],
  rolesMap: Map<string, TenantRole>
): PayrollRow {
  const rate = getEffectiveHourlyRate(member, rolesMap);
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
  const monthlySalary = getEffectiveMonthlySalary(member, rolesMap);

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
  shifts: Shift[],
  rolesMap: Map<string, TenantRole>
): PayrollRow {
  const rate = getEffectiveHourlyRate(member, rolesMap);
  const payType = member.pay_type ?? 'hourly';
  const monthlySalary = getEffectiveMonthlySalary(member, rolesMap);

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
  const { members, allAttendance, loading, error, fetchMembers, fetchAllAttendance } = useTenantAdmin(tenantId);
  const { currentStore } = useStoreContext();
  const { allShifts, loading: shiftsLoading, getAllShifts } = useShift(tenantId, currentStore?.id ?? null);
  const { myRole } = useTenant();
  const { closeDay } = usePayrollCloseDay(tenantId);
  const { fetchRun, finalizeRun, unfinalizeRun, loading: runLoading } = usePayrollRun(tenantId, currentStore?.id ?? null);
  // === Loop 11b L11b-3: 役職時給フォールバック ===
  const { roles: tenantRoles, fetchRoles: fetchTenantRoles } = useTenantRoles(tenantId);
  useEffect(() => { fetchTenantRoles(); }, [fetchTenantRoles]);
  const rolesMap = useMemo(() => {
    const m = new Map<string, typeof tenantRoles[number]>();
    for (const r of tenantRoles) m.set(r.id, r);
    return m;
  }, [tenantRoles]);
  // === /Loop 11b L11b-3 ===
  const deleteRun = unfinalizeRun;
  const [run, setRun] = useState<{
    id: string;
    confirmedAt: string;
    confirmedBy: string | null;
    items: Array<{
      userId: string;
      displayName: string;
      payType: 'hourly' | 'monthly';
      hourlyRate: number;
      monthlySalary: number;
      workDays: number;
      normalMinutes: number;
      nightMinutes: number;
      payment: number;
    }>;
  } | null>(null);

  
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [calculated, setCalculated] = useState(false);
  const [payrollMode, setPayrollMode] = useState<'actual' | 'shift'>('actual');

  useEffect(() => {
    fetchMembers(currentStore?.id ?? null);
  }, [fetchMembers, currentStore?.id]);

  // currentStore 変更時に calculated を false に戻す
  useEffect(() => {
    setCalculated(false);
  }, [currentStore?.id]);

  useEffect(() => {
    const targetMonth = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
    fetchRun(targetMonth, payrollMode).then((res) => {
      if (res) {
        setRun({
          id: res.run.id,
          confirmedAt: res.run.finalized_at,
          confirmedBy: res.run.finalized_by,
          items: res.items.map((it) => ({
            userId: it.user_id,
            displayName: it.display_name,
            payType: it.pay_type,
            hourlyRate: it.hourly_rate,
            monthlySalary: it.monthly_salary,
            workDays: it.work_days,
            normalMinutes: it.normal_minutes,
            nightMinutes: it.night_minutes,
            payment: it.payment,
          })),
        });
      } else {
        setRun(null);
      }
    });
  }, [selectedYear, selectedMonth, payrollMode, fetchRun]);

  const handleCalculate = async () => {
    setCalculated(false);
    const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
    const lastDay = new Date(selectedYear, selectedMonth, 0).getDate();
    const endDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    if (payrollMode === 'actual') {
      await fetchAllAttendance(selectedYear, selectedMonth, currentStore?.id ?? null);
    } else {
      await getAllShifts(startDate, endDate);
    }
    setCalculated(true);
  };

  const isLoading = loading || shiftsLoading || runLoading;

  const calculatedPayrollData: PayrollRow[] = useMemo(() => {
    if (!calculated) return [];

    if (payrollMode === 'shift') {
      return members.map((m) => calcMemberShiftPayroll(m, allShifts, rolesMap));
    }

    // 実績ベース
    const grouped: Record<string, AttendanceRecord[]> = {};
    allAttendance.forEach((r) => {
      if (!grouped[r.user_id]) grouped[r.user_id] = [];
      grouped[r.user_id].push(r);
    });
    return members.map((m) => calcMemberPayroll(m, grouped[m.user_id] || [], rolesMap));
  }, [calculated, allAttendance, allShifts, members, payrollMode, rolesMap]);

  const payrollData: PayrollRow[] = useMemo(() => {
    if (run && run.items) {
      return run.items.map(item => ({
        userId: item.userId,
        displayName: item.displayName,
        payType: item.payType,
        hourlyRate: item.hourlyRate,
        monthlySalary: item.monthlySalary,
        nightShiftEnabled: false,
        workDays: item.workDays,
        totalMinutes: item.normalMinutes + item.nightMinutes,
        normalMinutes: item.normalMinutes,
        nightMinutes: item.nightMinutes,
        payment: item.payment,
      }));
    }
    return calculatedPayrollData;
  }, [run, calculatedPayrollData]);

  const isFinalized = !!run;

  const totalPayment = payrollData.reduce((s, r) => s + r.payment, 0);
  const grandTotalMinutes = payrollData.reduce((s, r) => s + r.totalMinutes, 0);
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

  // CSVファイル名用の店舗名
  const storeLabel = currentStore?.name ?? '全店舗';

  const handleFinalize = async () => {
    if (!window.confirm(messages.confirm.finalizePayroll(selectedYear, selectedMonth))) return;
    
    await finalizeRun({
      targetMonth: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`,
      mode: payrollMode,
      closeDay,
      payrollData: payrollData.map(r => ({
        userId: r.userId,
        displayName: r.displayName,
        payType: r.payType,
        hourlyRate: r.hourlyRate,
        monthlySalary: r.monthlySalary,
        workDays: r.workDays,
        normalMinutes: r.normalMinutes,
        nightMinutes: r.nightMinutes,
        payment: r.payment,
      })),
    });
    
    fetchRun(`${selectedYear}-${String(selectedMonth).padStart(2, "0")}`, payrollMode);
  };

  const handleUnfinalize = async () => {
    if (!window.confirm(messages.confirm.unfinalizePayroll(selectedYear, selectedMonth))) return;
    await deleteRun(run!.id);
    fetchRun(`${selectedYear}-${String(selectedMonth).padStart(2, "0")}`, payrollMode);
  };

  return (
    <Card padding="none">
      <Card.Header>
        <div className="flex justify-between items-start">
          <div>
            <Heading level={2}>給与計算</Heading>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-300">月次の勤怠データから給与を計算します</p>
          </div>
          <div className="text-sm text-neutral-600 dark:text-neutral-300">
            締め日: {closeDay === 31 || !closeDay ? '月末' : `${closeDay}日`}
          </div>
        </div>
      </Card.Header>

      <div className="px-6 py-4 border-b border-neutral-100 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800">
        <div className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-center xl:gap-3">
          {/* 年月セレクト */}
          <div className="grid grid-cols-2 gap-2 xl:contents">
            <div className="w-full xl:w-28">
              <Select
                label="年"
                value={selectedYear}
                onChange={(e) => { setSelectedYear(Number(e.target.value)); setCalculated(false); }}
              >
                {yearOpts.map((y) => <option key={y} value={y}>{y}年</option>)}
              </Select>
            </div>
            <div className="w-full xl:w-24">
              <Select
                label="月"
                value={selectedMonth}
                onChange={(e) => { setSelectedMonth(Number(e.target.value)); setCalculated(false); }}
              >
                {monthOpts.map((m) => <option key={m} value={m}>{m}月</option>)}
              </Select>
            </div>
          </div>

          {/* モード切り替えトグル（segmented control 階層） */}
          <div className="flex w-full xl:inline-flex xl:w-auto gap-1 bg-neutral-100 dark:bg-neutral-800 rounded-md p-1">
            <button
              onClick={() => { setPayrollMode('actual'); setCalculated(false); }}
              className={`flex-1 xl:flex-initial px-3 py-2 text-xs font-medium rounded-md motion-safe:transition-colors duration-120 ease-out-expo ${
                payrollMode === 'actual'
                  ? 'bg-white text-primary-700 shadow-sm dark:bg-neutral-700 dark:text-primary-300'
                  : 'text-neutral-600 hover:bg-white/60 dark:text-neutral-300 dark:hover:bg-neutral-700/60'
              }`}
            >
              実績ベース
            </button>
            <button
              onClick={() => { setPayrollMode('shift'); setCalculated(false); }}
              className={`flex-1 xl:flex-initial px-3 py-2 text-xs font-medium rounded-md motion-safe:transition-colors duration-120 ease-out-expo ${
                payrollMode === 'shift'
                  ? 'bg-white text-primary-700 shadow-sm dark:bg-neutral-700 dark:text-primary-300'
                  : 'text-neutral-600 hover:bg-white/60 dark:text-neutral-300 dark:hover:bg-neutral-700/60'
              }`}
            >
              シフトベース
            </button>
          </div>

          {/* 計算ボタン */}
          <Button
            variant="primary"
            size="md"
            loading={isLoading}
            iconLeft={<Calculator size={16} />}
            onClick={handleCalculate}
            disabled={isLoading || isFinalized}
            className="w-full xl:w-auto min-h-[44px]"
          >
            計算
          </Button>

          {!isFinalized && calculated && hasData && (myRole === 'owner' || myRole === 'manager') && (
            <Button
              variant="primary"
              size="md"
              loading={runLoading}
              iconLeft={<Lock size={16} />}
              onClick={handleFinalize}
              disabled={isLoading}
              className="w-full xl:w-auto min-h-[44px]"
            >
              この月を確定
            </Button>
          )}

          {isFinalized && myRole === 'owner' && (
            <Button
              variant="danger"
              size="md"
              loading={runLoading}
              onClick={handleUnfinalize}
              disabled={isLoading}
              className="w-full xl:w-auto min-h-[44px]"
            >
              確定を取消
            </Button>
          )}

          {/* CSVダウンロード */}
          {((calculated && hasData) || isFinalized) && (
            <Button
              variant="secondary"
              size="md"
              iconLeft={<Download size={16} />}
              onClick={() => {
                let csv: string;
                let filename: string;
                if (payrollMode === 'shift') {
                  csv = generateShiftPayrollCsv(payrollData, selectedYear, selectedMonth);
                  filename = `給与計算_シフトベース_${storeLabel}_${selectedYear}年${selectedMonth}月.csv`;
                } else {
                  csv = generatePayrollCsv(allAttendance, members);
                  filename = `給与計算_${storeLabel}_${selectedYear}年${selectedMonth}月.csv`;
                }
                downloadCsv(csv, filename);
              }}
              className="w-full xl:w-auto min-h-[44px]"
            >
              CSVダウンロード
            </Button>
          )}

          {/* 給与明細を印刷 */}
          {((calculated && hasData) || isFinalized) && payrollData.length > 0 && (
            <Button
              variant="secondary"
              size="md"
              iconLeft={<Printer size={16} />}
              onClick={() => window.print()}
              className="w-full xl:w-auto min-h-[44px]"
            >
              明細を印刷
            </Button>
          )}
        </div>

        {/* モード説明バナー */}
        {payrollMode === 'shift' && (
          <p className="mt-2 text-xs text-info-600 dark:text-info-400">
            シフトベース: 承認済みシフト（approved / modified）の時間をもとに給与を計算します
          </p>
        )}
      </div>

      {isFinalized && (
        <div className="px-6 py-3 border-b border-neutral-100 dark:border-neutral-700 bg-success-50 dark:bg-success-900/20">
          <Badge tone="success">
            確定済（{run.confirmedAt} 確定 / 確定者: {run.confirmedBy}）
          </Badge>
        </div>
      )}

      {error && (
        <ErrorBanner message={error?.message ?? ''} onRetry={handleCalculate} />
      )}

      {isLoading && !calculated && !isFinalized ? (
        <div className="p-6">
          <PageSkeleton />
        </div>
      ) : (calculated || isFinalized) && (
        <div className="overflow-x-auto">
          {(!hasData && !isFinalized) ? (
            <EmptyState 
              icon={<Calculator className="w-12 h-12 text-neutral-400 dark:text-neutral-500" />} 
              title={`${selectedYear}年${selectedMonth}月のデータはありません`} 
              description={`${payrollMode === 'shift' ? 'シフト' : '勤怠'}データが該当月にありません`} 
            />
          ) : (
            <>
              {/* モードラベル */}
              <div className="px-6 py-2 flex items-center gap-2 border-b border-neutral-100 dark:border-neutral-700">
                <Badge tone="info">
                  {payrollMode === 'shift' ? 'シフトベース' : '実績ベース'}
                </Badge>
                <span className="text-xs text-neutral-500 dark:text-neutral-300">
                  {selectedYear}年{selectedMonth}月 給与計算結果
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-4">
                <StatCard label="総支払額" value={totalPayment.toLocaleString()} unit="円" />
                <StatCard label="対象人数" value={payrollData.length} unit="名" />
                <StatCard label="総労働時間" value={fmtTime(grandTotalMinutes)} />
                <StatCard label="総夜勤時間" value={fmtTime(totalNightMinutes)} />
              </div>

              <div className="sm:hidden">
                {payrollData.map((row) => (
                  <div key={row.userId} className="p-4 border-b last:border-b-0 border-neutral-200 dark:border-neutral-700">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-neutral-900 dark:text-neutral-100">{row.displayName}</span>
                      <Badge tone="primary">
                        <span className="text-base font-bold">¥{row.payment.toLocaleString()}</span>
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-300">稼働日数</div>
                        <div className="font-medium text-neutral-900 dark:text-neutral-100">{row.workDays}日</div>
                      </div>
                      <div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-300">通常時間</div>
                        <div className="font-medium text-neutral-900 dark:text-neutral-100">{fmtTime(row.normalMinutes)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-300">深夜時間</div>
                        {row.nightMinutes > 0 ? (
                          <div className="font-medium text-warning-700 dark:text-warning-300">{fmtTime(row.nightMinutes)}</div>
                        ) : (
                          <div className="font-medium text-neutral-400 dark:text-neutral-500">-</div>
                        )}
                      </div>
                      <div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-300">時給/月給</div>
                        <div className="font-medium text-neutral-900 dark:text-neutral-100">
                          {row.payType === 'monthly' ? `¥${row.monthlySalary.toLocaleString()}/月` : `¥${row.hourlyRate.toLocaleString()}/時`}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="p-4 bg-neutral-50 dark:bg-neutral-700 border-t-2 border-neutral-300 dark:border-neutral-600">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-neutral-900 dark:text-neutral-100">合計</span>
                    <span className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">¥{totalPayment.toLocaleString()}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-xs text-neutral-500 dark:text-neutral-300">通常時間合計</div>
                      <div className="font-medium text-neutral-900 dark:text-neutral-100">{fmtTime(grandTotalMinutes - totalNightMinutes)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-neutral-500 dark:text-neutral-300">深夜時間合計</div>
                      <div className="font-medium text-warning-700 dark:text-warning-300">{totalNightMinutes > 0 ? fmtTime(totalNightMinutes) : '-'}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
                  <thead className="bg-neutral-50 dark:bg-neutral-700">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">名前</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                        {payrollMode === 'shift' ? '稼働予定日数' : '稼働日数'}
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">通常時間</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">深夜時間</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">時給/月給</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">支払額</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums bg-white dark:bg-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-700">
                    {payrollData.map((row) => (
                      <tr key={row.userId} className="hover:bg-neutral-50 dark:hover:bg-neutral-700">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-neutral-900 dark:text-neutral-100">{row.displayName}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-700 dark:text-neutral-300 text-right">{row.workDays}日</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-700 dark:text-neutral-300 text-right" title="休憩を除く">{fmtTime(row.normalMinutes)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right" title="22:00〜翌5:00 は 1.25 倍">
                          {row.nightMinutes > 0 ? (
                            <span className="text-warning-700 dark:text-warning-300 font-medium">{fmtTime(row.nightMinutes)}</span>
                          ) : (
                            <span className="text-neutral-400 dark:text-neutral-500">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-700 dark:text-neutral-300 text-right">
                          {row.payType === 'monthly' ? (
                            <span>¥{row.monthlySalary.toLocaleString()}/月</span>
                          ) : (
                            <span>¥{row.hourlyRate.toLocaleString()}/時</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-900 dark:text-neutral-100 text-right font-medium">¥{row.payment.toLocaleString()}</td>
                      </tr>
                    ))}
                    <tr className="bg-neutral-50 dark:bg-neutral-700 border-t-2 border-neutral-300 dark:border-neutral-600">
                      <td className="px-6 py-4 text-sm font-bold text-neutral-900 dark:text-neutral-100">合計</td>
                      <td className="px-6 py-4 text-sm font-bold text-neutral-900 dark:text-neutral-100 text-right">-</td>
                      <td className="px-6 py-4 text-sm font-bold text-neutral-900 dark:text-neutral-100 text-right" title="休憩を除く">{fmtTime(grandTotalMinutes - totalNightMinutes)}</td>
                      <td className="px-6 py-4 text-sm font-bold text-warning-700 dark:text-warning-300 text-right" title="22:00〜翌5:00 は 1.25 倍">{totalNightMinutes > 0 ? fmtTime(totalNightMinutes) : '-'}</td>
                      <td className="px-6 py-4 text-right">-</td>
                      <td className="px-6 py-4 text-base font-bold text-neutral-900 dark:text-neutral-100 text-right">¥{totalPayment.toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* 印刷専用ビュー（@media print のみ表示） */}
      {((calculated && hasData) || isFinalized) && payrollData.length > 0 && (
        <PayrollSlipPrintView
          storeName={storeLabel}
          year={selectedYear}
          month={selectedMonth}
          rows={payrollData.map((r) => ({
            userId: r.userId,
            displayName: r.displayName,
            payType: r.payType,
            hourlyRate: r.hourlyRate,
            monthlySalary: r.monthlySalary,
            workDays: r.workDays,
            normalMinutes: r.normalMinutes,
            nightMinutes: r.nightMinutes,
            payment: r.payment,
          }))}
        />
      )}
    </Card>
  );
}
