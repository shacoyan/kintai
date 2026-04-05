// FILE: components/Attendance/DailyList.tsx
import { eachDayOfInterval, startOfMonth, endOfMonth, format, parseISO, differenceInMinutes } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AttendanceRecord } from '../../types';

interface DailyListProps {
  records: AttendanceRecord[];
  year: number;
  month: number;
}

export function DailyList({ records, year, month }: DailyListProps) {
  const start = startOfMonth(new Date(year, month - 1, 1));
  const end = endOfMonth(new Date(year, month - 1, 1));
  const days = eachDayOfInterval({ start, end });
  const today = format(new Date(), 'yyyy-MM-dd');

  const formatHM = (iso: string | null) => {
    if (!iso) return null;
    return format(parseISO(iso), 'HH:mm');
  };

  const formatMinutes = (minutes: number | null) => {
    if (minutes === null || minutes === 0) return null;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m.toString().padStart(2, '0')}m`;
  };

  const getBreakMinutes = (record: AttendanceRecord) => {
    if (!record.break_start || !record.break_end) return null;
    return differenceInMinutes(parseISO(record.break_end), parseISO(record.break_start));
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[500px] text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="px-3 py-2 text-left font-medium text-gray-600">日付</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">出勤</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">退勤</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">休憩</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">労働時間</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const record = records.find((r) => r.date === dateStr);
            const isToday = dateStr === today;
            const hasRecord = !!record?.clock_in;

            return (
              <tr
                key={dateStr}
                className={`border-b border-gray-100 ${isToday ? 'bg-blue-50' : ''}`}
              >
                <td className={`px-3 py-2 ${isToday ? 'font-bold' : ''}`}>
                  {format(day, 'M/d(E)', { locale: ja })}
                </td>
                <td className={`px-3 py-2 ${!hasRecord ? 'text-gray-300' : ''}`}>
                  {formatHM(record?.clock_in ?? null) || '--:--'}
                </td>
                <td className={`px-3 py-2 ${!hasRecord ? 'text-gray-300' : ''}`}>
                  {formatHM(record?.clock_out ?? null) || '--:--'}
                </td>
                <td className={`px-3 py-2 ${!hasRecord ? 'text-gray-300' : ''}`}>
                  {record ? (formatMinutes(getBreakMinutes(record)) || '--:--') : '--:--'}
                </td>
                <td className={`px-3 py-2 ${!hasRecord ? 'text-gray-300' : ''}`}>
                  {record ? (formatMinutes(record.total_work_minutes) || '--:--') : '--:--'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
