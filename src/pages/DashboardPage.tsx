import { useState, useEffect } from 'react';
import { useTenant } from '../hooks/useTenant';
import { useStoreContext } from '../contexts/StoreContext';
import { useAttendance } from '../hooks/useAttendance';
import { useShift } from '../hooks/useShift';
import { useLeave } from '../hooks/useLeave';
import { useAuth } from '../hooks/useAuth';
import { ClockButton } from '../components/Attendance/ClockButton';
import { BreakButton } from '../components/Attendance/BreakButton';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, FileClock } from 'lucide-react';
import { Card, StatCard, Badge, Button, DashboardSkeleton, ListRowSkeleton, Heading } from '../components/ui';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { messages } from '../lib/messages';
import { format, parseISO, differenceInMinutes, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addDays } from 'date-fns';
import { ja } from 'date-fns/locale';
import { formatTimeRange } from '../utils/formatTimeRange';

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
  const monthRate = monthlyProgress;
  const monthHoursActual = (totalWorkMinutes / 60).toFixed(1);
  const monthHoursPlanned = (plannedMinutes / 60).toFixed(1);
  // TODO(loop-next): 未提出判定接続 (現状はダミー display)
  const showShiftUnsubmittedBanner = true;
  const dummyTeamMembers = [
    { name: '中村 隆志', store: '吸暮', status: 'working' as const, time: '09:02' },
    { name: '田中 由紀', store: 'KITUNE', status: 'break' as const, time: '13:15' },
    { name: '佐藤 涼介', store: 'Goodbye', status: 'off' as const, time: '退勤' },
    { name: '高橋 美咲', store: '金魚', status: 'working' as const, time: '11:30' },
    { name: '伊藤 圭一', store: '吸暮', status: 'working' as const, time: '10:45' },
  ];

  const statusDotColor = (s: 'working' | 'break' | 'off') => {
    if (s === 'working') return 'bg-emerald-500';
    if (s === 'break') return 'bg-orange-500';
    return 'bg-stone-300';
  };

  return (
    <div className="min-h-full bg-stone-50 px-4 py-5 text-stone-900 dark:bg-stone-950 dark:text-stone-50 md:px-6 md:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <Heading level={1}>打刻 / ダッシュボード</Heading>
        </header>

        {dashboardError && <ErrorBanner message={messages.error.withRetry(dashboardError)} />}

        <div className="grid gap-4 md:grid-cols-[minmax(0,420px)_1fr] md:gap-6">
          <div className="space-y-4">
            {currentStore == null ? (
              <Card padding="md" className="rounded-2xl border-l-4 border-orange-400 bg-orange-50/70 text-center shadow-sm dark:border-orange-300 dark:bg-orange-900/20">
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
                className="rounded-xl border-l-[6px] border-red-500 bg-red-50/80 shadow-sm ring-1 ring-red-100/60 dark:border-red-400 dark:bg-red-900/20 dark:ring-red-700/40"
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
            )}
          </div>

          <div className="space-y-4">
            {showShiftUnsubmittedBanner && (
              <div className="flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 dark:border-orange-700/40 dark:bg-orange-900/20">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-600 dark:text-orange-400" />
                <p className="flex-1 text-sm text-stone-700 dark:text-stone-200">
                  6月のシフトを未提出です。締切 5/28 23:59
                </p>
                <a href="/shift" className="text-sm font-medium text-orange-700 hover:text-orange-800 dark:text-orange-200 dark:hover:text-orange-100">
                  確認 →
                </a>
              </div>
            )}

            <Card padding="md" className="rounded-xl shadow-sm">
              <h3 className="mb-4 text-label text-stone-500 dark:text-stone-400">本日の記録</h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="mb-1.5 text-label text-stone-500 dark:text-stone-400">出勤時刻</p>
                  <p className="font-num text-2xl font-semibold tabular-nums text-stone-900 dark:text-stone-50 md:text-3xl">{formatTime(firstClockIn)}</p>
                </div>
                <div>
                  <p className="mb-1.5 text-label text-stone-500 dark:text-stone-400">退勤予定</p>
                  <p className="font-num text-2xl font-semibold tabular-nums text-stone-900 dark:text-stone-50 md:text-3xl">
                    {todayShift ? formatTimeRange(todayShift.start_time, todayShift.end_time, { separator: '〜' }).split('〜')[1] : '-'}
                  </p>
                </div>
                <div>
                  <p className="mb-1.5 text-label text-stone-500 dark:text-stone-400">経過時間</p>
                  <p className="font-num text-2xl font-semibold tabular-nums text-stone-900 dark:text-stone-50 md:text-3xl">{formatDuration(totalWorkMinutes)}</p>
                </div>
                <div>
                  <p className="mb-1.5 text-label text-stone-500 dark:text-stone-400">休憩</p>
                  <p className="font-num text-2xl font-semibold tabular-nums text-stone-900 dark:text-stone-50 md:text-3xl">{formatDuration(totalBreakMinutes)}</p>
                </div>
              </div>
            </Card>

            <Card padding="md" className="rounded-xl shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-label text-stone-500 dark:text-stone-400">今週のシフト</h3>
                <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                  <button type="button" aria-label="前の月" className="rounded p-1 hover:bg-stone-100 dark:hover:bg-stone-700">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="font-num tabular-nums">{format(today, 'M月')}</span>
                  <button type="button" aria-label="次の月" className="rounded p-1 hover:bg-stone-100 dark:hover:bg-stone-700">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {shiftLoading ? (
                <div className="grid grid-cols-7 gap-2">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <ListRowSkeleton key={i} />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-7 gap-2">
                  {weekDays.map((day) => {
                    const dateKey = format(day, 'yyyy-MM-dd');
                    const shift = activeWeekShifts.find((s) => s.date === dateKey);
                    const isToday = dateKey === todayStr;
                    const hasShift = shift != null;
                    return (
                      <div
                        key={dateKey}
                        className={`flex flex-col items-center rounded-lg px-2 py-3 ${isToday ? 'bg-blue-50 ring-2 ring-blue-600 dark:bg-blue-900/30' : 'bg-stone-50/60 dark:bg-stone-800/40'}`}
                        title={hasShift ? formatTimeRange(shift.start_time, shift.end_time, { separator: '〜' }) : 'シフトなし'}
                      >
                        <p className="text-xs text-stone-500 dark:text-stone-400">{format(day, 'E', { locale: ja })}</p>
                        <p className="font-num text-base font-semibold tabular-nums text-stone-900 dark:text-stone-50">{format(day, 'd')}</p>
                        <div
                          className={`mt-3 h-3.5 w-4/5 rounded-sm ${hasShift ? 'bg-stone-900 dark:bg-stone-200' : 'bg-stone-200 dark:bg-stone-700'}`}
                          style={{ opacity: hasShift ? 1 : 0.4 }}
                          aria-hidden="true"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card padding="md" className="rounded-xl shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-label text-stone-500 dark:text-stone-400">月間サマリ</h3>
                <span className="text-xs text-stone-400 dark:text-stone-500">今月</span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-stone-500 dark:text-stone-400">実績</p>
                  <p className="mt-1 font-num text-2xl font-semibold tabular-nums text-stone-900 dark:text-stone-50 md:text-3xl">
                    {monthHoursActual}<span className="ml-1 text-sm font-normal text-stone-500 dark:text-stone-400">h</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500 dark:text-stone-400">予定</p>
                  <p className="mt-1 font-num text-2xl font-semibold tabular-nums text-stone-900 dark:text-stone-50 md:text-3xl">
                    {monthHoursPlanned}<span className="ml-1 text-sm font-normal text-stone-500 dark:text-stone-400">h</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500 dark:text-stone-400">達成率</p>
                  <p className="mt-1 font-num text-2xl font-semibold tabular-nums text-stone-900 dark:text-stone-50 md:text-3xl">
                    {monthRate}<span className="ml-1 text-sm font-normal text-stone-500 dark:text-stone-400">%</span>
                  </p>
                </div>
              </div>
              <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-700">
                <div className="h-full rounded-full bg-blue-600" style={{ width: `${monthRate}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-xs tabular-nums text-stone-400 dark:text-stone-500">
                <span>1</span><span>8</span><span>15</span><span>22</span><span>29</span>
              </div>
            </Card>

            {myRole === 'owner' && (
              <Card padding="md" className="rounded-xl shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-label text-stone-500 dark:text-stone-400">全社員打刻状況</h3>
                  <span className="text-xs text-stone-400 dark:text-stone-500">全店舗 ▾</span>
                </div>
                <ul className="divide-y divide-stone-100 dark:divide-stone-700">
                  {dummyTeamMembers.map((m) => (
                    <li key={m.name} className="flex items-center gap-3 py-2.5">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-stone-100 text-sm font-semibold text-stone-600 dark:bg-stone-700 dark:text-stone-200">
                        {m.name.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-stone-900 dark:text-stone-50">{m.name}</p>
                        <p className="truncate text-xs text-stone-500 dark:text-stone-400">{m.store}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusDotColor(m.status)}`} aria-hidden="true" />
                        <span className="font-num text-sm tabular-nums text-stone-700 dark:text-stone-300">{m.time}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">※ 表示はダミーデータ（次 Loop で実データ接続）</p>
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
      </div>
    </div>
  );
}
