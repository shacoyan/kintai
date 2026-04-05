// FILE: pages/DashboardPage.tsx
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

  if (!tenantId) {
    return <Navigate to="/tenant" replace />;
  }

  return <DashboardContent tenantId={tenantId} />;
}

function DashboardContent({ tenantId }: { tenantId: string }) {
  const {
    todayRecord,
    status,
    clockIn,
    clockOut,
    breakStart,
    breakEnd,
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
  const dateDisplay = format(today, 'M月d日（EEE）', { locale: ja });

  const formatTime = (time: string | null | undefined) => {
    if (!time) return '-';
    return format(parseISO(time), 'HH:mm');
  };

  const formatDuration = (minutes: number | null | undefined) => {
    if (!minutes) return '-';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}時間${m}分`;
  };

  return (
    <div className="max-w-md mx-auto space-y-6">
      {/* 今日の日付 */}
      <div className="text-center pt-6">
        <p className="text-3xl font-bold text-gray-900">{dateDisplay}</p>
      </div>

      {/* 打刻ボタンエリア */}
      <div className="flex flex-col items-center gap-6 py-8">
        <ClockButton
          status={status}
          clockIn={clockIn}
          clockOut={clockOut}
          todayRecord={todayRecord}
        />
        <BreakButton
          status={status}
          breakStart={breakStart}
          breakEnd={breakEnd}
          todayRecord={todayRecord}
        />
      </div>

      {/* 今日のサマリーカード */}
      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <h3 className="text-lg font-semibold text-gray-900 text-center">本日の記録</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">出勤時刻</p>
            <p className="text-lg font-semibold text-gray-900">{formatTime(todayRecord?.clock_in)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">退勤時刻</p>
            <p className="text-lg font-semibold text-gray-900">{formatTime(todayRecord?.clock_out)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">労働時間</p>
            <p className="text-lg font-semibold text-gray-900">{formatDuration(todayRecord?.total_work_minutes)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
