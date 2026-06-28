import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { useTenant } from '../hooks/useTenant';
import { useCan } from '../lib/permissions/useCan';
import { useNow } from '../hooks/useNow';
import { useStoreContext } from '../contexts/StoreContext';
import { useAttendance } from '../hooks/useAttendance';
import { useShift } from '../hooks/useShift';
import { useLeave } from '../hooks/useLeave';
import { useAuth } from '../hooks/useAuth';
import { useTenantAdmin } from '../hooks/useTenantAdmin';
import { useTodaysActiveAttendances } from '../hooks/useTodaysActiveAttendances';
import { ClockButton } from '../components/Attendance/ClockButton';
import { BreakButton } from '../components/Attendance/BreakButton';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarDays, ChevronRight, FileClock } from 'lucide-react';
import { Card, StatCard, Badge, Button, DashboardSkeleton, ListRowSkeleton, Heading } from '../components/ui';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { useToast } from '../contexts/ToastContext';
import { formatSupabaseError } from '../lib/errors';
import { messages } from '../lib/messages';
import { deriveTodayStatusLabel, deriveTodayStatusTone } from '../lib/todayAttendanceStatus';
import { format, parseISO, differenceInMinutes, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addDays } from 'date-fns';
import { ja } from 'date-fns/locale';
import { formatTimeRange } from '../utils/formatTimeRange';
import type { AttendanceRecord } from '../types';

type AttendanceStatus = 'not_started' | 'working' | 'on_break';

// 当日レコードから労働時間合計（分）を算出。勤務中・休憩中レコードは
// 渡された基準時刻 `now` を使って経過分を加算する（live 表示用）。
function calcTotalWorkMinutes(records: AttendanceRecord[], now: Date): number {
  return records.reduce((sum, record) => {
    if (record.total_work_minutes != null) return sum + record.total_work_minutes;
    // 勤務中のレコード: clock_in はあるが clock_out がない
    if (record.clock_in && !record.clock_out) {
      const elapsed = differenceInMinutes(now, parseISO(record.clock_in));
      const breakMins = (record.breaks || []).reduce((bSum, b) => {
        if (b.start_time && b.end_time) {
          return bSum + differenceInMinutes(parseISO(b.end_time), parseISO(b.start_time));
        }
        if (b.start_time && !b.end_time) {
          return bSum + differenceInMinutes(now, parseISO(b.start_time));
        }
        return bSum;
      }, 0);
      return sum + Math.max(0, elapsed - breakMins);
    }
    return sum;
  }, 0);
}

function calcTotalBreakMinutes(records: AttendanceRecord[], now: Date): number {
  return records.reduce((sum, record) => {
    const breakMins = (record.breaks || []).reduce((bSum, b) => {
      if (b.start_time && b.end_time) {
        return bSum + differenceInMinutes(parseISO(b.end_time), parseISO(b.start_time));
      }
      if (b.start_time && !b.end_time) {
        return bSum + differenceInMinutes(now, parseISO(b.start_time));
      }
      return bSum;
    }, 0);
    return sum + breakMins;
  }, 0);
}

