import { useState, useEffect } from 'react';
import { useTenant } from '../hooks/useTenant';
import { useAttendance } from '../hooks/useAttendance';
import { DailyList } from '../components/Attendance/DailyList';
import { MonthlySummary } from '../components/Attendance/MonthlySummary';
import { CorrectionForm } from '../components/Correction/CorrectionForm';
import { AttendanceRecord } from '../types';
import {
  format,
  subMonths,
  addMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  eachDayOfInterval,
  isSameMonth,
  parseISO,
  differenceInMinutes,
} from 'date-fns';
import { ja } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ListRowSkeleton } from '../components/ui/Skeleton';

interface CorrectionModalState {
  isOpen: boolean;
  date: string;
  recordId?: string;
  clockIn?: string;
  clockOut?: string;
  mode: 'correction' | 'delete';
}

// カレンダービューコンポーネント
interface HistoryCalendarProps {
  year: number;
  month: number;
  records: AttendanceRecord[];
  onClickDay: (date: string, record?: AttendanceRecord) => void;
}

function HistoryCalendar({ year, month, records, onClickDay }: HistoryCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // 対象月の日付グリッドを生成（月曜始まり）
  const monthStart = startOfMonth(new Date(year, month - 1, 1));
  const monthEnd = endOfMonth(monthStart);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfMonth(monthEnd);

  // グリッド終わりを日曜日に揃える
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  // 6行×7列になるよう末尾を埋める
  const totalCells = Math.ceil(days.length / 7) * 7;
  while (days.length < totalCells) {
    const last = days[days.length - 1];
    const next = new Date(last);
    next.setDate(next.getDate() + 1);
    days.push(next);
  }

  // recordsをdate keyでマップ化
  const recordMap = new Map<string, AttendanceRecord>();
  records.forEach(r => {
    if (r.date) recordMap.set(r.date, r);
  });

  const weekDayLabels = ['月', '火', '水', '木', '金', '土', '日'];

  function calcWorkMinutes(record: AttendanceRecord): number {
    // total_work_minutes が設定されている場合はそちらを優先
    if (record.total_work_minutes != null) return record.total_work_minutes;
    if (!record.clock_in || !record.clock_out) return 0;
    return Math.max(0, differenceInMinutes(parseISO(record.clock_out), parseISO(record.clock_in)));
  }

  function formatWorkHours(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
      {/* 曜日ヘッダー */}
      <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700">
        {weekDayLabels.map((day, i) => (
          <div
            key={day}
            className={`py-2 text-center text-xs font-semibold ${
              i === 5
                ? 'text-blue-500 dark:text-blue-400'
                : i === 6
                ? 'text-red-500 dark:text-red-400'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {day}
          </div>
        ))}
      </div>

      {/* 日付グリッド */}
      <div className="grid grid-cols-7">
        {days.map((day, idx) => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const record = recordMap.get(dateKey);
          const isCurrentMonth = isSameMonth(day, new Date(year, month - 1, 1));
          const workMins = record ? calcWorkMinutes(record) : 0;
          const isOvertime = workMins >= 8 * 60; // 8時間以上
          const isSelected = selectedDate === dateKey;
          const dayOfWeek = day.getDay(); // 0=日, 6=土

          return (
            <div key={idx}>
              <button
                onClick={() => {
                  if (!isCurrentMonth) return;
                  setSelectedDate(isSelected ? null : dateKey);
                  if (record) onClickDay(dateKey, record);
                }}
                className={`w-full min-h-[56px] p-1 text-left border-b border-r border-gray-100 dark:border-gray-700 transition-colors ${
                  !isCurrentMonth
                    ? 'bg-gray-50 dark:bg-gray-900/30 cursor-default'
                    : isSelected
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                {/* 日付番号 */}
                <span
                  className={`text-xs font-medium block mb-0.5 ${
                    !isCurrentMonth
                      ? 'text-gray-300 dark:text-gray-600'
                      : dayOfWeek === 0
                      ? 'text-red-500 dark:text-red-400'
                      : dayOfWeek === 6
                      ? 'text-blue-500 dark:text-blue-400'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {format(day, 'd')}
                </span>

                {/* 勤怠インジケーター */}
                {isCurrentMonth && record && record.clock_in && (
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1">
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          isOvertime
                            ? 'bg-blue-500 dark:bg-blue-400'
                            : 'bg-green-500 dark:bg-green-400'
                        }`}
                      />
                      {workMins > 0 && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 leading-none">
                          {formatWorkHours(workMins)}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </button>

              {/* 選択時の詳細ポップオーバー（展開） */}
              {isSelected && record && isCurrentMonth && (
                <div className="col-span-7 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 space-y-0.5">
                  <p className="font-semibold text-blue-700 dark:text-blue-300">{dateKey}</p>
                  {record.clock_in && (
                    <p>出勤: {format(parseISO(record.clock_in), 'HH:mm')}</p>
                  )}
                  {record.clock_out && (
                    <p>退勤: {format(parseISO(record.clock_out), 'HH:mm')}</p>
                  )}
                  {workMins > 0 && (
                    <p>勤務時間: {formatWorkHours(workMins)}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 凡例 */}
      <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500 dark:bg-green-400" />
          <span>通常勤務</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400" />
          <span>8時間以上</span>
        </div>
      </div>
    </div>
  );
}

export function HistoryPage() {
  const { currentTenant } = useTenant();
  // RequireTenant ガードにより currentTenant は必ず存在する
  const tenantId = currentTenant!.id;
  const { fetchRecords, monthlyRecords, monthlySummary, loading } = useAttendance(tenantId);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [correctionModal, setCorrectionModal] = useState<CorrectionModalState>({
    isOpen: false,
    date: '',
    mode: 'correction',
  });

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  useEffect(() => {
    if (tenantId) {
      fetchRecords(year, month);
    }
  }, [year, month, tenantId, fetchRecords]);

  function handlePrevMonth() {
    setCurrentDate(prev => subMonths(prev, 1));
  }

  function handleNextMonth() {
    setCurrentDate(prev => addMonths(prev, 1));
  }

  function handleRequestCorrection(date: string, record?: AttendanceRecord) {
    setCorrectionModal({
      isOpen: true,
      date,
      recordId: record?.id,
      clockIn: record?.clock_in ?? undefined,
      clockOut: record?.clock_out ?? undefined,
      mode: 'correction',
    });
  }

  function handleRequestDeletion(date: string, record: AttendanceRecord) {
    setCorrectionModal({
      isOpen: true,
      date,
      recordId: record.id,
      clockIn: record.clock_in ?? undefined,
      clockOut: record.clock_out ?? undefined,
      mode: 'delete',
    });
  }

  function handleCloseCorrectionModal() {
    setCorrectionModal({ isOpen: false, date: '', mode: 'correction' });
    fetchRecords(year, month);
  }

  // カレンダーの日付クリック時（修正申請は出さず詳細表示のみ）
  function handleCalendarDayClick(_date: string, _record?: AttendanceRecord) {
    // カレンダービューではクリックで展開表示のみ（インライン実装）
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* 月ナビゲーション + ビュー切り替え */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow px-4 py-3">
        <div className="flex items-center justify-between">
          <button
            onClick={handlePrevMonth}
            aria-label="前月"
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {format(currentDate, 'yyyy年M月(E)', { locale: ja })}
          </h2>
          <button
            onClick={handleNextMonth}
            aria-label="翌月"
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
        </div>

        {/* ビュー切り替えトグル */}
        <div className="flex justify-center mt-2">
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-gray-600 shadow text-gray-900 dark:text-gray-100'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              リスト
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                viewMode === 'calendar'
                  ? 'bg-white dark:bg-gray-600 shadow text-gray-900 dark:text-gray-100'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              カレンダー
            </button>
          </div>
        </div>
      </div>

      {/* 月次サマリー */}
      <MonthlySummary summary={monthlySummary} />

      {loading ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
          <ListRowSkeleton />
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      ) : viewMode === 'list' ? (
        /* リストビュー */
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400">日別勤怠記録</h3>
          </div>
          <DailyList
            records={monthlyRecords}
            year={year}
            month={month}
            onRequestCorrection={handleRequestCorrection}
            onRequestDeletion={handleRequestDeletion}
          />
        </div>
      ) : (
        /* カレンダービュー */
        <HistoryCalendar
          year={year}
          month={month}
          records={monthlyRecords}
          onClickDay={handleCalendarDayClick}
        />
      )}

      {/* 修正申請モーダル */}
      <CorrectionForm
        isOpen={correctionModal.isOpen}
        onClose={handleCloseCorrectionModal}
        date={correctionModal.date}
        tenantId={tenantId}
        attendanceRecordId={correctionModal.recordId}
        existingClockIn={correctionModal.clockIn}
        existingClockOut={correctionModal.clockOut}
        mode={correctionModal.mode}
      />
    </div>
  );
}
