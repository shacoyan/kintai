import { useState, useEffect, useRef, useMemo } from 'react';
import { useTenant } from '../hooks/useTenant';
import { useAuth } from '../hooks/useAuth';
import { useTenantAdmin } from '../hooks/useTenantAdmin';
import { useAttendanceViewer } from '../hooks/useAttendanceViewer';
import { useStoreContext } from '../contexts/StoreContext';
import { useToast } from '../contexts/ToastContext';
import { DailyList } from '../components/Attendance/DailyList';
import { MonthlySummary } from '../components/Attendance/MonthlySummary';
import { CorrectionForm } from '../components/Correction/CorrectionForm';
import { useCorrection } from '../hooks/useCorrection';
import { AttendanceRecord, CorrectionRequest } from '../types';
import { buildCsv, downloadCsv, type CsvRow } from '../lib/csv';
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
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Badge, ListRowSkeleton, EmptyState, Skeleton, HistorySkeleton, Heading } from '../components/ui';
import { messages } from '../lib/messages';

// safelist: bg-blue-500, bg-blue-400, bg-emerald-500, bg-emerald-400, bg-red-500, bg-red-400, text-blue-500, text-blue-400, text-red-500, text-red-400

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
  correctionRequests?: CorrectionRequest[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
}

function calcWorkMinutes(record: AttendanceRecord): number {
  if (record.total_work_minutes != null) return record.total_work_minutes;
  if (!record.clock_in || !record.clock_out) return 0;
  return Math.max(0, differenceInMinutes(parseISO(record.clock_out), parseISO(record.clock_in)));
}

function calcBreakMinutes(record: AttendanceRecord): number {
  return (record.breaks ?? []).reduce((sum, breakRecord) => {
    if (!breakRecord.start_time || !breakRecord.end_time) return sum;
    return sum + Math.max(0, differenceInMinutes(parseISO(breakRecord.end_time), parseISO(breakRecord.start_time)));
  }, 0);
}

function formatWorkHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function formatRecordTime(time: string | null | undefined): string {
  return time ? format(parseISO(time), 'HH:mm') : '--:--';
}