function formatDurationCompact(minutes: number | null | undefined): string {
  if (minutes == null) return '-';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function formatTime(time: string | null | undefined): string {
  if (!time) return '-';
  return format(parseISO(time), 'HH:mm');
}

/**
 * 「本日の記録」の数値グリッド。
 *
 * PERF (B6): 勤務時間・休憩合計の live 表示はここでのみ毎秒更新する。
 * useNow を内部購読し React.memo でラップすることで、親 DashboardPage は
 * 毎秒の再レンダを免れ、再レンダはこの子のみに局所化される。
 */
const TodayRecordStats = memo(function TodayRecordStats({
  todayOnlyRecords,
  status,
  firstClockIn,
  todayPlannedOut,
}: {
  todayOnlyRecords: AttendanceRecord[];
  status: AttendanceStatus;
  firstClockIn: string | null;
  todayPlannedOut: string;
}) {
  const now = useNow(1000);
  const totalWorkMinutes = calcTotalWorkMinutes(todayOnlyRecords, now);
  const totalBreakMinutes = calcTotalBreakMinutes(todayOnlyRecords, now);
  const cells = [
    { label: '出勤', value: formatTime(firstClockIn), sub: '実打刻' },
    { label: '退勤予定', value: todayPlannedOut, sub: 'シフト' },
    { label: '勤務時間', value: formatDurationCompact(totalWorkMinutes), sub: '休憩を除く', live: status === 'working' },
    { label: '休憩合計', value: formatDurationCompact(totalBreakMinutes), sub: '本日' },
  ];
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-stone-200 dark:border-stone-700 sm:grid-cols-4">
      {cells.map((cell, index) => (
        <div
          key={cell.label}
          className={`flex flex-col gap-1 p-3 ${index < 2 ? 'border-b border-stone-200 dark:border-stone-700 sm:border-b-0' : ''} ${index < 3 ? 'sm:border-r sm:border-stone-200 sm:dark:border-stone-700' : ''} ${cell.live ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-white dark:bg-stone-900'}`}
        >
          <div className="text-[11px] font-medium text-stone-500 dark:text-stone-400">{cell.label}</div>
          <span className="font-num text-2xl font-semibold tracking-tight tabular-nums text-stone-900 dark:text-stone-50">{cell.value}</span>
          <div className="text-[10px] text-stone-400 dark:text-stone-500">{cell.sub}</div>
        </div>
      ))}
    </div>
  );
});

