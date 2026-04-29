import { eachDayOfInterval, startOfMonth, endOfMonth, format, parseISO, differenceInMinutes } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { ja } from 'date-fns/locale';
import { TrendingUp } from 'lucide-react';
import { AttendanceRecord, CorrectionRequest } from '../../types';
import { EmptyState } from '../ui/EmptyState';

interface DailyListProps {
  records: AttendanceRecord[];
  year: number;
  month: number;
  onRequestCorrection?: (date: string, record?: AttendanceRecord) => void;
  onRequestDeletion?: (date: string, record: AttendanceRecord) => void;
  correctionRequests?: CorrectionRequest[];
}

export function DailyList({ records, year, month, onRequestCorrection, onRequestDeletion, correctionRequests }: DailyListProps) {
  const start = startOfMonth(new Date(year, month - 1, 1));
  const end = endOfMonth(new Date(year, month - 1, 1));
  const days = eachDayOfInterval({ start, end });
  const today = formatInTimeZone(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

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
    return 0;
  };

  const recordsByDate = new Map<string, AttendanceRecord[]>();
  for (const record of records) {
    const existing = recordsByDate.get(record.date) || [];
    existing.push(record);
    recordsByDate.set(record.date, existing);
  }

  // 修正申請中（pending）の日別件数を集計
  const pendingCountByDate = new Map<string, number>();
  if (correctionRequests) {
    for (const req of correctionRequests) {
      if (req.status !== 'pending' || !req.date) continue;
      pendingCountByDate.set(req.date, (pendingCountByDate.get(req.date) ?? 0) + 1);
    }
  }
  const pendingBadge = (count: number) => (
    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
      修正申請中 {count}
    </span>
  );

  if (records.length === 0) {
    return (
      <EmptyState
        icon={<TrendingUp className="w-12 h-12 text-neutral-400 dark:text-neutral-500" />}
        title="勤怠記録がありません"
        description="出勤すると、ここに記録が表示されます"
      />
    );
  }

  return (
    <>
      {/* SP: カードリスト */}
      <div className="sm:hidden divide-y divide-neutral-200 dark:divide-neutral-700">
        {days.map(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const dayRecords = recordsByDate.get(dateStr) || [];
          const isToday = dateStr === today;
          const isFuture = dateStr > today;

          if (isFuture && dayRecords.length === 0) return null;

          if (dayRecords.length === 0) {
            const pendingCount = pendingCountByDate.get(dateStr) ?? 0;
            return (
              <div key={dateStr} className={`px-4 py-3 ${isToday ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm ${isToday ? 'font-bold text-primary-700 dark:text-primary-300' : 'text-neutral-600 dark:text-neutral-300'}`}>
                    {format(day, 'M/d(E)', { locale: ja })}
                    {pendingCount > 0 && pendingBadge(pendingCount)}
                  </span>
                  <span className="text-xs text-neutral-400 dark:text-neutral-500 tabular-nums">記録なし</span>
                  {onRequestCorrection && (
                    <button onClick={() => onRequestCorrection(dateStr)}
                      className="px-2 py-1 text-xs text-primary-600 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/30 rounded hover:bg-primary-100 dark:hover:bg-primary-900/50 motion-safe:transition-colors duration-120 ease-out-expo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
                      修正申請
                    </button>
                  )}
                </div>
              </div>
            );
          }

          const pendingCountSp = pendingCountByDate.get(dateStr) ?? 0;
          return dayRecords.map((record, index) => {
            const breakMins = getBreakMinutes(record);
            return (
              <div key={record.id} className={`px-4 py-3 space-y-2 ${isToday ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm ${isToday ? 'font-bold text-primary-700 dark:text-primary-300' : 'text-neutral-700 dark:text-neutral-200'}`}>
                    {index === 0 ? format(day, 'M/d(E)', { locale: ja }) : <span className="text-neutral-400 dark:text-neutral-500">↳ 同日</span>}
                    {index === 0 && pendingCountSp > 0 && pendingBadge(pendingCountSp)}
                  </span>
                  <span className="text-xs tabular-nums text-neutral-600 dark:text-neutral-300">
                    {formatHM(record.clock_in) || '--:--'} - {formatHM(record.clock_out) || '--:--'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-300 tabular-nums">
                  <span>休憩 {breakMins > 0 ? formatMinutes(breakMins) : '--'}</span>
                  <span>労働 {formatMinutes(record.total_work_minutes) || '--'}</span>
                </div>
                <div className="flex gap-2">
                  {onRequestCorrection && (
                    <button onClick={() => onRequestCorrection(dateStr, record)}
                      className="flex-1 px-2 py-1 text-xs text-primary-600 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/30 rounded hover:bg-primary-100 dark:hover:bg-primary-900/50 motion-safe:transition-colors duration-120 ease-out-expo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
                      修正申請
                    </button>
                  )}
                  {onRequestDeletion && (
                    <button onClick={() => onRequestDeletion(dateStr, record)}
                      className="flex-1 px-2 py-1 text-xs text-danger-600 dark:text-danger-300 bg-danger-50 dark:bg-danger-900/30 rounded hover:bg-danger-100 dark:hover:bg-danger-900/50 motion-safe:transition-colors duration-120 ease-out-expo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
                      削除依頼
                    </button>
                  )}
                </div>
              </div>
            );
          });
        })}
      </div>

      {/* PC: テーブル */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-700">
              <th className="px-3 py-2 text-left font-medium text-neutral-600 dark:text-neutral-300">日付</th>
              <th className="px-3 py-2 text-left font-medium text-neutral-600 dark:text-neutral-300">出勤</th>
              <th className="px-3 py-2 text-left font-medium text-neutral-600 dark:text-neutral-300">退勤</th>
              <th className="px-3 py-2 text-left font-medium text-neutral-600 dark:text-neutral-300">休憩</th>
              <th className="px-3 py-2 text-left font-medium text-neutral-600 dark:text-neutral-300">労働時間</th>
              <th className="px-3 py-2 text-left font-medium text-neutral-600 dark:text-neutral-300"></th>
            </tr>
          </thead>
          <tbody>
            {days.map(day => {
              const dateStr = format(day, 'yyyy-MM-dd');
              const dayRecords = recordsByDate.get(dateStr) || [];
              const isToday = dateStr === today;
              const isFuture = dateStr > today;

              if (isFuture && dayRecords.length === 0) return null;

              if (dayRecords.length === 0) {
                const pendingCount = pendingCountByDate.get(dateStr) ?? 0;
                return (
                  <tr
                    key={dateStr}
                    className={`border-b border-neutral-100 dark:border-neutral-800 ${isToday ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}
                  >
                    <td className={`px-3 py-2 text-neutral-700 dark:text-neutral-200 ${isToday ? 'font-bold text-primary-700 dark:text-primary-300' : ''}`}>
                      {format(day, 'M/d(E)', { locale: ja })}
                      {pendingCount > 0 && pendingBadge(pendingCount)}
                    </td>
                    <td className="px-3 py-2 text-neutral-300 dark:text-neutral-600">--:--</td>
                    <td className="px-3 py-2 text-neutral-300 dark:text-neutral-600">--:--</td>
                    <td className="px-3 py-2 text-neutral-300 dark:text-neutral-600">--:--</td>
                    <td className="px-3 py-2 text-neutral-300 dark:text-neutral-600">--:--</td>
                    <td className="px-3 py-2">
                      {onRequestCorrection && (
                        <button
                          onClick={() => onRequestCorrection(dateStr)}
                          className="px-2 py-1 text-xs text-primary-600 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/30 rounded hover:bg-primary-100 dark:hover:bg-primary-900/50 motion-safe:transition-colors duration-120 ease-out-expo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                        >
                          修正申請
                        </button>
                      )}
                    </td>
                  </tr>
                );
              }

              const pendingCountPc = pendingCountByDate.get(dateStr) ?? 0;
              return dayRecords.map((record, index) => {
                const breakMins = getBreakMinutes(record);
                const isFirst = index === 0;
                return (
                  <tr
                    key={record.id}
                    className={`${isFirst ? 'border-t border-neutral-200 dark:border-neutral-700' : 'border-t border-neutral-100/50 dark:border-neutral-800/50'} border-b border-neutral-100 dark:border-neutral-800 ${isToday ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}
                  >
                    <td className={`px-3 py-2 text-neutral-700 dark:text-neutral-200 ${isToday ? 'font-bold text-primary-700 dark:text-primary-300' : ''}`}>
                      {index === 0 ? format(day, 'M/d(E)', { locale: ja }) : ''}
                      {index === 0 && pendingCountPc > 0 && pendingBadge(pendingCountPc)}
                    </td>
                    <td className="px-3 py-2 text-neutral-700 dark:text-neutral-200">
                      {formatHM(record.clock_in) || <span className="text-neutral-300 dark:text-neutral-600">--:--</span>}
                    </td>
                    <td className="px-3 py-2 text-neutral-700 dark:text-neutral-200">
                      {formatHM(record.clock_out) || <span className="text-neutral-300 dark:text-neutral-600">--:--</span>}
                    </td>
                    <td className="px-3 py-2 text-neutral-700 dark:text-neutral-200">
                      {breakMins > 0 ? formatMinutes(breakMins) : <span className="text-neutral-300 dark:text-neutral-600">--:--</span>}
                    </td>
                    <td className="px-3 py-2 text-neutral-700 dark:text-neutral-200">
                      {formatMinutes(record.total_work_minutes) || <span className="text-neutral-300 dark:text-neutral-600">--:--</span>}
                    </td>
                    <td className="px-3 py-2 space-x-1">
                      {onRequestCorrection && (
                        <button
                          onClick={() => onRequestCorrection(dateStr, record)}
                          className="px-2 py-1 text-xs text-primary-600 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/30 rounded hover:bg-primary-100 dark:hover:bg-primary-900/50 motion-safe:transition-colors duration-120 ease-out-expo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                        >
                          修正申請
                        </button>
                      )}
                      {onRequestDeletion && (
                        <button
                          onClick={() => onRequestDeletion(dateStr, record)}
                          className="px-2 py-1 text-xs text-danger-600 dark:text-danger-300 bg-danger-50 dark:bg-danger-900/30 rounded hover:bg-danger-100 dark:hover:bg-danger-900/50 motion-safe:transition-colors duration-120 ease-out-expo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                        >
                          削除依頼
                        </button>
                      )}
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
