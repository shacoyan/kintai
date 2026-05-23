import { useState, useEffect } from 'react';
import { useTenant } from '../hooks/useTenant';
import { useStoreContext } from '../contexts/StoreContext';
import { useAttendance } from '../hooks/useAttendance';
import { useShift } from '../hooks/useShift';
import { useLeave } from '../hooks/useLeave';
import { useAuth } from '../hooks/useAuth';
import { ClockButton } from '../components/Attendance/ClockButton';
import { BreakButton } from '../components/Attendance/BreakButton';
import { AlertTriangle, CheckCircle2, CalendarDays, FileClock } from 'lucide-react';
import { Card, StatCard, Badge, Button, DashboardSkeleton, ListRowSkeleton, Heading } from '../components/ui';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { messages } from '../lib/messages';
import { format, parseISO, differenceInMinutes, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addDays } from 'date-fns';
import { ja } from 'date-fns/locale';
import { formatTimeRange } from '../utils/formatTimeRange';

function getGreeting(hour: number): string {
  if (hour >= 4 && hour < 11) return 'おはようございます';
  if (hour >= 11 && hour < 17) return 'こんにちは';
  if (hour >= 17 && hour < 23) return 'こんばんは';
  return 'お疲れさまです';
}

export function DashboardPage() {
  const { tenants, currentTenant, myRole } = useTenant();
  // RequireTenant ガードにより currentTenant は必ず存在する
  const tenantId = currentTenant!.id;
  const { currentStore } = useStoreContext();
  const { user } = useAuth();

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
  } = useAttendance(tenantId, currentStore?.id ?? null);

  const { myShifts, getMyShifts, loading: shiftLoading, error: shiftError } = useShift(tenantId, currentStore?.id ?? null);

  const { myLeaves, getMyLeaves, getRemainingPaidLeave, error: leaveError } = useLeave(tenantId);

  const dashboardError = (attendanceError ?? shiftError ?? leaveError)?.message ?? null;

  // ヒーロー時計と勤務中の労働時間をリアルタイム更新するためのタイマー
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, []);

  // 有給残日数
  const [remainingPaidLeave, setRemainingPaidLeave] = useState<number | null>(null);

  // 当月の休暇取得
  useEffect(() => {
    const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd');
    getMyLeaves(monthStart, monthEnd);
  }, [getMyLeaves]);

  // 有給残日数取得
  useEffect(() => {
    if (!user?.id) return;
    getRemainingPaidLeave(user.id).then(days => setRemainingPaidLeave(days));
  }, [user?.id, getRemainingPaidLeave]);

  // 今週のシフトを取得
  useEffect(() => {
    const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    getMyShifts(weekStart, weekEnd);
  }, [getMyShifts]);

  if (loading && todayRecords.length === 0) {
    return (
      <div className="max-w-md mx-auto">
        <DashboardSkeleton />
      </div>
    );
  }

  const todayStr = todayFromHook;
  const today = now;

  // 今日のレコードのみ（日跨ぎの未退勤レコードは除外して集計）
  const todayOnlyRecords = todayRecords.filter((r) => r.date === todayStr);

  const formatTime = (time: string | null | undefined) => {
    if (!time) return '-';
    return format(parseISO(time), 'HH:mm');
  };

  const formatDuration = (minutes: number | null | undefined) => {
    if (minutes == null) return '-';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}時間${m}分`;
  };

  const totalWorkMinutes = todayOnlyRecords.reduce((sum, record) => {
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

  const totalBreakMinutes = todayOnlyRecords.reduce((sum, record) => {
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

  const firstClockIn = todayOnlyRecords.length > 0
    ? todayOnlyRecords.reduce((earliest, record) => {
        if (!record.clock_in) return earliest;
        if (!earliest) return record.clock_in;
        return record.clock_in < earliest ? record.clock_in : earliest;
      }, null as string | null)
    : null;

  // 日跨ぎの未退勤レコード
  const carryOverRecord = activeRecord && activeRecord.date !== todayStr ? activeRecord : null;

  // 今週の残りシフト（今日以降）
  const upcomingShifts = myShifts
    .filter((s) => s.date >= todayStr && s.status !== 'cancelled' && s.status !== 'rejected')
    .slice(0, 3);

  // 申請中の休暇件数
  const pendingLeaveCount = myLeaves.filter(l => l.status === 'pending').length;
  const displayName = tenants.find(t => t.id === tenantId)?.display_name;
  const greeting = getGreeting(today.getHours());
  const greetingLine = displayName ? `${greeting}、${displayName} さん。` : `${greeting}。`;
  const nextShiftLine = upcomingShifts[0]
    ? `次の予定は ${format(parseISO(upcomingShifts[0].date), 'M月d日（E）', { locale: ja })} ${formatTimeRange(upcomingShifts[0].start_time, upcomingShifts[0].end_time, { separator: '〜' })}。`
    : '現在予定されている次のシフトはありません。';

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

  const plannedMinutes = activeWeekShifts.reduce((sum, shift) => {
    const shiftDate = shift.date;
    const start = parseISO(`${shiftDate}T${shift.start_time}`);
    const rawEnd = parseISO(`${shiftDate}T${shift.end_time}`);
    const end = shift.end_time <= shift.start_time ? addDays(rawEnd, 1) : rawEnd;
    return sum + Math.max(0, differenceInMinutes(end, start));
  }, 0);
  const monthlyProgress = plannedMinutes > 0
    ? Math.min(100, Math.round((totalWorkMinutes / plannedMinutes) * 100))
    : 0;
  const remainingPlannedMinutes = plannedMinutes > 0
    ? Math.max(0, plannedMinutes - totalWorkMinutes)
    : null;

  return (
    <div className="min-h-full bg-stone-50 px-4 py-5 text-stone-900 dark:bg-stone-950 dark:text-stone-50 md:px-6 md:py-8">
      <div className="mx-auto max-w-6xl space-y-5 md:space-y-6">
        <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <Heading level={1}>打刻 / ダッシュボード</Heading>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{greetingLine}</p>
          </div>
          <p className="font-num text-sm tabular-nums text-stone-500 dark:text-stone-400">
            {format(today, 'yyyy年M月d日 (E)', { locale: ja })}
          </p>
        </header>

        {dashboardError && <ErrorBanner message={messages.error.withRetry(dashboardError)} />}

        <Card padding="lg" className="rounded-2xl border-stone-200 py-10 text-center shadow-sm dark:border-stone-700 md:py-14">
          <div className="font-num text-6xl font-semibold leading-none tabular-nums text-stone-900 dark:text-stone-50 md:text-7xl">
            {format(now, 'HH:mm:ss')}
          </div>
          <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">
            {format(today, 'yyyy年M月d日 (E)', { locale: ja })}
          </p>
        </Card>

        <section className="mx-auto max-w-md">
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
        </section>

        <Card padding="md" className="rounded-2xl shadow-sm">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="mb-1.5 text-label text-stone-500 dark:text-stone-400">出勤時刻</p>
              <p className="font-num text-kpi-md tabular-nums text-stone-900 dark:text-stone-50">{formatTime(firstClockIn)}</p>
            </div>
            <div>
              <p className="mb-1.5 text-label text-stone-500 dark:text-stone-400">退勤予定</p>
              <p className="font-num text-kpi-md tabular-nums text-stone-900 dark:text-stone-50">
                {todayShift ? formatTimeRange(todayShift.start_time, todayShift.end_time, { separator: '〜' }).split('〜')[1] : '-'}
              </p>
            </div>
            <div>
              <p className="mb-1.5 text-label text-stone-500 dark:text-stone-400">経過時間</p>
              <p className="font-num text-kpi-md tabular-nums text-stone-900 dark:text-stone-50">{formatDuration(totalWorkMinutes)}</p>
            </div>
            <div>
              <p className="mb-1.5 text-label text-stone-500 dark:text-stone-400">休憩</p>
              <p className="font-num text-kpi-md tabular-nums text-stone-900 dark:text-stone-50">{formatDuration(totalBreakMinutes)}</p>
            </div>
          </div>
        </Card>

        {carryOverRecord ? (
          <Card
            padding="md"
            className="rounded-2xl border-l-[6px] border-red-500 bg-red-50/80 shadow-sm ring-1 ring-red-100/60 dark:border-red-400 dark:bg-red-900/20 dark:ring-red-700/40"
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
                  <Button variant="danger" size="lg" onClick={clockOut} fullWidth>今すぐ退勤打刻</Button>
                </div>
              </div>
            </div>
          </Card>
        ) : (
          <Card padding="md" className="rounded-2xl border-l-4 border-emerald-500 bg-emerald-50/50 shadow-sm dark:border-emerald-400 dark:bg-emerald-900/20">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
              <p className="text-sm text-stone-700 dark:text-stone-200">
                今日は整っています。{nextShiftLine}
              </p>
            </div>
          </Card>
        )}

        <Card padding="md" className="rounded-2xl shadow-sm">
          <Card.Header className="mb-4 border-b-0 pb-0">今週のシフト</Card.Header>
          <Card.Body>
            {shiftLoading ? (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
                {Array.from({ length: 7 }).map((_, i) => (
                  <ListRowSkeleton key={i} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
                {weekDays.map((day) => {
                  const dateKey = format(day, 'yyyy-MM-dd');
                  const shift = activeWeekShifts.find((s) => s.date === dateKey);
                  const isToday = dateKey === todayStr;
                  return (
                    <div
                      key={dateKey}
                      className={`flex flex-row items-center justify-between rounded-xl border border-stone-200 px-3 py-3 dark:border-stone-700 md:flex-col md:justify-start md:px-2 ${isToday ? 'ring-2 ring-blue-500' : ''}`}
                    >
                      <div className="text-left md:text-center">
                        <p className="text-xs text-stone-500 dark:text-stone-400">{format(day, 'E', { locale: ja })}</p>
                        <p className="font-num text-base font-semibold tabular-nums text-stone-900 dark:text-stone-50">{format(day, 'd')}</p>
                      </div>
                      <p className="font-num text-sm tabular-nums text-stone-700 dark:text-stone-300 md:mt-2">
                        {shift ? formatTimeRange(shift.start_time, shift.end_time, { separator: '〜' }) : '-'}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </Card.Body>
        </Card>

        <Card padding="md" className="rounded-2xl shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-label text-stone-500 dark:text-stone-400">今月実績</p>
              <p className="mt-1 font-num text-kpi-lg tabular-nums text-stone-900 dark:text-stone-50">{formatDuration(totalWorkMinutes)}</p>
            </div>
            <p className="text-sm text-stone-500 dark:text-stone-400">取得済みデータで表示</p>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
            <div className="h-full rounded-full bg-blue-600" style={{ width: `${monthlyProgress}%` }} />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <p className="text-label text-stone-500 dark:text-stone-400">予定</p>
              <p className="mt-1 font-num text-kpi-md tabular-nums text-stone-900 dark:text-stone-50">
                {plannedMinutes > 0 ? formatDuration(plannedMinutes) : '-'}
              </p>
            </div>
            <div>
              <p className="text-label text-stone-500 dark:text-stone-400">残り</p>
              <p className="mt-1 font-num text-kpi-md tabular-nums text-stone-900 dark:text-stone-50">
                {remainingPlannedMinutes != null ? formatDuration(remainingPlannedMinutes) : '-'}
              </p>
            </div>
          </div>
        </Card>

        {/* 全社員打刻状況は別 Loop で実データソース接続予定。 */}
        {myRole === 'owner' && (
          <Card padding="md" className="rounded-2xl shadow-sm">
            <Card.Header className="mb-0 border-b-0 pb-0">全社員打刻状況</Card.Header>
            <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">会長専用（準備中）</p>
          </Card>
        )}

        {myRole === 'staff' && (
          <section>
            <h3 className="mb-2 text-label text-stone-500 dark:text-stone-400">休暇情報</h3>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="有給残" value={remainingPaidLeave !== null ? remainingPaidLeave : '-'} unit="日" icon={<CalendarDays size={16} />} />
              <StatCard label="申請中の休暇" value={pendingLeaveCount} unit="件" icon={<FileClock size={16} />} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
