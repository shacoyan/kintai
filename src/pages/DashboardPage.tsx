import { useState, useEffect } from 'react';
import { useTenant } from '../hooks/useTenant';
import { useStoreContext } from '../contexts/StoreContext';
import { useAttendance } from '../hooks/useAttendance';
import { useShift } from '../hooks/useShift';
import { ClockButton } from '../components/Attendance/ClockButton';
import { BreakButton } from '../components/Attendance/BreakButton';
import { AlertTriangle, Clock } from 'lucide-react';
import { PageSkeleton, ListRowSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { format, parseISO, differenceInMinutes, startOfWeek, endOfWeek } from 'date-fns';
import { ja } from 'date-fns/locale';

export function DashboardPage() {
  const { currentTenant } = useTenant();
  // RequireTenant ガードにより currentTenant は必ず存在する
  const tenantId = currentTenant!.id;
  const { currentStore } = useStoreContext();

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
  } = useAttendance(tenantId, currentStore?.id ?? null);

  const { myShifts, getMyShifts, loading: shiftLoading } = useShift(tenantId);

  // 勤務中の労働時間をリアルタイム更新するためのタイマー
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (status !== 'working' && status !== 'on_break') return;
    setNow(new Date()); // ステータス変更時に即座に更新
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [status]);

  // 今週のシフトを取得
  useEffect(() => {
    const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    getMyShifts(weekStart, weekEnd);
  }, [getMyShifts]);

  if (loading && todayRecords.length === 0) {
    return (
      <div className="max-w-md mx-auto">
        <PageSkeleton />
      </div>
    );
  }

  const todayStr = todayFromHook;
  const todayDate = new Date();
  const dateDisplay = format(todayDate, 'M月d日（EEE）', { locale: ja });

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

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="text-center pt-6">
        <p className="text-3xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">{dateDisplay}</p>
      </div>

      {carryOverRecord && (
        <div className="bg-gradient-to-r from-rose-500 to-rose-600 text-white rounded-xl shadow-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">昨日の退勤打刻が未完了</p>
              <p className="text-sm text-white/90 mt-1">
                {carryOverRecord.date} に出勤({formatTime(carryOverRecord.clock_in)}) したまま退勤打刻がされていません
              </p>
              <button
                onClick={clockOut}
                className="mt-3 bg-white text-rose-600 font-semibold rounded-lg px-4 py-2"
              >
                今すぐ退勤打刻する
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col items-center gap-6 py-8">
        {currentStore == null ? (
          <div className="w-full max-w-md rounded-lg border border-amber-200 bg-amber-50 p-4 text-center text-sm text-amber-800">
            打刻するには上部のセレクタから店舗を選択してください。
          </div>
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
          icon={<Clock className="w-12 h-12 text-slate-400 dark:text-slate-500" />}
          title="まだ本日の打刻はありません"
          description="出勤ボタンを押して開始しましょう"
        />
      ) : (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 text-center">本日の記録</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">最初の出勤</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{formatTime(firstClockIn)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">最後の退勤</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{lastClockOut ? formatTime(lastClockOut) : (activeRecord ? '勤務中' : '-')}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">労働時間</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{formatDuration(totalWorkMinutes)}</p>
              </div>
            </div>
          </div>

          {/* Today's summary cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">本日の労働時間</p>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">{todayTotalHours}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">セッション数</p>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">{todayRecords.filter((r) => r.clock_in).length}</p>
            </div>
          </div>
        </>
      )}

      {/* 今週のシフト */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">今週のシフト</h3>
        {shiftLoading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 7 }).map((_, i) => (
              <ListRowSkeleton key={i} />
            ))}
          </div>
        ) : (
          upcomingShifts.length > 0 && (
            <div className="space-y-1.5">
              {upcomingShifts.map((shift) => (
                <div key={shift.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-300 font-medium">
                    {format(new Date(shift.date), 'M/d(E)', { locale: ja })}
                  </span>
                  <span className="text-gray-800 dark:text-gray-200">
                    {shift.start_time.slice(0, 5)} 〜 {shift.end_time.slice(0, 5)}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    shift.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                    shift.status === 'pending'  ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
                    'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                  }`}>
                    {shift.status === 'approved' ? '承認済' : shift.status === 'pending' ? '申請中' : shift.status}
                  </span>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
