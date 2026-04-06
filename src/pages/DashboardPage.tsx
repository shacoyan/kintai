import { useTenant } from '../hooks/useTenant';
import { useAttendance } from '../hooks/useAttendance';
import { ClockButton } from '../components/Attendance/ClockButton';
import { BreakButton } from '../components/Attendance/BreakButton';
import { Navigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';

export function DashboardPage() {
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id;
  if (!tenantId) return <Navigate to="/tenant" replace />;
  return <DashboardContent tenantId={tenantId} />;
}

function DashboardContent({ tenantId }: { tenantId: string }) {
  const {
    todayRecords,
    activeRecord,
    status,
    clockIn,
    clockOut,
    breakStart,
    breakEnd,
    activeBreak,
    loading,
  } = useAttendance(tenantId);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');
  const dateDisplay = format(today, 'M月d日（EEE）', { locale: ja });

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

  const totalWorkMinutes = todayOnlyRecords.reduce((sum, record) => sum + (record.total_work_minutes ?? 0), 0);

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

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="text-center pt-6">
        <p className="text-3xl font-bold text-gray-900">{dateDisplay}</p>
      </div>

      {carryOverRecord && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
          <p className="text-sm text-amber-800 font-medium">
            {carryOverRecord.date} から継続勤務中
          </p>
          <p className="text-xs text-amber-600 mt-1">
            出勤: {formatTime(carryOverRecord.clock_in)} — 退勤ボタンで終了できます
          </p>
        </div>
      )}

      <div className="flex flex-col items-center gap-6 py-8">
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
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <h3 className="text-lg font-semibold text-gray-900 text-center">本日の記録</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">最初の出勤</p>
            <p className="text-lg font-semibold text-gray-900">{formatTime(firstClockIn)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">最後の退勤</p>
            <p className="text-lg font-semibold text-gray-900">{lastClockOut ? formatTime(lastClockOut) : (activeRecord ? '勤務中' : '-')}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">労働時間</p>
            <p className="text-lg font-semibold text-gray-900">{formatDuration(totalWorkMinutes)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
