import { useState, useEffect } from 'react';
import { useTenant } from '../hooks/useTenant';
import { useStoreContext } from '../contexts/StoreContext';
import { useAttendance } from '../hooks/useAttendance';
import { useShift } from '../hooks/useShift';
import { useLeave } from '../hooks/useLeave';
import { useAuth } from '../hooks/useAuth';
import { ClockButton } from '../components/Attendance/ClockButton';
import { BreakButton } from '../components/Attendance/BreakButton';
import { AlertTriangle, Clock, Activity, CalendarDays, FileClock } from 'lucide-react';
import { Card, StatCard, Badge, Button, DashboardSkeleton, ListRowSkeleton, EmptyState, Heading } from '../components/ui';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { messages } from '../lib/messages';
import { format, parseISO, differenceInMinutes, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { ja } from 'date-fns/locale';

export function DashboardPage() {
  const { currentTenant, myRole } = useTenant();
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

  // 勤務中の労働時間をリアルタイム更新するためのタイマー
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (status !== 'working' && status !== 'on_break') return;
    setNow(new Date()); // ステータス変更時に即座に更新
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [status]);

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
  const today = new Date();

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

  const firstClockIn = todayOnlyRecords.length > 0
    ? todayOnlyRecords.reduce((earliest, record) => {
        if (!record.clock_in) return earliest;
        if (!earliest) return record.clock_in;
        return record.clock_in < earliest ? record.clock_in : earliest;
      }, null as string | null)
    : null;

  const lastClockOut = todayOnlyRecords.reduce((latest, record) => {
    if (!record.clock_out) return latest;
    if (!latest) return record.clock_out;
    return record.clock_out > latest ? record.clock_out : latest;
  }, null as string | null);

  // 日跨ぎの未退勤レコード
  const carryOverRecord = activeRecord && activeRecord.date !== todayStr ? activeRecord : null;

  // 今日の労働時間を "Xh Ym" 形式に変換
  const todayTotalHours = (() => {
    const h = Math.floor(totalWorkMinutes / 60);
    const m = totalWorkMinutes % 60;
    if (h === 0 && m === 0) return '0分';
    if (h === 0) return `${m}分`;
    if (m === 0) return `${h}時間`;
    return `${h}時間${m}分`;
  })();

  // 今週の残りシフト（今日以降）
  const upcomingShifts = myShifts
    .filter((s) => s.date >= todayStr && s.status !== 'cancelled' && s.status !== 'rejected')
    .slice(0, 3);

  // 申請中の休暇件数
  const pendingLeaveCount = myLeaves.filter(l => l.status === 'pending').length;

  return (
    <div className="max-w-md mx-auto space-y-6">
      <header className="flex items-end justify-between gap-3">
        <Heading level={1}>{format(today, 'M月d日')}</Heading>
        <p className="text-sm text-neutral-500 dark:text-neutral-300">{format(today, 'EEEE', { locale: ja })}</p>
      </header>

      {dashboardError && <ErrorBanner message={messages.error.withRetry(dashboardError)} />}

      {carryOverRecord && (
        <Card padding="md" className="border-l-4 border-danger-500 dark:border-danger-400">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-danger-600 dark:text-danger-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Badge tone="danger" withDot>未完了</Badge>
              </div>
              <p className="text-sm text-neutral-600 dark:text-neutral-300">
                {carryOverRecord.date} に出勤({formatTime(carryOverRecord.clock_in)}) したまま退勤打刻がされていません
              </p>
              <div className="mt-3">
                <Button variant="danger" size="md" onClick={clockOut} fullWidth>今すぐ退勤打刻</Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="flex flex-col items-center gap-6 py-8">
        {currentStore == null ? (
          <Card padding="md">
            <div className="flex flex-col items-center gap-2 text-center">
              <Badge tone="warning" withDot>店舗未選択</Badge>
              <p className="text-sm text-warning-800 dark:text-warning-300">打刻するには上部のセレクタから店舗を選択してください。</p>
            </div>
          </Card>
        ) : (
          <>
            <ClockButton
              status={status}
              clockIn={clockIn}
              clockOut={clockOut}
              todayRecords={todayRecords}
              activeRecord={activeRecord}
            />
            <BreakButton
              status={status}
              breakStart={breakStart}
              breakEnd={breakEnd}
              activeRecord={activeRecord}
              activeBreak={activeBreak}
            />
          </>
        )}
      </div>

      {todayRecords.length === 0 ? (
        <EmptyState
          icon={<Clock className="w-12 h-12 text-neutral-400 dark:text-neutral-500" />}
          title={messages.empty.attendanceDay.title}
          description="出勤ボタンを押して、今日の最初の打刻を始めましょう。"
        />
      ) : (
        <>
          <Card padding="md">
            <Card.Header>本日の記録</Card.Header>
            <Card.Body>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="text-center">
                  <p className="text-xs text-neutral-500 dark:text-neutral-300 mb-1">最初の出勤</p>
                  <p className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">{formatTime(firstClockIn)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-neutral-500 dark:text-neutral-300 mb-1">最後の退勤</p>
                  <p className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">{lastClockOut ? formatTime(lastClockOut) : (activeRecord ? '勤務中' : '-')}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-neutral-500 dark:text-neutral-300 mb-1">労働時間</p>
                  <p className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">{formatDuration(totalWorkMinutes)}</p>
                </div>
              </div>
            </Card.Body>
          </Card>

          {/* Today's summary cards */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="本日の労働時間" value={todayTotalHours} icon={<Clock size={16} />} />
            <StatCard label="セッション数" value={todayRecords.filter(r => r.clock_in).length} unit="回" icon={<Activity size={16} />} />
          </div>

          {/* Staff leave summary cards */}
          {myRole === 'staff' && (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="有給残" value={remainingPaidLeave !== null ? remainingPaidLeave : '-'} unit="日" icon={<CalendarDays size={16} />} />
              <StatCard label="申請中の休暇" value={pendingLeaveCount} unit="件" icon={<FileClock size={16} />} />
            </div>
          )}
        </>
      )}

      {/* 今週のシフト */}
      <Card padding="md">
        <Card.Header>今週のシフト</Card.Header>
        <Card.Body>
          {shiftLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <ListRowSkeleton key={i} />
              ))}
            </div>
          ) : (
            upcomingShifts.length > 0 && (
              <div className="space-y-2">
                {upcomingShifts.map((shift) => (
                  <div key={shift.id} className="flex items-center justify-between text-sm">
                    <span className="text-neutral-600 dark:text-neutral-300 font-medium">
                      {format(new Date(shift.date), 'M/d(E)', { locale: ja })}
                    </span>
                    <span className="text-neutral-800 dark:text-neutral-200">
                      {shift.start_time.slice(0, 5)} 〜 {shift.end_time.slice(0, 5)}
                    </span>
                    {shift.status === 'approved' ? (
                      <Badge tone="success" withDot>承認済</Badge>
                    ) : shift.status === 'pending' ? (
                      <Badge tone="warning" withDot>申請中</Badge>
                    ) : (
                      <Badge tone="neutral">{shift.status}</Badge>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </Card.Body>
      </Card>
    </div>
  );
}
