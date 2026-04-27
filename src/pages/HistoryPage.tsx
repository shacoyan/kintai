import { useState, useEffect } from 'react';
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
import { Button, Card, Badge, ListRowSkeleton, EmptyState, Skeleton, HistorySkeleton } from '../components/ui';

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
  correctionRequests?: CorrectionRequest[];
}

function HistoryCalendar({ year, month, records, onRequestCorrection, correctionRequests }: HistoryCalendarProps) {
  const pendingDateSet = new Set(
    (correctionRequests ?? []).filter(r => r.status === 'pending').map(r => r.date)
  );
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
                  className={`relative w-full min-h-[56px] p-1 text-left border-b border-r border-neutral-100 dark:border-neutral-700 motion-safe:transition-colors ${
                    !isCurrentMonth
                      ? 'bg-neutral-50 dark:bg-neutral-900/30 cursor-default'
                      : isFuture
                      ? 'cursor-default'
                      : isSelected
                      ? 'bg-primary-50 dark:bg-primary-900/20'
                      : 'hover:bg-neutral-50 dark:hover:bg-neutral-700/50'
                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500`}
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

                  {isCurrentMonth && pendingDateSet.has(dateKey) && (
                    <span
                      className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500"
                      aria-label="修正申請中"
                    />
                  )}
                </button>

                {isSelected && isCurrentMonth && !isFuture && (
                  <div className="col-span-7 bg-primary-50 dark:bg-primary-900/20 border-b border-primary-200 dark:border-primary-800 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300 space-y-1">
                    <p className="font-semibold text-primary-700 dark:text-primary-300">{dateKey}</p>
                    {record?.clock_in && <p>出勤: {format(parseISO(record.clock_in), 'HH:mm')}</p>}
                    {record?.clock_out && <p>退勤: {format(parseISO(record.clock_out), 'HH:mm')}</p>}
                    {record && workMins > 0 && <p>勤務時間: {formatWorkHours(workMins)}</p>}
                    {!record && <p className="text-neutral-500 dark:text-neutral-400">記録なし</p>}
                    {onRequestCorrection && (
                      <div className="pt-1">
                        <button onClick={(e) => { e.stopPropagation(); onRequestCorrection?.(dateKey, record ?? undefined); }}
                          className="text-xs text-primary-700 dark:text-primary-300 underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                          この日を修正申請する
                        </button>
                      </div>
                    )}
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
      showToast(correctionModal.mode === 'delete' ? '削除依頼を送信しました' : '修正申請を送信しました', 'success');
    }
  }

  const hasRecords = monthlyRecords.length > 0;
  const showEmpty = !loading && !hasRecords && currentStore != null;
  
  const handleCorrection = effectiveUserId === myUserId ? handleRequestCorrection : undefined;
  const handleDeletion = effectiveUserId === myUserId ? handleRequestDeletion : undefined;

  const isCurrentMonthShown = (() => {
    const now = new Date();
    return now.getFullYear() === year && now.getMonth() + 1 === month;
  })();

  // 初回ロード時 (loading かつ初期データ未取得) はページ全体スケルトン
  if (loading && !hasRecords && currentStore != null) {
    return (
      <div className="max-w-2xl mx-auto">
        <HistorySkeleton />
      </div>
    );
  }

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
          <Button variant="tertiary" size="md" iconLeft={<ChevronLeft className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />} onClick={handlePrevMonth} aria-label="前月"><></></Button>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
              {format(currentDate, 'yyyy年M月', { locale: ja })}
            </h2>
            {!isCurrentMonthShown && (
              <Button variant="tertiary" size="sm" onClick={() => setCurrentDate(new Date())}>
                今月へ
              </Button>
            )}
            <button onClick={handleDownloadCsv} className="px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600">CSV ダウンロード</button>
          </div>
          <Button variant="tertiary" size="md" iconLeft={<ChevronRight className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />} onClick={handleNextMonth} aria-label="翌月"><></></Button>
        </div>

        <div className="flex justify-center mt-2">
          <div className="inline-flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-700 rounded-md">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 text-sm rounded-md motion-safe:transition-colors ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-neutral-600 shadow-xs text-primary-700 dark:text-primary-300'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500`}
            >
              リスト
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1 text-sm rounded-md motion-safe:transition-colors ${
                viewMode === 'calendar'
                  ? 'bg-white dark:bg-neutral-600 shadow-xs text-primary-700 dark:text-primary-300'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500`}
            >
              カレンダー
            </button>
          </div>
        </div>

        {canSwitchUser && currentStore != null && (
          <div className="flex items-center gap-2 pt-2 justify-center">
            <label className="text-sm text-neutral-500 dark:text-neutral-400">対象メンバー:</label>
            <select value={effectiveUserId ?? ''} onChange={(e) => setSelectedUserId(e.target.value || null)}
              className="px-2 py-1 text-sm border rounded bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100">
              {myUserId && <option value={myUserId}>自分</option>}
              {members.filter(m => m.user_id !== myUserId).map(m => (
                <option key={m.user_id} value={m.user_id}>{m.display_name}</option>
              ))}
            </select>
          </div>
        )}
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
              onRequestCorrection={handleCorrection}
              correctionRequests={ownCorrectionRequests}
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