function HistoryCalendar({ year, month, records, correctionRequests, selectedDate, onSelectDate }: HistoryCalendarProps) {
  const pendingDateSet = new Set(
    (correctionRequests ?? []).filter(r => r.status === 'pending').map(r => r.date)
  );
  
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

  const legends: { color: string; label: string }[] = [
    { color: 'bg-emerald-500 dark:bg-emerald-400', label: '通常勤務' },
    { color: 'bg-blue-500 dark:bg-blue-400', label: '8時間以上' },
  ];

  return (
    <Card padding="none">
      <div className="grid grid-cols-7 border-b border-stone-200 dark:border-stone-700">
        {weekDayLabels.map((day, i) => (
          <div
            key={day}
            className={`py-2 text-center text-xs font-semibold ${
              i === 5
                ? 'text-blue-500 dark:text-blue-400'
                : i === 6
                ? 'text-red-500 dark:text-red-400'
                : 'text-stone-500 dark:text-stone-300'
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
                    onSelectDate(isSelected ? null : dateKey);
                  }}
                  disabled={isFuture && isCurrentMonth}
                  className={`relative w-full min-h-[56px] p-1 text-left border-b border-r border-stone-100 dark:border-stone-700 motion-safe:transition-colors duration-150 ease-out ${
                    !isCurrentMonth
                      ? 'bg-stone-50 dark:bg-stone-900/30 cursor-default'
                      : isFuture
                      ? 'cursor-default'
                      : isSelected
                      ? 'bg-blue-50 dark:bg-blue-900/20'
                      : 'hover:bg-stone-50 dark:hover:bg-stone-700/50'
                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400`}
                >
                  <span
                    className={`text-xs font-medium block mb-0.5 ${
                      !isCurrentMonth
                        ? 'text-stone-300 dark:text-stone-600'
                        : isFuture
                        ? 'text-stone-300 dark:text-stone-600'
                        : dayOfWeek === 0
                        ? 'text-red-500 dark:text-red-400'
                        : dayOfWeek === 6
                        ? 'text-blue-500 dark:text-blue-400'
                        : 'text-stone-700 dark:text-stone-300'
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
                              ? 'bg-blue-500 dark:bg-blue-400'
                              : 'bg-emerald-500 dark:bg-emerald-400'
                          }`}
                        />
                        {workMins > 0 && (
                          <span className="text-xs text-stone-500 dark:text-stone-300 leading-none">
                            {formatWorkHours(workMins)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {isCurrentMonth && pendingDateSet.has(dateKey) && (
                    <span
                      className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-orange-500 dark:bg-orange-400"
                      aria-label="修正申請中"
                    />
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-2 border-t border-stone-100 dark:border-stone-700 flex items-center gap-4 text-xs text-stone-500 dark:text-stone-300">
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

interface SelectedDayDetailProps {
  date: string | null;
  record: AttendanceRecord | undefined;
  onRequestCorrection?: (date: string, record?: AttendanceRecord) => void;
  pending: boolean;
}

function SelectedDayDetail({ date, record, onRequestCorrection, pending }: SelectedDayDetailProps) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const isFuture = date != null && date > today;
  const workMinutes = record ? calcWorkMinutes(record) : 0;
  const breakMinutes = record ? calcBreakMinutes(record) : 0;

  return (
    <Card padding="md" className="min-h-[280px]">
      <div className="flex h-full flex-col gap-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className={`text-base font-semibold ${date ? 'text-stone-900 dark:text-stone-100' : 'text-stone-500 dark:text-stone-300'}`}>
            {date ? format(parseISO(date), 'M月d日 (E)', { locale: ja }) : '日付を選択してください'}
          </h3>
          {pending && <Badge tone="warning">修正申請中</Badge>}
        </div>

        {date == null ? (
          <p className="text-sm text-stone-500 dark:text-stone-300">カレンダーまたはグラフから日付を選択してください。</p>
        ) : isFuture ? (
          <p className="text-sm text-stone-500 dark:text-stone-300">未来の日付です</p>
        ) : record ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-stone-500 dark:text-stone-300">出勤</p>
                <p className="text-2xl font-semibold tabular-nums text-stone-900 dark:text-stone-100">{formatRecordTime(record.clock_in)}</p>
              </div>
              <div>
                <p className="text-xs text-stone-500 dark:text-stone-300">退勤</p>
                <p className="text-2xl font-semibold tabular-nums text-stone-900 dark:text-stone-100">{formatRecordTime(record.clock_out)}</p>
              </div>
              <div>
                <p className="text-xs text-stone-500 dark:text-stone-300">勤務</p>
                <p className="text-2xl font-semibold tabular-nums text-stone-900 dark:text-stone-100">{formatWorkHours(workMinutes)}</p>
              </div>
            </div>
            <p className="text-sm text-stone-600 dark:text-stone-300 tabular-nums">休憩 {formatWorkHours(breakMinutes)}</p>
          </>
        ) : (
          <p className="text-sm text-stone-500 dark:text-stone-300">打刻記録がありません</p>
        )}

        {date && !isFuture && onRequestCorrection && (
          <div className="mt-auto pt-2">
            <Button
              variant="primary"
              size="md"
              onClick={() => onRequestCorrection(date, record)}
              fullWidth
            >
              この日を修正申請する
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

interface MonthlyBarChartProps {
  year: number;
  month: number;
  records: AttendanceRecord[];
  onBarClick?: (date: string) => void;
  selectedDate: string | null;
}

function MonthlyBarChart({ year, month, records, onBarClick, selectedDate }: MonthlyBarChartProps) {
  const monthStart = startOfMonth(new Date(year, month - 1, 1));
  const monthEnd = endOfMonth(monthStart);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const recordMap = new Map<string, AttendanceRecord>();
  records.forEach(record => {
    if (record.date) recordMap.set(record.date, record);
  });
  const dayValues = days.map(day => {
    const dateKey = format(day, 'yyyy-MM-dd');
    const record = recordMap.get(dateKey);
    return {
      dateKey,
      dayLabel: format(day, 'd'),
      minutes: record ? calcWorkMinutes(record) : 0,
    };
  });
  const maxMinutes = Math.max(10 * 60, ...dayValues.map(day => day.minutes));

  return (
    <Card padding="md">
      <h3 className="text-label text-stone-500 dark:text-stone-300 mb-4">日別勤務時間</h3>
      {records.length === 0 ? (
        <EmptyState size="sm" title="データなし" />
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="flex items-end gap-1 min-w-max h-[160px]">
            {dayValues.map(({ dateKey, dayLabel, minutes }) => {
              const height = maxMinutes > 0 ? Math.max(2, Math.round((minutes / maxMinutes) * 136)) : 2;
              const isSelected = selectedDate === dateKey;
              const isOvertime = minutes >= 8 * 60;
              const barColor = minutes === 0
                ? 'bg-stone-200 dark:bg-stone-700'
                : isOvertime
                ? 'bg-blue-600 dark:bg-blue-500'
                : 'bg-blue-300 dark:bg-blue-400';

              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => onBarClick?.(dateKey)}
                  className="group flex w-7 cursor-pointer flex-col items-center justify-end gap-1 focus-visible:outline-none"
                  aria-label={`${dayLabel}日 ${formatWorkHours(minutes)}`}
                >
                  <span
                    className={`w-6 rounded-t motion-safe:transition-colors duration-150 ${barColor} ${
                      isSelected ? 'ring-2 ring-blue-700 ring-offset-2 dark:ring-blue-300 dark:ring-offset-stone-900' : ''
                    } group-hover:bg-blue-500 dark:group-hover:bg-blue-400 group-focus-visible:ring-2 group-focus-visible:ring-blue-500 group-focus-visible:ring-offset-2 dark:group-focus-visible:ring-offset-stone-900 cursor-pointer`}
                    style={{ height }}
                  />
                  <span className="text-xs text-stone-500 dark:text-stone-300 tabular-nums">{dayLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

export function HistoryPage() {
  const { currentTenant, myRole, isOwner, tenants } = useTenant();
  const tenantId = currentTenant!.id;
  const { currentStore } = useStoreContext();
  const { user } = useAuth();
  
  const myUserId = user?.id ?? null;
  const canSwitchUser = isOwner || myRole === 'manager';
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const effectiveUserId = selectedUserId ?? myUserId;

  const { members, fetchMembers } = useTenantAdmin(tenantId);
  const { fetchRecords, monthlyRecords, monthlySummary, loading } = useAttendanceViewer(tenantId, currentStore?.id ?? null, effectiveUserId);
  const { requests: correctionRequests, fetchRequests: fetchCorrectionRequests } = useCorrection(tenantId);
  const { showToast } = useToast();
  
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    void fetchCorrectionRequests();
  }, [fetchCorrectionRequests]);

  // 自分の表示時のみ自分の修正申請ドットを出す（他メンバー閲覧時は出さない）
  const ownCorrectionRequests = effectiveUserId === myUserId
    ? correctionRequests.filter(r => r.user_id === myUserId)
    : [];

  useEffect(() => {
    if (canSwitchUser && currentStore?.id) {
      fetchMembers(currentStore.id);
    }
  }, [canSwitchUser, currentStore?.id, fetchMembers]);

  const [searchParams, setSearchParams] = useSearchParams();
  const initialDate = useMemo(() => {
    const dateParam = searchParams.get('date');
    if (dateParam && /^\d{4}-\d{2}(-\d{2})?$/.test(dateParam)) {
      const [y, m] = dateParam.split('-').map(Number);
      if (y && m && m >= 1 && m <= 12) return new Date(y, m - 1, 1);
    }
    return new Date();
  }, []); // 初回のみ
  const [currentDate, setCurrentDate] = useState<Date>(initialDate);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [correctionModal, setCorrectionModal] = useState<CorrectionModalState>({
    isOpen: false,
    date: '',
    mode: 'correction',
  });

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  useEffect(() => {
    setSelectedDate(null);
  }, [year, month]);

  useEffect(() => {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    if (searchParams.get('date') !== ym) {
      // 規律: setSearchParams は functional updater 形式で prev を複製してから set すること。
      // オブジェクトリテラル直接渡し (setSearchParams({ key: value })) は他クエリを破壊するため禁止。
      // 詳細: .company/engineering/docs/2026-04-28-kintai-loop15-techdesign.md L15-2 セクション参照
      // (Loop 14 Phase 2 L14-6 で確立した規律 + Track C で functional updater 化)
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('date', ym);
        return next;
      }, { replace: true });
    }
  }, [year, month, searchParams, setSearchParams]);

  useEffect(() => {
    if (!tenantId) return;
    Promise.resolve(fetchRecords(year, month))
      .then(() => { hasLoadedOnceRef.current = true; })
      .catch(() => { hasLoadedOnceRef.current = true; });
  }, [year, month, tenantId, effectiveUserId, fetchRecords]);

  function handlePrevMonth() {
    setCurrentDate(prev => subMonths(prev, 1));
  }

  function handleNextMonth() {
    setCurrentDate(prev => addMonths(prev, 1));
  }

  const formatHM = (t: string | null) => t ? new Date(t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';

  function handleDownloadCsv() {
    const headers = ['日付', '出勤', '退勤', '休憩(分)', '実働(分)', '深夜(分)', '備考'];
    const rows: CsvRow[] = monthlyRecords.map(r => [
      r.date,
      formatHM(r.clock_in),
      formatHM(r.clock_out),
      (r.breaks ?? []).reduce((sum, b) => sum + (b.start_time && b.end_time ? Math.max(0, Math.round((new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / 60000)) : 0), 0),
      r.total_work_minutes ?? 0,
      0,
      r.note ?? ''
    ]);
    const csv = buildCsv(headers, rows);
    const yyyyMm = format(currentDate, 'yyyy-MM');
    const displayName = effectiveUserId === myUserId
      ? tenants.find(t => t.id === tenantId)?.display_name ?? 'member'
      : members.find(m => m.user_id === effectiveUserId)?.display_name ?? 'member';
    downloadCsv(`kintai_${yyyyMm}_${displayName}.csv`, csv);
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
      showToast(correctionModal.mode === 'delete' ? messages.toast.correctionDeleted : messages.toast.correctionRequested, 'success');
    }
  }

  const hasRecords = monthlyRecords.length > 0;
  const showInitialSkeleton = loading && !hasLoadedOnceRef.current;
  const isRefetching = loading && hasLoadedOnceRef.current;
  const showEmpty = !showInitialSkeleton && !hasRecords && currentStore != null;
  
  const handleCorrection = effectiveUserId === myUserId ? handleRequestCorrection : undefined;
  const handleDeletion = effectiveUserId === myUserId ? handleRequestDeletion : undefined;
  const selectedRecord = selectedDate ? monthlyRecords.find(r => r.date === selectedDate) : undefined;
  const selectedDatePending = selectedDate
    ? ownCorrectionRequests.some(r => r.status === 'pending' && r.date === selectedDate)
    : false;

  const isCurrentMonthShown = (() => {
    const now = new Date();
    return now.getFullYear() === year && now.getMonth() + 1 === month;
  })();

  // 初回ロード時 (loading かつ初期データ未取得) はページ全体スケルトン
  if (showInitialSkeleton && !hasRecords && currentStore != null) {
    return (
      <div className="max-w-2xl mx-auto">
        <HistorySkeleton />
      </div>
    );
  }

  return (
    <div className={`max-w-6xl mx-auto px-4 py-6 space-y-6 motion-safe:transition-opacity duration-180 ease-out${isRefetching ? ' opacity-60 pointer-events-none' : ''}`}>
      {currentStore == null && (
        <Card padding="md">
          <div className="flex items-center justify-center gap-2 text-sm">
            <Badge tone="warning" withDot>店舗未選択</Badge>
            履歴を表示するには上部のセレクタから店舗を選択してください。
          </div>
        </Card>
      )}

      <header className="flex items-start justify-between gap-4">
        <div>
          <Heading level={1}>履歴</Heading>
          <p className="text-sm text-stone-500 dark:text-stone-300 mt-1">勤怠の月次記録を確認します</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center bg-stone-100 dark:bg-stone-800 rounded-full p-1">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`rounded-full px-4 py-1.5 text-sm font-medium motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-50 shadow-sm'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
              }`}
              aria-pressed={viewMode === 'list'}
            >
              リスト
            </button>
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              className={`rounded-full px-4 py-1.5 text-sm font-medium motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                viewMode === 'calendar'
                  ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-50 shadow-sm'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
              }`}
              aria-pressed={viewMode === 'calendar'}
            >
              カレンダー
            </button>
          </div>
        </div>
      </header>
      
      <Card padding="md">
        <div className="flex items-center justify-between gap-2">
          <Button variant="tertiary" size="md" iconLeft={<ChevronLeft className="w-5 h-5 text-stone-600 dark:text-stone-300" />} onClick={handlePrevMonth} aria-label="前月"><></></Button>
          <div className="flex items-center gap-2">
            <Heading level={2}>
              {format(currentDate, 'yyyy年M月', { locale: ja })}
            </Heading>
            {!isCurrentMonthShown && (
              <Button variant="tertiary" size="sm" onClick={() => setCurrentDate(new Date())}>
                今月へ
              </Button>
            )}
            <Button
              variant="primary"
              size="md"
              onClick={handleDownloadCsv}
            >
              CSV ダウンロード
            </Button>
          </div>
          <Button variant="tertiary" size="md" iconLeft={<ChevronRight className="w-5 h-5 text-stone-600 dark:text-stone-300" />} onClick={handleNextMonth} aria-label="翌月"><></></Button>
        </div>

        {canSwitchUser && currentStore != null && (
          <div className="flex items-center gap-2 pt-2 justify-center">
            <label className="text-sm text-stone-500 dark:text-stone-300">対象メンバー:</label>
            <select value={effectiveUserId ?? ''} onChange={(e) => setSelectedUserId(e.target.value || null)}
              className="px-2 py-1 text-sm border border-stone-300 rounded-md bg-white dark:bg-stone-900 dark:border-stone-700 text-stone-900 dark:text-stone-100">
              {myUserId && <option value={myUserId}>自分</option>}
              {members.filter(m => m.user_id !== myUserId).map(m => (
                <option key={m.user_id} value={m.user_id}>{m.display_name}</option>
              ))}
            </select>
          </div>
        )}
      </Card>

      <MonthlySummary summary={monthlySummary} />

      {showInitialSkeleton ? (
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
              icon={<CalendarX className="w-12 h-12 text-stone-400 dark:text-stone-500" />}
              title={messages.empty.historyMonth.title}
              description="ダッシュボードから打刻すると、ここに記録が表示されます。"
            />
          ) : (
            <Card padding="none">
              <Card.Header>
                <h3 className="text-label text-stone-500 dark:text-stone-300">日別勤怠記録</h3>
              </Card.Header>
              <DailyList
                records={monthlyRecords}
                year={year}
                month={month}
                onRequestCorrection={handleCorrection}
                onRequestDeletion={handleDeletion}
                correctionRequests={ownCorrectionRequests}
              />
            </Card>
          )
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
              <HistoryCalendar
                year={year}
                month={month}
                records={monthlyRecords}
                correctionRequests={ownCorrectionRequests}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
              />
              <SelectedDayDetail
                date={selectedDate}
                record={selectedRecord}
                pending={selectedDatePending}
                onRequestCorrection={handleCorrection}
              />
            </div>
            <MonthlyBarChart
              year={year}
              month={month}
              records={monthlyRecords}
              selectedDate={selectedDate}
              onBarClick={setSelectedDate}
            />
            {showEmpty && (
              <EmptyState
                size="sm"
                title={messages.empty.historyMonth.title}
              />
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
