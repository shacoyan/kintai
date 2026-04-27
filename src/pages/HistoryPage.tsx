import { useState, useEffect } from 'react';
import { useTenant } from '../hooks/useTenant';
import { useStoreContext } from '../contexts/StoreContext';
import { useAttendance } from '../hooks/useAttendance';
import { useToast } from '../contexts/ToastContext';
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
import { ChevronLeft, ChevronRight, CalendarX } from 'lucide-react';
import { Button, Card, Badge, ListRowSkeleton, EmptyState, Skeleton } from '../components/ui';

// safelist: bg-info-500, bg-info-400, bg-success-500, bg-success-400, bg-danger-500, bg-danger-400, text-info-500, text-info-400, text-danger-500, text-danger-400

interface CorrectionModalState {
  isOpen: boolean;
  date: string;
  recordId?: string;
  clockIn?: string;
  clockOut?: string;
  mode: 'correction' | 'delete';
}

interface HistoryCalendarProps {
  year: number;
  month: number;
  records: AttendanceRecord[];
  onRequestCorrection?: (date: string, record?: AttendanceRecord) => void;
}

function HistoryCalendar({ year, month, records, onRequestCorrection }: HistoryCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  
  const monthStart = startOfMonth(new Date(year, month - 1, 1));
  const monthEnd = endOfMonth(monthStart);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfMonth(monthEnd);

  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const totalCells = Math.ceil(days.length / 7) * 7;
  while (days.length < totalCells) {
    const last = days[days.length - 1];
    const next = new Date(last);
    next.setDate(next.getDate() + 1);
    days.push(next);
  }

  const recordMap = new Map<string, AttendanceRecord>();
  records.forEach(r => {
    if (r.date) recordMap.set(r.date, r);
  });

  const weekDayLabels = ['月', '火', '水', '木', '金', '土', '日'];
  const today = format(new Date(), 'yyyy-MM-dd');

  function calcWorkMinutes(record: AttendanceRecord): number {
    if (record.total_work_minutes != null) return record.total_work_minutes;
    if (!record.clock_in || !record.clock_out) return 0;
    return Math.max(0, differenceInMinutes(parseISO(record.clock_out), parseISO(record.clock_in)));
  }

  function formatWorkHours(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  }

  const legends: { color: string; label: string }[] = [
    { color: 'bg-success-500 dark:bg-success-400', label: '通常勤務' },
    { color: 'bg-info-500 dark:bg-info-400', label: '8時間以上' },
  ];

  return (
    <Card padding="none">
      <div className="grid grid-cols-7 border-b border-neutral-200 dark:border-neutral-700">
        {weekDayLabels.map((day, i) => (
          <div
            key={day}
            className={`py-2 text-center text-xs font-semibold ${
              i === 5
                ? 'text-info-500 dark:text-info-400'
                : i === 6
                ? 'text-danger-500 dark:text-danger-400'
                : 'text-neutral-500 dark:text-neutral-400'
            }`}
          >
            {day}
          </div>
        ))}
      </div>

      <div className="px-4 pb-4">
        <div className="grid grid-cols-7">
          {days.map((day, idx) => {
            const dateKey = format(day, 'yyyy-MM-dd');
            const record = recordMap.get(dateKey);
            const isCurrentMonth = isSameMonth(day, new Date(year, month - 1, 1));
            const workMins = record ? calcWorkMinutes(record) : 0;
            const isOvertime = workMins >= 8 * 60; 
            const isSelected = selectedDate === dateKey;
            const dayOfWeek = day.getDay(); 
            const isFuture = dateKey > today;

            return (
              <div key={idx}>
                <button
                  onClick={() => {
                    if (!isCurrentMonth || isFuture) return;
                    setSelectedDate(isSelected ? null : dateKey);
                  }}
                  disabled={isFuture && isCurrentMonth}
                  className={`w-full min-h-[56px] p-1 text-left border-b border-r border-neutral-100 dark:border-neutral-700 transition-colors ${
                    !isCurrentMonth
                      ? 'bg-neutral-50 dark:bg-neutral-900/30 cursor-default'
                      : isFuture
                      ? 'cursor-default'
                      : isSelected
                      ? 'bg-primary-50 dark:bg-primary-900/20'
                      : 'hover:bg-neutral-50 dark:hover:bg-neutral-700/50'
                  }`}
                >
                  <span
                    className={`text-xs font-medium block mb-0.5 ${
                      !isCurrentMonth
                        ? 'text-neutral-300 dark:text-neutral-600'
                        : isFuture
                        ? 'text-neutral-300 dark:text-neutral-600'
                        : dayOfWeek === 0
                        ? 'text-danger-500 dark:text-danger-400'
                        : dayOfWeek === 6
                        ? 'text-info-500 dark:text-info-400'
                        : 'text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    {format(day, 'd')}
                  </span>

                  {isCurrentMonth && !isFuture && record && record.clock_in && (
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1">
                        <span
                          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            isOvertime
                              ? 'bg-info-500 dark:bg-info-400'
                              : 'bg-success-500 dark:bg-success-400'
                          }`}
                        />
                        {workMins > 0 && (
                          <span className="text-xs text-neutral-500 dark:text-neutral-400 leading-none">
                            {formatWorkHours(workMins)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </button>

                {isSelected && isCurrentMonth && !isFuture && (
                  <div className="col-span-7 bg-primary-50 dark:bg-primary-900/20 border-b border-primary-200 dark:border-primary-800 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300 space-y-1">
                    <p className="font-semibold text-primary-700 dark:text-primary-300">{dateKey}</p>
                    {record?.clock_in && <p>出勤: {format(parseISO(record.clock_in), 'HH:mm')}</p>}
                    {record?.clock_out && <p>退勤: {format(parseISO(record.clock_out), 'HH:mm')}</p>}
                    {record && workMins > 0 && <p>勤務時間: {formatWorkHours(workMins)}</p>}
                    {!record && <p className="text-neutral-500 dark:text-neutral-400">記録なし</p>}
                    <div className="pt-1">
                      <button onClick={(e) => { e.stopPropagation(); onRequestCorrection?.(dateKey, record ?? undefined); }}
                        className="text-xs text-primary-700 dark:text-primary-300 underline hover:no-underline">
                        この日を修正申請する
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-4 py-2 border-t border-neutral-100 dark:border-neutral-700 flex items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
          {legends.map((legend) => (
            <div key={legend.label} className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${legend.color}`} />
              <span>{legend.label}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function HistoryPage() {
  const { currentTenant } = useTenant();
  const tenantId = currentTenant!.id;
  const { currentStore } = useStoreContext();
  const { fetchRecords, monthlyRecords, monthlySummary, loading } = useAttendance(tenantId, currentStore?.id ?? null);
  const { showToast } = useToast();

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

  function handleCloseCorrectionModal(submitted?: boolean) {
    setCorrectionModal({ isOpen: false, date: '', mode: 'correction' });
    fetchRecords(year, month);
    if (submitted) {
      showToast(correctionModal.mode === 'delete' ? '削除依頼を送信しました' : '修正申請を送信しました', 'success');
    }
  }

  const hasRecords = monthlyRecords.length > 0;
  const showEmpty = !loading && !hasRecords && currentStore != null;

  const isCurrentMonthShown = (() => {
    const now = new Date();
    return now.getFullYear() === year && now.getMonth() + 1 === month;
  })();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {currentStore == null && (
        <Card padding="md">
          <div className="flex items-center justify-center gap-2 text-sm">
            <Badge tone="warning" withDot>店舗未選択</Badge>
            履歴を表示するには上部のセレクタから店舗を選択してください。
          </div>
        </Card>
      )}
      
      <Card padding="md">
        <div className="flex items-center justify-between gap-2">
          <Button variant="tertiary" size="md" iconLeft={<ChevronLeft className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />} onClick={handlePrevMonth} aria-label="前月">
            <span className="sr-only">前月</span>
          </Button>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
              {format(currentDate, 'yyyy年M月', { locale: ja })}
            </h2>
            {!isCurrentMonthShown && (
              <Button variant="tertiary" size="sm" onClick={() => setCurrentDate(new Date())}>
                今月へ
              </Button>
            )}
          </div>
          <Button variant="tertiary" size="md" iconLeft={<ChevronRight className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />} onClick={handleNextMonth} aria-label="翌月">
            <span className="sr-only">翌月</span>
          </Button>
        </div>

        <div className="flex justify-center mt-2">
          <div className="inline-flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-700 rounded-md">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-neutral-600 shadow-xs text-primary-700 dark:text-primary-300'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
              }`}
            >
              リスト
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                viewMode === 'calendar'
                  ? 'bg-white dark:bg-neutral-600 shadow-xs text-primary-700 dark:text-primary-300'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
              }`}
            >
              カレンダー
            </button>
          </div>
        </div>
      </Card>

      <MonthlySummary summary={monthlySummary} />

      {loading ? (
        viewMode === 'list' ? (
          <Card padding="md">
            <ListRowSkeleton />
            <ListRowSkeleton />
            <ListRowSkeleton />
          </Card>
        ) : (
          <Card padding="none">
            <div className="p-4">
              <Skeleton variant="rectangular" height={28} className="mb-3" />
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 42 }).map((_, i) => (
                  <Skeleton key={i} variant="rectangular" height={56} />
                ))}
              </div>
            </div>
          </Card>
        )
      ) : (
        viewMode === 'list' ? (
          showEmpty ? (
            <EmptyState
              icon={<CalendarX className="w-12 h-12 text-neutral-400 dark:text-neutral-500" />}
              title="今月の勤怠データがまだありません"
              description="打刻するとここに記録が表示されます。"
            />
          ) : (
            <Card padding="none">
              <Card.Header>
                <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">日別勤怠記録</h3>
              </Card.Header>
              <DailyList
                records={monthlyRecords}
                year={year}
                month={month}
                onRequestCorrection={handleRequestCorrection}
                onRequestDeletion={handleRequestDeletion}
              />
            </Card>
          )
        ) : (
          <>
            <HistoryCalendar
              year={year}
              month={month}
              records={monthlyRecords}
              onRequestCorrection={handleRequestCorrection}
            />
            {showEmpty && (
              <p className="text-center text-sm text-neutral-500 dark:text-neutral-400 py-2">
                今月の打刻データがまだありません
              </p>
            )}
          </>
        )
      )}

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
