import { useState, useEffect, useRef, useMemo } from 'react';
import { useTenant } from '../hooks/useTenant';
import { useAuth } from '../hooks/useAuth';
import { useTenantAdmin } from '../hooks/useTenantAdmin';
import { useAttendanceViewer } from '../hooks/useAttendanceViewer';
import { useStoreContext } from '../contexts/StoreContext';
import { useToast } from '../contexts/ToastContext';
import { DailyList } from '../components/Attendance/DailyList';
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
import { ChevronLeft, ChevronRight, CalendarX, Download } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Badge, ListRowSkeleton, EmptyState, Skeleton, HistorySkeleton } from '../components/ui';
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

function formatWorkHoursDecimal(minutes: number): string {
  return (minutes / 60).toFixed(1);
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

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-stone-200 dark:border-stone-700">
        {weekDayLabels.map((day, i) => (
          <div
            key={day}
            className={`py-1.5 lg:py-2 text-center text-[10px] lg:text-xs font-semibold ${
              i === 5
                ? 'text-blue-600 dark:text-blue-400'
                : i === 6
                ? 'text-red-600 dark:text-red-400'
                : 'text-stone-500 dark:text-stone-300'
            }`}
          >
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px bg-stone-200 dark:bg-stone-700">
          {days.map((day, idx) => {
            const dateKey = format(day, 'yyyy-MM-dd');
            const record = recordMap.get(dateKey);
            const isCurrentMonth = isSameMonth(day, new Date(year, month - 1, 1));
            const workMins = record ? calcWorkMinutes(record) : 0;
            const isSelected = selectedDate === dateKey;
            const isFuture = dateKey > today;
            const intensity = workMins > 0 ? Math.min(1, workMins / (9 * 60)) : 0;

            return (
                <button
                  key={idx}
                  onClick={() => {
                    if (!isCurrentMonth || isFuture) return;
                    onSelectDate(isSelected ? null : dateKey);
                  }}
                  disabled={isFuture && isCurrentMonth}
                  className={`relative flex min-h-[48px] lg:min-h-[78px] w-full flex-col gap-[3px] lg:gap-1 bg-white p-1 text-center lg:p-1.5 lg:px-2 lg:text-left dark:bg-stone-900 motion-safe:transition-colors duration-150 ease-out ${
                    !isCurrentMonth
                      ? 'cursor-default opacity-40'
                    : isFuture
                      ? 'cursor-default opacity-40'
                    : isSelected
                      ? 'outline outline-2 -outline-offset-2 outline-blue-600 dark:outline-blue-400'
                      : 'hover:bg-stone-50 dark:hover:bg-stone-800/70'
                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:focus-visible:ring-blue-400`}
                >
                  <span
                    className="block text-[10px] lg:text-[11px] font-semibold tabular-nums text-stone-700 dark:text-stone-200"
                  >
                    {format(day, 'd')}
                  </span>

                  {isCurrentMonth && !isFuture && record && record.clock_in && (
                    <>
                      <div className="text-[11px] lg:text-base font-semibold leading-none tabular-nums text-stone-900 dark:text-stone-100">
                        {formatWorkHoursDecimal(workMins)}
                        <span className="hidden lg:inline text-[9px] font-medium text-stone-500 dark:text-stone-300">h</span>
                      </div>
                      <div className="hidden text-[9px] tabular-nums text-stone-500 dark:text-stone-300 lg:block">
                        {formatRecordTime(record.clock_in)}-{formatRecordTime(record.clock_out)}
                      </div>
                    </>
                  )}

                  {isCurrentMonth && pendingDateSet.has(dateKey) && (
                    <span
                      className="absolute right-[3px] top-[3px] h-[5px] w-[5px] rounded-full bg-orange-500 lg:right-1 lg:top-1 lg:h-1.5 lg:w-1.5 dark:bg-orange-400"
                      aria-label="修正申請中"
                    />
                  )}
                  {isCurrentMonth && !isFuture && workMins > 0 && (
                    <span
                      className="absolute bottom-0 left-0 right-0 h-0.5 lg:h-[3px]"
                      style={{ background: `color-mix(in srgb, #2563eb ${30 + intensity * 70}%, transparent)` }}
                      aria-hidden="true"
                    />
                  )}
                </button>
            );
          })}
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
    <Card padding="md">
      <div className="flex h-full min-h-[220px] flex-col">
        <div className="mb-3 flex items-center gap-2">
          <h2 className={`text-base font-semibold ${date ? 'text-stone-900 dark:text-stone-100' : 'text-stone-500 dark:text-stone-300'}`}>
            {date ? format(parseISO(date), 'M月 d 日', { locale: ja }) : '日付を選択してください'}
          </h2>
          {date && <span className="text-xs text-stone-500 dark:text-stone-300">({format(parseISO(date), 'E', { locale: ja })})</span>}
          <div className="flex-1" />
          {date && record && (pending ? <Badge tone="warning">修正申請中</Badge> : <Badge tone="success">承認済</Badge>)}
        </div>

        {date == null ? (
          <p className="text-sm text-stone-500 dark:text-stone-300">カレンダーまたはグラフから日付を選択してください。</p>
        ) : isFuture ? (
          <p className="text-sm text-stone-500 dark:text-stone-300">未来の日付です</p>
        ) : record ? (
          <>
            <div className="grid grid-cols-3 overflow-hidden rounded-md border border-stone-200 dark:border-stone-700">
              <div className="border-r border-stone-200 p-2.5 dark:border-stone-700 lg:p-3">
                <p className="text-[10px] text-stone-500 dark:text-stone-300">出勤</p>
                <p className="text-[15px] lg:text-lg font-semibold tabular-nums text-stone-900 dark:text-stone-100">{formatRecordTime(record.clock_in)}</p>
              </div>
              <div className="border-r border-stone-200 p-2.5 dark:border-stone-700 lg:p-3">
                <p className="text-[10px] text-stone-500 dark:text-stone-300">退勤</p>
                <p className="text-[15px] lg:text-lg font-semibold tabular-nums text-stone-900 dark:text-stone-100">{formatRecordTime(record.clock_out)}</p>
              </div>
              <div className="p-2.5 lg:p-3">
                <p className="text-[10px] text-stone-500 dark:text-stone-300">勤務時間</p>
                <p className="text-[15px] lg:text-lg font-semibold tabular-nums text-stone-900 dark:text-stone-100">{formatWorkHoursDecimal(workMinutes)}h</p>
              </div>
            </div>
            {pending && (
              <div className="mt-3 rounded-md bg-orange-50 p-3 text-xs leading-relaxed text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                <strong>修正申請中</strong><br />
                この日の打刻修正を申請中です。承認されるまで現在の記録が表示されます。
              </div>
            )}
            <p className="mt-3 text-xs text-stone-500 dark:text-stone-300 tabular-nums">休憩 {formatWorkHours(breakMinutes)}</p>
          </>
        ) : (
          <div className="py-6 text-center text-xs text-stone-500 dark:text-stone-300">休日 — 打刻データなし</div>
        )}

        {date && !isFuture && onRequestCorrection && (
          <div className="mt-auto flex gap-2 pt-3">
            <Button
              variant="warning"
              size="md"
              onClick={() => onRequestCorrection(date, record)}
              fullWidth
            >
              修正申請
            </Button>
            <Button
              variant="tertiary"
              size="md"
              onClick={() => onRequestCorrection(date, record)}
              className="hidden lg:inline-flex"
            >
              休憩を編集
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
  const maxMinutes = Math.max(9 * 60, ...dayValues.map(day => day.minutes));

  return (
    <Card padding="md">
      <h3 className="mb-2.5 text-xs font-semibold text-stone-900 dark:text-stone-100">勤務時間の傾向</h3>
      {records.length === 0 ? (
        <EmptyState size="sm" title="データなし" />
      ) : (
        <>
          <div className="flex h-20 items-end gap-0.5">
            {dayValues.map(({ dateKey, dayLabel, minutes }) => {
              const height = maxMinutes > 0 ? Math.max(minutes > 0 ? 2 : 0, Math.round((minutes / maxMinutes) * 80)) : 0;
              const isSelected = selectedDate === dateKey;

              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => onBarClick?.(dateKey)}
                  className="group flex flex-1 cursor-pointer items-end focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  aria-label={`${dayLabel}日 ${formatWorkHours(minutes)}`}
                >
                  <span
                    className={`w-full rounded-t-sm motion-safe:transition-colors duration-150 ${
                      isSelected ? 'bg-blue-600 opacity-100 dark:bg-blue-500' : 'bg-stone-400 opacity-40 dark:bg-stone-500'
                    } group-hover:bg-blue-600 group-hover:opacity-80 dark:group-hover:bg-blue-500`}
                    style={{ height }}
                  />
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-stone-500 dark:text-stone-300">
            <span>1日</span>
            <span>15日</span>
            <span>{format(monthEnd, 'd')}日</span>
          </div>
        </>
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
  const pendingCorrectionCount = ownCorrectionRequests.filter(r => r.status === 'pending').length;

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
    <div className={`max-w-6xl mx-auto px-4 py-6 space-y-4 motion-safe:transition-opacity duration-180 ease-out${isRefetching ? ' opacity-60 pointer-events-none' : ''}`}>
      {currentStore == null && (
        <Card padding="md">
          <div className="flex items-center justify-center gap-2 text-sm">
            <Badge tone="warning" withDot>店舗未選択</Badge>
            履歴を表示するには上部のセレクタから店舗を選択してください。
          </div>
        </Card>
      )}

      <div className="mx-auto grid max-w-[1280px] grid-cols-1 gap-3.5 lg:grid-cols-[1.8fr_1fr] lg:gap-5">
        <div className="flex flex-col gap-3.5">
          <div className="flex items-center gap-2 lg:gap-2.5">
            <div className="order-5 ml-auto inline-flex items-center rounded-full bg-stone-100 p-1 dark:bg-stone-800 lg:order-none lg:ml-0">
              <button
                type="button"
                onClick={() => setViewMode('calendar')}
                className={`rounded-full px-3 py-1.5 text-xs font-medium motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:px-4 lg:text-sm ${
                  viewMode === 'calendar'
                    ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-50'
                    : 'text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100'
                }`}
                aria-pressed={viewMode === 'calendar'}
              >
                <span className="hidden lg:inline">カレンダー</span>
                <span className="lg:hidden">暦</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`rounded-full px-3 py-1.5 text-xs font-medium motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:px-4 lg:text-sm ${
                  viewMode === 'list'
                    ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-50'
                    : 'text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100'
                }`}
                aria-pressed={viewMode === 'list'}
              >
                <span className="hidden lg:inline">リスト</span>
                <span className="lg:hidden">一覧</span>
              </button>
            </div>
            <div className="hidden h-[22px] w-px bg-stone-200 dark:bg-stone-700 lg:block" />
            <Button variant="tertiary" size="sm" iconLeft={<ChevronLeft className="h-4 w-4 text-stone-600 dark:text-stone-300" />} onClick={handlePrevMonth} aria-label="前月"><></></Button>
            <div className="min-w-[70px] text-center text-[13px] font-semibold tabular-nums text-stone-900 dark:text-stone-100 lg:min-w-[90px] lg:text-sm">
              {format(currentDate, 'yyyy / MM')}
            </div>
            <Button variant="tertiary" size="sm" iconLeft={<ChevronRight className="h-4 w-4 text-stone-600 dark:text-stone-300" />} onClick={handleNextMonth} aria-label="翌月"><></></Button>
            {!isCurrentMonthShown && (
              <Button variant="tertiary" size="sm" onClick={() => setCurrentDate(new Date())} className="hidden lg:inline-flex">
                今月へ
              </Button>
            )}
            <div className="hidden flex-1 lg:block" />
            <Button
              variant="warning"
              size="md"
              iconLeft={<Download className="h-4 w-4" />}
              onClick={handleDownloadCsv}
              className="hidden lg:inline-flex"
            >
              CSV 出力
            </Button>
          </div>

          {canSwitchUser && currentStore != null && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-stone-500 dark:text-stone-300">対象メンバー</label>
              <select value={effectiveUserId ?? ''} onChange={(e) => setSelectedUserId(e.target.value || null)}
                className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100">
                {myUserId && <option value={myUserId}>自分</option>}
                {members.filter(m => m.user_id !== myUserId).map(m => (
                  <option key={m.user_id} value={m.user_id}>{m.display_name}</option>
                ))}
              </select>
              {!isCurrentMonthShown && (
                <Button variant="tertiary" size="sm" onClick={() => setCurrentDate(new Date())} className="lg:hidden">
                  今月へ
                </Button>
              )}
            </div>
          )}

          <div className="flex gap-1.5 lg:gap-3">
            <Card padding="md" className="flex-1 p-2 lg:p-4">
              <div className="text-[10px] text-stone-500 dark:text-stone-300 lg:text-[11px]">勤務日数</div>
              <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-stone-900 dark:text-stone-100 lg:text-2xl">
                {monthlySummary.workDays}<span className="ml-1 text-[10px] font-medium text-stone-500 dark:text-stone-300 lg:text-[11px]">日</span>
              </div>
            </Card>
            <Card padding="md" className="flex-1 p-2 lg:p-4">
              <div className="text-[10px] text-stone-500 dark:text-stone-300 lg:text-[11px]">勤務時間</div>
              <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-stone-900 dark:text-stone-100 lg:text-2xl">
                {formatWorkHoursDecimal(monthlySummary.totalWorkMinutes)}<span className="ml-1 text-[10px] font-medium text-stone-500 dark:text-stone-300 lg:text-[11px]">h</span>
              </div>
            </Card>
            <Card padding="md" className="flex-1 p-2 lg:p-4">
              <div className="text-[10px] text-stone-500 dark:text-stone-300 lg:text-[11px]">修正申請</div>
              <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-orange-700 dark:text-orange-300 lg:text-2xl">
                {pendingCorrectionCount}<span className="ml-1 text-[10px] font-medium text-stone-500 dark:text-stone-300 lg:text-[11px]">件<span className="hidden lg:inline"> pending</span></span>
              </div>
            </Card>
          </div>

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
          ) : viewMode === 'list' ? (
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
              <HistoryCalendar
                year={year}
                month={month}
                records={monthlyRecords}
                correctionRequests={ownCorrectionRequests}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
              />
              {showEmpty && (
                <EmptyState
                  size="sm"
                  title={messages.empty.historyMonth.title}
                />
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-3.5">
          <SelectedDayDetail
            date={selectedDate}
            record={selectedRecord}
            pending={selectedDatePending}
            onRequestCorrection={handleCorrection}
          />
          <MonthlyBarChart
            year={year}
            month={month}
            records={monthlyRecords}
            selectedDate={selectedDate}
            onBarClick={(date) => setSelectedDate(prev => prev === date ? null : date)}
          />
          <div className="lg:hidden">
            <Button
              variant="warning"
              size="md"
              iconLeft={<Download className="h-4 w-4" />}
              onClick={handleDownloadCsv}
              fullWidth
            >
              CSV 出力
            </Button>
          </div>
        </div>
      </div>

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