export function DashboardPage() {
  const { currentTenant, myRole } = useTenant();
  // RequireTenant ガードにより currentTenant は必ず存在する
  const tenantId = currentTenant!.id;
  const { currentStore } = useStoreContext();
  const { user } = useAuth();
  const { showToast } = useToast();
  const can = useCan();
  // C7 viewOwnerDashboardOps（稼働中 N 名集計の表示。myRole はロールラベル等で据え置き）。挙動不変。
  const isOwnerView = can('viewOwnerDashboardOps');
  const { members: allMembers, fetchMembers } = useTenantAdmin(tenantId);

  const {
    todayRecords,
    activeRecord,
    status,
    clockIn,
    clockOut,
    breakStart,
    breakEnd,
    activeBreak,
    today: todayFromHook,
    loading,
    error: attendanceError,
    fetchRecords,
    monthlySummary,
  } = useAttendance(tenantId, currentStore?.id ?? null);

  const { myShifts, getMyShifts, loading: shiftLoading, error: shiftError } = useShift(tenantId, currentStore?.id ?? null);

  const { myLeaves, getMyLeaves, getRemainingPaidLeave, error: leaveError } = useLeave(tenantId);

  const dashboardError = (attendanceError ?? shiftError ?? leaveError)?.message ?? null;

  useEffect(() => {
    if (isOwnerView) {
      void fetchMembers(null);
    }
  }, [isOwnerView, fetchMembers]);

  const { byUserId: todaysActiveByUserId, workingCount: realWorkingCount } =
    useTodaysActiveAttendances({
      tenantId,
      members: allMembers,
      enabled: isOwnerView,
    });

  // Hooks 規則上 early return 前に評価必須 (Iter 5.1 hotfix)
  const teamMembers = useMemo(() => {
    const priority = (status: 'working' | 'break' | 'finished' | 'absent') =>
      status === 'working' ? 0 : status === 'break' ? 1 : status === 'finished' ? 2 : 3;
    const list = allMembers.map((member) => {
      const attendance = todaysActiveByUserId.get(member.user_id);
      return {
        memberId: member.id,
        userId: member.user_id,
        name: member.display_name,
        role: member.role,
        status: attendance?.status ?? ('absent' as const),
        since: attendance?.since ?? null,
      };
    });
    list.sort((a, b) => {
      const p = priority(a.status) - priority(b.status);
      if (p !== 0) return p;
      return a.name.localeCompare(b.name, 'ja');
    });
    return list;
  }, [allMembers, todaysActiveByUserId]);

  // 有給残日数
  const [remainingPaidLeave, setRemainingPaidLeave] = useState<number | null>(null);

  // 日付・月境界の基準軸は Asia/Tokyo 固定（todayFromHook と同一軸）。
  // todayFromHook は formatInTimeZone(now,'Asia/Tokyo','yyyy-MM-dd') 由来の JST 暦日。
  // これを parseISO でローカル0時の Date 化すると、Y/M/D フィールドが JST 暦日と一致し、
  // startOfMonth / startOfWeek / format / getDay が端末 TZ に依存しなくなる。
  // JST 端末では new Date() と同一挙動（不変）。
  const jstToday = useMemo(() => parseISO(todayFromHook), [todayFromHook]);

  // 当月の休暇取得
  useEffect(() => {
    const monthStart = format(startOfMonth(jstToday), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(jstToday), 'yyyy-MM-dd');
    getMyLeaves(monthStart, monthEnd);
  }, [getMyLeaves, jstToday]);

  // 有給残日数取得
  useEffect(() => {
    if (!user?.id) return;
    getRemainingPaidLeave(user.id).then(days => setRemainingPaidLeave(days));
  }, [user?.id, getRemainingPaidLeave]);

  // 週バーが月初をまたぐ場合に前月分の曜日も埋めるため、取得 range を
  // 「当月初を含む週の月曜」〜「当月末」に拡張（月間サマリは monthStartStr..monthEndStr で
  // filter 済のため集計値は非破壊）。
  const fetchMyShiftsForDashboard = useCallback(() => {
    const weekStart = format(startOfWeek(startOfMonth(jstToday), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(jstToday), 'yyyy-MM-dd');
    getMyShifts(weekStart, monthEnd);
  }, [getMyShifts, jstToday]);

  // 当月のシフトを取得（月間サマリの予定算出 + 週バー用にこの範囲から再 filter）
  useEffect(() => {
    fetchMyShiftsForDashboard();
  }, [fetchMyShiftsForDashboard]);

  // 当月の勤怠実績を取得（月間サマリの実績算出用、本人・当月スコープ）
  const fetchAttendanceForDashboard = useCallback(() => {
    // JST 暦日軸から年月を導出（月境界での端末 TZ ズレ防止）。
    fetchRecords(jstToday.getFullYear(), jstToday.getMonth() + 1);
  }, [fetchRecords, jstToday]);

  useEffect(() => {
    fetchAttendanceForDashboard();
  }, [fetchAttendanceForDashboard]);

  // dashboardError バナーの再試行: シフト + 勤怠を束ねて再取得（§3-2）。
  const handleDashboardRetry = useCallback(() => {
    fetchMyShiftsForDashboard();
    fetchAttendanceForDashboard();
  }, [fetchMyShiftsForDashboard, fetchAttendanceForDashboard]);

  // 日跨ぎ「今すぐ退勤打刻」: 二重送信ガード + 成功/失敗 Toast（clockOut の実処理は不変）
  const [carryOverProcessing, setCarryOverProcessing] = useState(false);
  const handleCarryOverClockOut = useCallback(async () => {
    if (carryOverProcessing) return;
    setCarryOverProcessing(true);
    try {
      await clockOut();
      showToast('退勤打刻を記録しました', 'success');
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setCarryOverProcessing(false);
    }
  }, [carryOverProcessing, clockOut, showToast]);

  if (loading && todayRecords.length === 0) {
    return (
      <div className="max-w-md mx-auto">
        <DashboardSkeleton />
      </div>
    );
  }

  const todayStr = todayFromHook;
  // 日付ラベル・週/月レンジ用の基準時刻。
  // P3-7: 基準軸を Asia/Tokyo 固定（todayFromHook と同一の jstToday）に統一。
  // これにより new Date()/startOfMonth(new Date()) の端末 TZ 依存を排除し、
  // 週/月境界・「今日」位置が JST 暦日に一致する（JST 端末では従来と同一＝不変）。
  // PERF (B6): 親では ticking clock を持たず日付軸は1回だけ確定（日跨ぎは todayFromHook
  // 更新→再 fetch / 再レンダで反映）。
  const today = jstToday;

  // 今日のレコードのみ（日跨ぎの未退勤レコードは除外して集計）
  const todayOnlyRecords = todayRecords.filter((r) => r.date === todayStr);

  const firstClockIn = todayOnlyRecords.length > 0
    ? todayOnlyRecords.reduce((earliest, record) => {
        if (!record.clock_in) return earliest;
        if (!earliest) return record.clock_in;
        return record.clock_in < earliest ? record.clock_in : earliest;
      }, null as string | null)
    : null;

  // 日跨ぎの未退勤レコード
  const carryOverRecord = activeRecord && activeRecord.date !== todayStr ? activeRecord : null;

  // 申請中の休暇件数
  const pendingLeaveCount = myLeaves.filter(l => l.status === 'pending').length;

  const weekStartDate = startOfWeek(today, { weekStartsOn: 1 });
  const weekEndDate = endOfWeek(today, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStartDate, index));
  const activeWeekShifts = myShifts.filter((s) => (
    s.date >= format(weekStartDate, 'yyyy-MM-dd') &&
    s.date <= format(weekEndDate, 'yyyy-MM-dd') &&
    s.status !== 'cancelled' &&
    s.status !== 'rejected'
  ));
  const todayShift = activeWeekShifts.find((s) => s.date === todayStr) ?? null;
  const getShiftMinutes = (shift: typeof activeWeekShifts[number]) => {
    const shiftDate = shift.date;
    const start = parseISO(`${shiftDate}T${shift.start_time}`);
    const rawEnd = parseISO(`${shiftDate}T${shift.end_time}`);
    const end = shift.end_time <= shift.start_time ? addDays(rawEnd, 1) : rawEnd;
    return Math.max(0, differenceInMinutes(end, start));
  };

  // 月間サマリ用の集計（当月 1日〜月末の本人有効シフト = 予定、当月確定実働 = 実績）。
  // 週バー（activeWeekShifts）とは独立に算出する。
  const monthStartStr = format(startOfMonth(today), 'yyyy-MM-dd');
  const monthEndStr = format(endOfMonth(today), 'yyyy-MM-dd');
  const activeMonthShifts = myShifts.filter((s) => (
    s.date >= monthStartStr &&
    s.date <= monthEndStr &&
    s.status !== 'cancelled' &&
    s.status !== 'rejected'
  ));
  const monthPlannedMinutes = activeMonthShifts.reduce((sum, shift) => {
    return sum + getShiftMinutes(shift);
  }, 0);
  // P3-6 仕様明文化（集計ロジックは不変）:
  // 月報の人件費はここでの勤怠実働を「JST 暦日（attendance_records.date / 00:00–24:00 JST）」で
  // 月集計する。一方 Square 売上ダッシュボードは「営業日区切り＝11時（business_day_start_hour）」を
  // 日境界としており、両者の日境界は一致しない（例: 深夜帯の打刻と売上は別暦日に振り分けられ得る）。
  // 月跨ぎ・日跨ぎ近辺では人件費と売上の対応日がズレる前提で照合すること。
  const monthActualMinutes = monthlySummary.totalWorkMinutes;
  const monthRate = monthPlannedMinutes > 0
    ? Math.min(100, Math.round((monthActualMinutes / monthPlannedMinutes) * 100))
    : 0;
  const monthHoursActual = (monthActualMinutes / 60).toFixed(1);
  const monthHoursPlanned = (monthPlannedMinutes / 60).toFixed(1);
  // 「本日の記録」カード専用のステータス導出（フックの status は退勤済みを返さないため、ここで4値化）。
  // 判定順（優先度）: 休憩中 → 勤務中 → 退勤済（当日 clock_in/clock_out あり）→ 未出勤。
  const todayStatusLabel = deriveTodayStatusLabel(status, todayOnlyRecords);
  const todayStatusTone = deriveTodayStatusTone(status);
  const roleLabel = myRole === 'owner' ? 'Owner' : myRole === 'manager' ? 'Manager' : 'Staff';
  const punchScopeLabel = currentStore ? `${currentStore.name} ${roleLabel}` : '全社管轄';
  const shortTodayLabel = format(today, 'M/d (E)', { locale: ja });
  const weekRangeLabel = `${format(weekStartDate, 'M/d')} – ${format(weekEndDate, 'M/d')}`;
  const monthLabel = format(today, 'yyyy / MM');
  const monthEndDay = format(endOfMonth(today), 'd');
  const todayPlannedOut = todayShift
    ? formatTimeRange(todayShift.start_time, todayShift.end_time, { separator: '〜' }).split('〜')[1] ?? '-'
    : '-';
  const weekItems = weekDays.map((day) => {
    const dateKey = format(day, 'yyyy-MM-dd');
    const shift = activeWeekShifts.find((s) => s.date === dateKey);
    const hours = shift ? getShiftMinutes(shift) / 60 : 0;
    return {
      dateKey,
      day,
      shift,
      hours,
      isToday: dateKey === todayStr,
      isOff: shift == null,
      isPlanned: day > today,
    };
  });
  const maxWeekHours = Math.max(...weekItems.map((item) => item.hours), 1);
  const visibleTeamMembers = teamMembers.slice(0, 8);
  const teamOverflow = teamMembers.length - visibleTeamMembers.length;
  const workingTeamCount = realWorkingCount;
  const monthStats = [
    { key: '今月予定', value: monthHoursPlanned, unit: 'h', sub: '/ 当月シフト合計' },
    { key: '実績', value: monthHoursActual, unit: 'h', sub: `今月予定の ${monthRate}%` },
    { key: '繰越有給', value: remainingPaidLeave !== null ? String(remainingPaidLeave) : '-', unit: '日', sub: `申請中 ${pendingLeaveCount} 件` },
  ];

  const statusDotColor = (s: 'working' | 'break' | 'finished' | 'absent') => {
    if (s === 'working') return 'bg-emerald-500';
    if (s === 'break') return 'bg-orange-500';
    if (s === 'finished') return 'bg-stone-400';
    return 'bg-stone-300';
  };
  const teamStatusLabel = (s: 'working' | 'break' | 'finished' | 'absent') => {
    if (s === 'working') return '勤務中';
    if (s === 'break') return '休憩中';
    if (s === 'finished') return '退勤済';
    return '未出勤';
  };

  return (
    <div className="min-h-full bg-stone-50 px-4 py-5 text-stone-900 dark:bg-stone-950 dark:text-stone-50 md:px-6 md:py-8">
      <div className="mx-auto max-w-[1280px] space-y-6">
        <header>
          <Heading level={1}>打刻 / ダッシュボード</Heading>
        </header>

        {dashboardError && (
          <ErrorBanner message={messages.error.withRetry(dashboardError)} onRetry={handleDashboardRetry} />
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_1.9fr]">
          <Card padding="md" className="flex flex-col gap-[18px]">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold tracking-tight">打刻</span>
              <div className="flex-1" />
              <span className="font-num text-xs text-stone-500 tabular-nums dark:text-stone-400">{punchScopeLabel}</span>
            </div>

            {currentStore == null ? (
              <Card padding="md" className="border-l-4 border-orange-400 bg-orange-50/70 text-center shadow-sm dark:border-orange-300 dark:bg-orange-900/20">
                <div className="flex flex-col items-center gap-2">
                  <Badge tone="warning" withDot>店舗未選択</Badge>
                  <p className="text-sm text-orange-700 dark:text-orange-200">打刻するには上部のセレクタから店舗を選択してください。</p>
                </div>
              </Card>
            ) : (
              <ClockButton
                status={status}
                clockIn={clockIn}
                clockOut={clockOut}
                todayRecords={todayRecords}
                activeRecord={activeRecord}
              >
                <BreakButton
                  status={status}
                  breakStart={breakStart}
                  breakEnd={breakEnd}
                  activeRecord={activeRecord}
                  activeBreak={activeBreak}
                />
              </ClockButton>
            )}

            {carryOverRecord && (
              <Card
                padding="md"
                className="border-l-[6px] border-red-500 bg-red-50/80 shadow-sm ring-1 ring-red-100/60 dark:border-red-400 dark:bg-red-900/20 dark:ring-red-700/40"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-6 w-6 flex-shrink-0 text-red-600 dark:text-red-400" />
                  <div className="flex-1">
                    <div className="mb-1.5 flex items-center gap-2">
                      <Badge tone="danger" withDot>未完了</Badge>
                      <span className="text-sm font-semibold text-red-700 dark:text-red-200">退勤打刻が未完了です</span>
                    </div>
                    <p className="text-sm text-stone-700 dark:text-stone-200">
                      <span className="font-num tabular-nums">{carryOverRecord.date}</span> に出勤(<span className="font-num tabular-nums">{formatTime(carryOverRecord.clock_in)}</span>) したまま退勤打刻がされていません
                    </p>
                    <div className="mt-3 max-w-sm">
                      <Button variant="danger" size="lg" onClick={handleCarryOverClockOut} loading={carryOverProcessing} disabled={carryOverProcessing} fullWidth>今すぐ退勤打刻</Button>
                    </div>
                  </div>
                </div>
              </Card>
            )}
          </Card>

          <div className="flex flex-col gap-4">
            <Card padding="md" className="flex flex-col gap-3.5">
              <header className="flex items-center gap-2">
                <span className="text-base font-semibold">本日の記録</span>
                <Badge tone={todayStatusTone}>{todayStatusLabel}</Badge>
                <div className="flex-1" />
                <span className="font-num text-xs text-stone-500 tabular-nums dark:text-stone-400">{shortTodayLabel}</span>
              </header>
              <TodayRecordStats
                todayOnlyRecords={todayOnlyRecords}
                status={status}
                firstClockIn={firstClockIn}
                todayPlannedOut={todayPlannedOut}
              />
            </Card>

            <Card padding="md" className="flex flex-col gap-3.5">
              <header className="flex items-center gap-2">
                <span className="text-base font-semibold">今週のシフト</span>
                <div className="flex-1" />
                <span className="font-num text-xs text-stone-500 tabular-nums dark:text-stone-400">{weekRangeLabel}</span>
                <Link
                  to="/shift"
                  aria-label="シフト管理を開く"
                  className="rounded-md p-0.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </header>
              {shiftLoading ? (
                <div className="grid grid-cols-7 gap-1.5">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <ListRowSkeleton key={i} />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-7 gap-1.5">
                  {weekItems.map((item) => (
                    <div
                      key={item.dateKey}
                      className={`flex flex-col items-center gap-1.5 rounded-lg border p-[10px_8px] ${item.isToday ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20' : 'border-stone-200 dark:border-stone-700'}`}
                      title={item.shift ? formatTimeRange(item.shift.start_time, item.shift.end_time, { separator: '〜' }) : 'シフトなし'}
                    >
                      <div className={`text-[10px] font-semibold ${item.isToday ? 'text-blue-600 dark:text-blue-300' : 'text-stone-500 dark:text-stone-400'}`}>
                        {format(item.day, 'E', { locale: ja })}
                      </div>
                      <div className={`font-num text-[15px] font-semibold tabular-nums ${item.isToday ? 'text-blue-600 dark:text-blue-300' : 'text-stone-900 dark:text-stone-50'}`}>
                        {format(item.day, 'd')}
                      </div>
                      <div className="relative flex h-8 w-full items-end justify-center">
                        {item.isOff ? (
                          <span className="text-[10px] text-stone-400 dark:text-stone-500">休</span>
                        ) : (
                          <div
                            className={`w-[18px] rounded-sm ${item.isToday ? 'bg-blue-600' : item.isPlanned ? 'bg-stone-300 opacity-50 dark:bg-stone-500' : 'bg-stone-900 dark:bg-stone-400'}`}
                            style={{ height: `${Math.max(8, (item.hours / maxWeekHours) * 100)}%` }}
                            aria-hidden="true"
                          />
                        )}
                      </div>
                      <div className="font-num text-[10px] text-stone-500 tabular-nums dark:text-stone-400">
                        {item.isOff ? '—' : `${item.hours.toFixed(1)}h`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card padding="md" className="flex flex-col gap-3.5">
              <header className="flex items-center gap-2">
                <span className="text-base font-semibold">月間サマリ</span>
                <div className="flex-1" />
                <span className="font-num text-xs text-stone-500 tabular-nums dark:text-stone-400">{monthLabel}</span>
              </header>
              <div className="flex gap-3">
                {monthStats.map((stat) => (
                  <div key={stat.key} className="flex flex-1 flex-col gap-1">
                    <div className="text-[11px] text-stone-500 dark:text-stone-400">{stat.key}</div>
                    <div className="flex items-baseline gap-1">
                      <span className="font-num text-2xl font-semibold tracking-tight tabular-nums text-stone-900 dark:text-stone-50">{stat.value}</span>
                      <span className="text-[11px] text-stone-500 dark:text-stone-400">{stat.unit}</span>
                    </div>
                    <div className="font-num text-[10px] text-stone-400 tabular-nums dark:text-stone-500">{stat.sub}</div>
                  </div>
                ))}
              </div>
              <div>
                <div className="h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                  <div className="h-full bg-blue-600" style={{ width: `${monthRate}%` }} />
                </div>
                <div className="mt-1.5 flex justify-between">
                  <span className="font-num text-[10px] text-stone-500 tabular-nums dark:text-stone-400">1日</span>
                  <span className="font-num text-[10px] text-stone-500 tabular-nums dark:text-stone-400">
                    {format(today, 'd')}日 <span className="font-semibold text-stone-900 dark:text-stone-50">← 今日</span>
                  </span>
                  <span className="font-num text-[10px] text-stone-500 tabular-nums dark:text-stone-400">{monthEndDay}日</span>
                </div>
              </div>
            </Card>

            {myRole === 'owner' && (
              <Card padding="md" className="flex flex-col gap-3">
                <header className="flex items-center gap-2">
                  <span className="text-base font-semibold">全社員 打刻状況</span>
                  <Badge tone="success" withDot>稼働中 {workingTeamCount} 名</Badge>
                  <div className="flex-1" />
                </header>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {visibleTeamMembers.map((member) => (
                    <div key={member.memberId} className="flex items-center gap-2.5 rounded-lg border border-stone-200 bg-white p-[8px_10px] dark:border-stone-700 dark:bg-stone-900">
                      <div className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full bg-stone-100 text-xs font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                        {member.name.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-stone-900 dark:text-stone-50">{member.name}</div>
                        <div className="truncate text-[10px] text-stone-500 dark:text-stone-400">{member.role}</div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${statusDotColor(member.status)}`} aria-hidden="true" />
                          <span className="text-[10px] font-semibold text-stone-700 dark:text-stone-300">{teamStatusLabel(member.status)}</span>
                        </div>
                        <div className="font-num text-[11px] text-stone-500 tabular-nums dark:text-stone-400">{member.since ?? '—'}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {teamOverflow > 0 && (
                  <div className="text-center text-[11px] text-stone-500 dark:text-stone-400">
                    他 {teamOverflow} 名
                  </div>
                )}
              </Card>
            )}

            {myRole === 'staff' && (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-stone-500 dark:text-stone-400">休暇情報</h3>
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="有給残" value={remainingPaidLeave !== null ? remainingPaidLeave : '-'} unit="日" icon={<CalendarDays size={16} />} />
                  <StatCard label="申請中の休暇" value={pendingLeaveCount} unit="件" icon={<FileClock size={16} />} />
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
