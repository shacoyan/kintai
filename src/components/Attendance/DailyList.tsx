import { eachDayOfInterval, startOfMonth, endOfMonth, format, parseISO, differenceInMinutes } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AttendanceRecord } from '../../types';

interface DailyListProps {
  records: AttendanceRecord[];
  year: number;
  month: number;
  onRequestCorrection: (date: string, record?: AttendanceRecord) => void;
  onRequestDeletion: (date: string, record: AttendanceRecord) => void;
}

export function DailyList({ records, year, month, onRequestCorrection, onRequestDeletion }: DailyListProps) {
  const start = startOfMonth(new Date(year, month - 1, 1));
  const end = endOfMonth(new Date(year, month - 1, 1));
  const days = eachDayOfInterval({ start, end });
  const today = format(new Date(), 'yyyy-MM-dd');

  const formatHM = (iso: string | null) => {
    if (!iso) return null;
    return format(parseISO(iso), 'HH:mm');
  };

  const formatMinutes = (minutes: number | null | undefined) => {
    if (minutes == null) return null;
    const abs = Math.abs(minutes);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `${h}h ${m.toString().padStart(2, '0')}m`;
  };

  const getBreakMinutes = (record: AttendanceRecord) => {
    if (record.breaks && record.breaks.length > 0) {
      return record.breaks.reduce((sum, b) => {
        if (b.start_time && b.end_time) {
          return sum + differenceInMinutes(parseISO(b.end_time), parseISO(b.start_time));
        }
        return sum;
      }, 0);
    }
    if (record.break_start && record.break_end) {
      return differenceInMinutes(parseISO(record.break_end), parseISO(record.break_start));
    }
    return 0;
  };

  const recordsByDate = new Map<string, AttendanceRecord[]>();
  for (const record of records) {
    const existing = recordsByDate.get(record.date) || [];
    existing.push(record);
    recordsByDate.set(record.date, existing);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="px-3 py-2 text-left font-medium text-gray-600">日付</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">出勤</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">退勤</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">休憩</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">労働時間</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600"></th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const dayRecords = recordsByDate.get(dateStr) || [];
            const isToday = dateStr === today;

            if (dayRecords.length === 0) {
              return (
                <tr
                  key={dateStr}
                  className={`border-b border-gray-100 ${isToday ? 'bg-blue-50' : ''}`}
                >
                  <td className={`px-3 py-2 ${isToday ? 'font-bold' : ''}`}>
                    {format(day, 'M/d(E)', { locale: ja })}
                  </td>
                  <td className="px-3 py-2 text-gray-300">--:--</td>
                  <td className="px-3 py-2 text-gray-300">--:--</td>
                  <td className="px-3 py-2 text-gray-300">--:--</td>
                  <td className="px-3 py-2 text-gray-300">--:--</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => onRequestCorrection(dateStr)}
                      className="px-2 py-1 text-xs text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
                    >
                      修正申請
                    </button>
                  </td>
                </tr>
              );
            }

            return dayRecords.map((record, index) => {
              const breakMins = getBreakMinutes(record);
              return (
                <tr
                  key={record.id}
                  className={`border-b border-gray-100 ${isToday ? 'bg-blue-50' : ''}`}
                >
                  <td className={`px-3 py-2 ${isToday ? 'font-bold' : ''}`}>
                    {index === 0 ? format(day, 'M/d(E)', { locale: ja }) : ''}
                  </td>
                  <td className="px-3 py-2">
                    {formatHM(record.clock_in) || '--:--'}
                  </td>
                  <td className="px-3 py-2">
                    {formatHM(record.clock_out) || '--:--'}
                  </td>
                  <td className="px-3 py-2">
                    {breakMins > 0 ? formatMinutes(breakMins) : '--:--'}
                  </td>
                  <td className="px-3 py-2">
                    {formatMinutes(record.total_work_minutes) || '--:--'}
                  </td>
                  <td className="px-3 py-2 space-x-1">
                    <button
                      onClick={() => onRequestCorrection(dateStr, record)}
                      className="px-2 py-1 text-xs text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
                    >
                      修正申請
                    </button>
                    <button
                      onClick={() => onRequestDeletion(dateStr, record)}
                      className="px-2 py-1 text-xs text-red-600 bg-red-50 rounded hover:bg-red-100 transition-colors"
                    >
                      削除依頼
                    </button>
                  </td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}
