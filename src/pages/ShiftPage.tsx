import { useState, useEffect, useCallback, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, addWeeks, addMonths } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Clock, History, Plus, ChevronRight, AlertTriangle, CalendarPlus, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Badge, BottomSheet, ShiftSkeleton, EmptyState, Heading } from '../components/ui';
import { messages } from '../lib/messages';
import { getPreferenceTheme } from '../lib/preferenceTheme';
import { Spinner } from '../components/ui/Spinner';
import type { BadgeTone } from '../components/ui';
import { useTenant } from '../hooks/useTenant';
import { useShift } from '../hooks/useShift';
import { useLeave } from '../hooks/useLeave';
import { useTenantAdmin } from '../hooks/useTenantAdmin';
import { useShiftPreset } from '../hooks/useShiftPreset';
import { useShiftPreference } from '../hooks/useShiftPreference';
import { useShiftSubmissionDeadline } from '../hooks/useShiftSubmissionDeadline';
import { ShiftCalendar } from '../components/Shift/ShiftCalendar';
import { ShiftEditModal } from '../components/Shift/ShiftEditModal';
import { ShiftAdminPanel } from '../components/Shift/ShiftAdminPanel';
import { LaborCostSummary } from '../components/Shift/LaborCostSummary';
import { LeaveForm } from '../components/Leave/LeaveForm';
import { LeaveList } from '../components/Leave/LeaveList';
import { RejectLeaveModal } from '../components/Leave/RejectLeaveModal';
import { ShiftPreferenceCalendar } from '../components/Shift/ShiftPreferenceCalendar';
import { ShiftPreferenceForm } from '../components/Shift/ShiftPreferenceForm';
import { ShiftPreferenceAdminList } from '../components/Shift/ShiftPreferenceAdminList';
import { ShiftPreferenceSidebar } from '../components/Shift/ShiftPreferenceSidebar';
import { BulkApplyPresetModal } from '../components/Shift/BulkApplyPresetModal';
import { BulkShiftPreferenceDialog } from '../components/Shift/BulkShiftPreferenceDialog';
import { PreferenceActionRow } from '../components/Shift/PreferenceActionRow';
import { formatTimeRange } from '../utils/formatTimeRange';
import { useStoreContext } from '../contexts/StoreContext';
import { useToast } from '../contexts/ToastContext';
import type { ShiftPreferenceType, LeaveType, BulkSubmitPreferenceArgs } from '../types';

type TabId = 'shift' | 'leave' | 'preference';
type PreferenceView = 'current' | 'history';

export function ShiftPage() {
  const { currentTenant, myRole, isOwner } = useTenant();
  const tenantId = currentTenant?.id || '';
  const canManageTenant = myRole === 'owner' || myRole === 'manager';
  const { currentStore, stores, isManagerOf } = useStoreContext();
  const storeId = currentStore?.id ?? null;

  const { myShifts, allShifts, loading: shiftLoading, getMyShifts, getAllShifts, deleteShift, approveShift, rejectShift, modifyShift, bulkApprove, getLaborCostEstimate } = useShift(tenantId, storeId);
  const { myLeaves, allLeaves, loading: leaveLoading, getMyLeaves, getAllLeaves, submitLeave, cancelLeave, approveLeave, rejectLeave, getRemainingPaidLeave } = useLeave(tenantId);
  const { members, fetchMembers } = useTenantAdmin(tenantId);
  const { presets, fetchPresets } = useShiftPreset(tenantId, storeId);
  const { myPreferences, allPreferences, loading: prefLoading, fetchMyPreferences, fetchAllPreferences, submitPreference, deletePreference, approvePreference, rejectPreference, revertPreference, bulkSubmitPreferences } = useShiftPreference(tenantId, storeId);
  const { showToast } = useToast();

  const [searchParams, setSearchParams] = useSearchParams();
  const initialActiveTab = useMemo<TabId>(() => {
    const t = searchParams.get('tab');
    return (t === 'shift' || t === 'preference' || t === 'leave') ? t : 'shift';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [activeTab, setActiveTabState] = useState<TabId>(initialActiveTab);
  const setActiveTab = useCallback((tab: TabId) => {
    setActiveTabState(tab);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const [selectedShift, setSelectedShift] = useState<import('../types').Shift | null>(null);
  const [selectedShiftDate, setSelectedShiftDate] = useState<string | null>(null);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [remainingPaidLeave, setRemainingPaidLeave] = useState<number>(0);
  const [rejectingLeaveId, setRejectingLeaveId] = useState<string | null>(null);
  const [approveLeaveConfirm, setApproveLeaveConfirm] = useState<{ leaveId: string; userId: string } | null>(null);
  const [selectedPrefDate, setSelectedPrefDate] = useState<string | null>(null);
  const [showAllMembersPrefs, setShowAllMembersPrefs] = useState(false);
  const [preferenceView, setPreferenceView] = useState<PreferenceView>('current');
  const initialShiftMonth = useMemo(() => {
    const monthParam = searchParams.get('month');
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split('-').map(Number);
      if (y && m && m >= 1 && m <= 12) return new Date(y, m - 1, 1);
    }
    return new Date();
  }, []); // 初回のみ
  const [shiftViewMonth, setShiftViewMonth] = useState<Date>(initialShiftMonth);

  useEffect(() => {
    const ym = format(shiftViewMonth, 'yyyy-MM');
    if (searchParams.get('month') !== ym) {
      // 規律: setSearchParams は functional updater 形式で prev を複製してから set すること。
      // オブジェクトリテラル直接渡し (setSearchParams({ key: value })) は他クエリを破壊するため禁止。
      // 詳細: .company/engineering/docs/2026-04-28-kintai-loop15-techdesign.md L15-2 セクション参照
      // (Loop 14 Phase 2 L14-6 で確立した規律 + Track C で functional updater 化)
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('month', ym);
        return next;
      }, { replace: true });
    }
  }, [shiftViewMonth, searchParams, setSearchParams]);
  const [allMemberPrefDate, setAllMemberPrefDate] = useState<string | null>(null);
  const [showBulkApplyModal, setShowBulkApplyModal] = useState(false);

  // 一括シフト申請 (Engineer C / §4): 選択モード on/off, 選択 Set, ダイアログ表示
  const [isBulkMode, setIsBulkMode] = useState<boolean>(false);
  const [selectedBulkDates, setSelectedBulkDates] = useState<Set<string>>(() => new Set());
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState<boolean>(false);
  const BULK_MAX_DATES = 31;

  const pendingPreferenceCount = useMemo(
    () => allPreferences.filter(p => p.status === 'pending').length,
    [allPreferences]
  );

  const preferencesForCalendar = useMemo(() => {
    if (canManageTenant && showAllMembersPrefs) return allPreferences;
    return myPreferences.filter(p => p.status !== 'rejected');
  }, [canManageTenant, showAllMembersPrefs, allPreferences, myPreferences]);

  const preferencesForAdminList = useMemo(() => {
    if (preferenceView === 'current') {
      return allPreferences.filter(p => p.status !== 'rejected');
    }
    return [...allPreferences].sort((a, b) => b.date.localeCompare(a.date));
  }, [preferenceView, allPreferences]);

  const myPreferencesForHistory = useMemo(
    () => [...myPreferences].sort((a, b) => b.date.localeCompare(a.date)),
    [myPreferences]
  );

  const preferenceSummary = useMemo<Record<ShiftPreferenceType, number>>(() => {
    const active = myPreferences.filter((p) => p.status !== 'rejected');
    return {
      preferred: active.filter((p) => p.preference_type === 'preferred').length,
      unavailable: active.filter((p) => p.preference_type === 'unavailable').length,
    };
  }, [myPreferences]);

  const adminSummary = useMemo<{ counts: Record<ShiftPreferenceType, number>; monthLabel: string }>(() => {
    const now = new Date();
    const ym = format(now, 'yyyy-MM');
    const monthPrefs = allPreferences.filter(p => p.date.startsWith(ym));
    return {
      counts: {
        preferred: monthPrefs.filter(p => p.preference_type === 'preferred').length,
        unavailable: monthPrefs.filter(p => p.preference_type === 'unavailable').length,
      },
      monthLabel: format(now, 'yyyy年M月'),
    };
  }, [allPreferences]);

  const adminListStores = useMemo(() => isOwner ? stores : stores.filter(s => isManagerOf(s.id)), [isOwner, stores, isManagerOf]);
  const storeNames = useMemo(() => new Map(stores.map(s => [s.id, s.name])), [stores]);

  const timedPreferences = useMemo(
    () =>
      myPreferences
        .filter(
          (p) =>
            p.status !== 'rejected' &&
            p.preference_type !== 'unavailable' &&
            !!p.start_time &&
            !!p.end_time,
        )
        .sort((a, b) => a.date.localeCompare(b.date)),
    [myPreferences],
  );

  const fetchRange = useCallback(() => {
    const now = new Date();
    const start = format(startOfMonth(addWeeks(now, -2)), 'yyyy-MM-dd');
    const end = format(endOfMonth(addWeeks(now, 4)), 'yyyy-MM-dd');
    if (canManageTenant) {
      getAllShifts(start, end);
      getAllLeaves(start, end);
      fetchMembers();
    } else {
      getMyShifts(start, end);
      getMyLeaves(start, end);
    }
  }, [canManageTenant, getAllShifts, getAllLeaves, getMyShifts, getMyLeaves, fetchMembers]);

  const fetchPreferenceRange = useCallback(() => {
    const now = new Date();
    const start = format(startOfMonth(now), 'yyyy-MM-dd');
    const end = format(endOfMonth(addWeeks(now, 4)), 'yyyy-MM-dd');
    if (canManageTenant) {
      void fetchAllPreferences(start, end);
      void fetchMyPreferences(start, end);
    } else {
      void fetchMyPreferences(start, end);
    }
  }, [canManageTenant, fetchAllPreferences, fetchMyPreferences]);

  useEffect(() => {
    if (tenantId) {
      fetchRange();
      fetchPresets();
    }
  }, [tenantId, fetchRange, fetchPresets]);

  useEffect(() => {
    if (tenantId && activeTab === 'preference') {
      fetchPreferenceRange();
    }
  }, [tenantId, activeTab, fetchPreferenceRange]);

  const shifts = canManageTenant ? allShifts : myShifts;
  const leaves = canManageTenant ? allLeaves : myLeaves;

  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach(m => map.set(m.user_id, m.display_name ?? '不明'));
    return map;
  }, [members]);

  const targetMonth = useMemo(() => startOfMonth(addMonths(new Date(), 1)), []);
  const { deadline, canEdit: canEditDeadline } = useShiftSubmissionDeadline(targetMonth);
  const isDeadlinePassed = useMemo(() => {
    if (!storeId || !deadline) return false;
    return deadline < new Date();
  }, [storeId, deadline]);
  const deadlineInfo = useMemo(() => {
    if (!storeId) return null;
    if (!deadline) return null;
    if (deadline < new Date()) {
      // 締切後: 残時間ラベルなしで passed=true を返す
      return { deadline, targetMonth, remainingLabel: '', passed: true as const };
    }
    const ms = deadline.getTime() - Date.now();
    const days = Math.floor(ms / (24 * 3600 * 1000));
    const hours = Math.floor((ms % (24 * 3600 * 1000)) / (3600 * 1000));
    const remainingLabel = days > 0 ? `${days}日${hours}時間` : `${hours}時間`;
    return { deadline, targetMonth, remainingLabel, passed: false as const };
  }, [storeId, deadline, targetMonth]);

  const handleLeaveSubmit = async (
    dates: string[],
    leaveType: LeaveType,
    reason?: string,
  ) => {
    const result = await submitLeave(dates, leaveType, reason, currentStore?.id ?? null);
    if (result.failedDates.length > 0) {
      const msg = result.successCount > 0
        ? `${result.successCount}件 申請しました。${result.failedDates.length}件 失敗（${result.failedDates.join(', ')}）`
        : `休暇申請に失敗しました（${result.failedDates.join(', ')}）`;
      throw new Error(msg);
    }
    setShowLeaveForm(false);
    fetchRange();
    if (tenantId) {
      try {
        const remaining = await getRemainingPaidLeave();
        setRemainingPaidLeave(remaining);
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    if (!tenantId || canManageTenant) return;
    let cancelled = false;
    (async () => {
      try {
        const remaining = await getRemainingPaidLeave();
        if (!cancelled) setRemainingPaidLeave(remaining);
      } catch {
        // ignore: 残日数取得失敗時は0表示のまま
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId, canManageTenant, getRemainingPaidLeave]);

  const handleApproveLeaveWrapped = async (leaveId: string) => {
    const leave = leaves.find(l => l.id === leaveId);
    if (!leave) return;
    if (leave.leave_type === 'paid' || leave.leave_type === 'half_am' || leave.leave_type === 'half_pm') {
      const remaining = await getRemainingPaidLeave(leave.user_id);
      const required = leave.leave_type === 'paid' ? 1 : 0.5;
      if (remaining < required) {
        setApproveLeaveConfirm({ leaveId, userId: leave.user_id });
        return;
      }
    }
    await approveLeave(leaveId);
  };
  const handleConfirmApproveLeave = async () => {
    if (!approveLeaveConfirm) return;
    await approveLeave(approveLeaveConfirm.leaveId);
    setApproveLeaveConfirm(null);
    fetchRange();
  };
  const handleRejectLeaveSubmit = async (note: string) => {
    if (!rejectingLeaveId) return;
    await rejectLeave(rejectingLeaveId, note);
    fetchRange();
  };

  const handlePrefSubmit = async (
    date: string,
    type: ShiftPreferenceType,
    startTime?: string,
    endTime?: string,
    note?: string,
    storeIdOverride?: string,
  ) => {
    await submitPreference(date, type, startTime, endTime, note, storeIdOverride);
    setSelectedPrefDate(null);
    fetchPreferenceRange();
  };

  const handlePrefDelete = async (id: string) => {
    await deletePreference(id);
    setSelectedPrefDate(null);
    fetchPreferenceRange();
  };

  const handleApprovePreference = async (id: string, startTime?: string, endTime?: string) => {
    await approvePreference(id, startTime, endTime);
    fetchPreferenceRange();
    fetchRange();
  };

  const handleRejectPreference = async (id: string) => {
    await rejectPreference(id);
    fetchPreferenceRange();
  };

  const handleRevertPreference = async (id: string) => {
    await revertPreference(id);
    fetchPreferenceRange();
    fetchRange();
  };

  // 一括選択モードの自動 OFF (§4.1 + P2-INT-2):
  //   preference タブ外 / 管理者一覧 / storeId null / preferenceView !== 'current'
  useEffect(() => {
    const shouldDisable =
      activeTab !== 'preference' ||
      (canManageTenant && showAllMembersPrefs) ||
      !storeId ||
      preferenceView !== 'current';
    if (shouldDisable) {
      setIsBulkMode((prev) => (prev ? false : prev));
      setSelectedBulkDates((prev) => (prev.size > 0 ? new Set() : prev));
      setIsBulkDialogOpen((prev) => (prev ? false : prev));
    }
  }, [activeTab, canManageTenant, showAllMembersPrefs, storeId, preferenceView]);

  // 選択モード OFF 遷移時に Set クリア (§4.1)
  useEffect(() => {
    if (!isBulkMode) {
      setSelectedBulkDates((prev) => (prev.size > 0 ? new Set() : prev));
    }
  }, [isBulkMode]);

  // 既存申請のある日付集合 (§6.4): ダイアログの上書き警告に利用
  const existingBulkPreferenceDates = useMemo(() => {
    const set = new Set<string>();
    for (const p of myPreferences) {
      if (selectedBulkDates.has(p.date) && p.store_id === storeId) {
        set.add(p.date);
      }
    }
    return set;
  }, [myPreferences, selectedBulkDates, storeId]);

  // ロック済み (approved & preferred) の日付集合 (P1-INT-1):
  // Dialog のロック警告 (lockedDates) に配線。
  const lockedBulkDates = useMemo(
    () =>
      new Set(
        myPreferences
          .filter(
            (p) =>
              selectedBulkDates.has(p.date) &&
              p.store_id === storeId &&
              p.status === 'approved' &&
              p.preference_type === 'preferred',
          )
          .map((p) => p.date),
      ),
    [myPreferences, selectedBulkDates, storeId],
  );

  const sortedSelectedBulkDates = useMemo(
    () => Array.from(selectedBulkDates).sort(),
    [selectedBulkDates],
  );

  const handleToggleBulkDate = useCallback(
    (date: string) => {
      setSelectedBulkDates((prev) => {
        const next = new Set(prev);
        if (next.has(date)) {
          next.delete(date);
          return next;
        }
        if (next.size >= BULK_MAX_DATES) {
          showToast(messages.shiftPreference.bulk.maxSelectionExceeded(BULK_MAX_DATES), { tone: 'warning' });
          return prev;
        }
        next.add(date);
        return next;
      });
    },
    [showToast],
  );

  const handleEnterBulkMode = useCallback(() => {
    setIsBulkMode(true);
  }, []);

  const handleCancelBulkMode = useCallback(() => {
    setIsBulkMode(false);
    setSelectedBulkDates(() => new Set());
    setIsBulkDialogOpen(false);
  }, []);

  const handleClearAllBulkDates = useCallback(() => {
    setSelectedBulkDates(() => new Set());
  }, []);

  const handleProceedBulkDialog = useCallback(() => {
    setSelectedBulkDates((prev) => {
      if (prev.size === 0) return prev;
      setIsBulkDialogOpen(true);
      return prev;
    });
  }, []);

  const handleBulkPreferenceSubmit = useCallback(
    async (args: BulkSubmitPreferenceArgs) => {
      const result = await bulkSubmitPreferences(args);
      setIsBulkDialogOpen(false);
      setIsBulkMode(false);
      setSelectedBulkDates(() => new Set());
      await fetchPreferenceRange();

      const successCount = result.successCount;
      const failedCount = result.failedDates.length + (result.lockedDates?.length ?? 0);
      if (failedCount === 0) {
        showToast(
          messages.shiftPreference.bulk.successToast(successCount),
          'success',
        );
      } else if (successCount > 0) {
        showToast(
          messages.shiftPreference.bulk.partialFailureToast(successCount, failedCount),
          { tone: 'warning' },
        );
      } else {
        showToast(messages.shiftPreference.bulk.failureToast, 'error');
      }
      return result;
    },
    [bulkSubmitPreferences, fetchPreferenceRange, showToast],
  );

  const handleBulkApprovePreferences = async (ids: string[]) => {
    let errors = 0;
    for (const id of ids) {
      const pref = allPreferences.find(p => p.id === id);
      if (!pref) continue;
      if (pref.preference_type === 'unavailable') continue;
      try {
        await approvePreference(id, pref.start_time ?? undefined, pref.end_time ?? undefined);
      } catch {
        errors += 1;
      }
    }
    fetchPreferenceRange();
    fetchRange();
    if (errors > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[bulkApprovePreferences] ${errors} 件で承認エラーが発生しました`);
    }
  };

  const handleBulkRejectPreferences = async (ids: string[]) => {
    let errors = 0;
    for (const id of ids) {
      try {
        await rejectPreference(id);
      } catch {
        errors += 1;
      }
    }
    fetchPreferenceRange();
    if (errors > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[bulkRejectPreferences] ${errors} 件で却下エラーが発生しました`);
    }
  };

  const laborEstimates = useMemo(() => {
    if (!canManageTenant || members.length === 0) return [];
    const monthStart = format(startOfMonth(shiftViewMonth), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(shiftViewMonth), 'yyyy-MM-dd');
    const monthShifts = shifts.filter(s => s.date >= monthStart && s.date <= monthEnd);
    return getLaborCostEstimate(monthShifts, members);
  }, [canManageTenant, shifts, members, getLaborCostEstimate, shiftViewMonth]);

  const pendingShifts = shifts.filter(s => s.status === 'pending');

  const allMemberPrefsForDate = useMemo(
    () => allPreferences.filter(p => p.date === allMemberPrefDate),
    [allPreferences, allMemberPrefDate]
  );

  if (!tenantId) return null;

  if (!storeId) {
    return (
      <div className="p-6">
        <Card padding="md">
          <Card.Body className="text-center text-sm text-neutral-700 dark:text-neutral-300">
            店舗を選択してください。ヘッダーの店舗セレクターから操作対象の店舗を選ぶと、シフト・シフト申請が表示されます。
          </Card.Body>
        </Card>
      </div>
    );
  }

  // 初回ロード時 (各 hook の loading かつ初期データ未取得) はページ全体スケルトン
  const initialLoading =
    (shiftLoading || leaveLoading || prefLoading) &&
    myShifts.length === 0 &&
    allShifts.length === 0 &&
    myLeaves.length === 0 &&
    allLeaves.length === 0 &&
    myPreferences.length === 0 &&
    allPreferences.length === 0;
  if (initialLoading) {
    return (
      <div className="max-w-5xl mx-auto">
        <ShiftSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-neutral-200 dark:border-neutral-700">
        <nav className="flex space-x-8">
          {([
            { id: 'shift' as TabId, label: 'シフト' },
            // hidden 2026-05-10: backlog で復活予定
            // { id: 'leave' as TabId, label: '休暇' },
            { id: 'preference' as TabId, label: 'シフト申請' },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap py-4 px-2 border-b-2 font-medium text-sm motion-safe:transition-colors duration-120 ease-out-expo ${
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                  : 'border-transparent text-neutral-500 dark:text-neutral-300 hover:text-neutral-700 dark:hover:text-neutral-200 hover:border-neutral-300 dark:hover:border-neutral-600'
              }`}
            >
              {tab.label}
              {tab.id === 'shift' && canManageTenant && pendingShifts.length > 0 && (
                <Badge tone="warning" className="ml-2">{pendingShifts.length}</Badge>
              )}
              {tab.id === 'preference' && canManageTenant && pendingPreferenceCount > 0 && (
                <Badge tone="warning" className="ml-2">{pendingPreferenceCount}</Badge>
              )}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'shift' && (
        <div className="space-y-6">
          <header className="flex items-end justify-between gap-3">
            <div>
              <Heading level={2}>シフト</Heading>
              <p className="text-sm text-neutral-500 dark:text-neutral-300 tabular-nums">{format(shiftViewMonth, 'yyyy年M月', { locale: ja })}</p>
            </div>
            {canManageTenant && pendingShifts.length > 0 && (
              <Badge tone="warning" withDot>{pendingShifts.length} 件 承認待ち</Badge>
            )}
          </header>

          {shiftLoading && (
            <div className="flex items-center justify-center py-6">
              <Spinner size="md" label="読み込み中" showLabel />
            </div>
          )}

          <ShiftCalendar
            shifts={shifts}
            onDateClick={(date) => setSelectedShiftDate(date)}
            onShiftClick={(shift) => setSelectedShift(shift)}
            leaves={leaves}
            memberNames={canManageTenant ? memberNames : undefined}
            onViewMonthChange={setShiftViewMonth}
          />

          {selectedShift && canManageTenant && (
            <ShiftEditModal
              shift={selectedShift}
              memberName={memberNames.get(selectedShift.user_id)}
              canManageTenant={canManageTenant}
              onModify={modifyShift}
              onDelete={deleteShift}
              onApprove={approveShift}
              onReject={rejectShift}
              onClose={() => setSelectedShift(null)}
              onRefresh={fetchRange}
              selectableStores={isOwner ? stores : stores.filter(s => isManagerOf(s.id))}
              storeName={stores.find(s => s.id === selectedShift.store_id)?.name}
              canManageStore={selectedShift.store_id ? isManagerOf(selectedShift.store_id) : false}
            />
          )}

          <BottomSheet
            isOpen={!!selectedShiftDate}
            onClose={() => setSelectedShiftDate(null)}
            title={selectedShiftDate ? `${selectedShiftDate} のシフト一覧` : ''}
          >
            <div className="space-y-2 p-4">
              {shifts.filter(s => s.date === selectedShiftDate).map(s => (
                <button 
                  key={s.id} 
                  onClick={() => { setSelectedShift(s); setSelectedShiftDate(null); }}
                  className="w-full text-left p-3 bg-neutral-50 dark:bg-neutral-800 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-700 motion-safe:transition-colors duration-120 ease-out-expo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400"
                >
                  <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{memberNames.get(s.user_id) ?? '不明'}</div>
                  <div className="text-xs text-neutral-600 dark:text-neutral-300">
                    {s.start_time && s.end_time ? formatTimeRange(s.start_time, s.end_time, { separator: '〜' }) : '--:--〜--:--'} / {s.status}
                  </div>
                </button>
              ))}
              {shifts.filter(s => s.date === selectedShiftDate).length === 0 && (
                <EmptyState
                  size="sm"
                  title={messages.empty.shiftDay.title}
                />
              )}
            </div>
          </BottomSheet>

          {canManageTenant && (
            <>
              <ShiftAdminPanel
                shifts={shifts.filter(s => s.status !== 'cancelled')}
                members={members}
                onApprove={approveShift}
                onReject={rejectShift}
                onModify={modifyShift}
                onBulkApprove={bulkApprove}
                onDelete={deleteShift}
                onRefresh={fetchRange}
                stores={isOwner ? stores : stores.filter(s => isManagerOf(s.id))}
                canManageStore={(sid) => sid ? isManagerOf(sid) : false}
              />

              <LaborCostSummary estimates={laborEstimates} targetMonth={shiftViewMonth} />
            </>
          )}
        </div>
      )}

      {activeTab === 'preference' && (
        <div className="flex flex-col gap-4 pb-24">
          {prefLoading && (
            <div className="flex items-center justify-center py-6">
              <Spinner size="md" label="読み込み中" showLabel />
            </div>
          )}

          {/* 表示切替: 現在 / 履歴 (両ビュー共通) */}
          <div className="inline-flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-md self-start">
            <button
              type="button"
              onClick={() => setPreferenceView('current')}
              aria-pressed={preferenceView === 'current'}
              className={`inline-flex items-center gap-2 px-3 h-9 text-xs font-semibold rounded motion-safe:transition-colors duration-120 ease-out-expo focus-ring ${
                preferenceView === 'current'
                  ? 'bg-white text-primary-700 shadow-xs dark:bg-neutral-700 dark:text-primary-300'
                  : 'bg-transparent text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              現在
            </button>
            <button
              type="button"
              onClick={() => setPreferenceView('history')}
              aria-pressed={preferenceView === 'history'}
              className={`inline-flex items-center gap-2 px-3 h-9 text-xs font-semibold rounded motion-safe:transition-colors duration-120 ease-out-expo focus-ring ${
                preferenceView === 'history'
                  ? 'bg-white text-primary-700 shadow-xs dark:bg-neutral-700 dark:text-primary-300'
                  : 'bg-transparent text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              履歴
            </button>
          </div>

          {preferenceView === 'current' && (
            <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-6 lg:items-start">
              <div className="flex flex-col gap-4">
                {deadlineInfo && !deadlineInfo.passed && (
                  <Card padding="md" role="status" aria-live="polite" className="border-l-4 border-warning-500 dark:border-warning-400 bg-warning-50 dark:bg-warning-900/30">
                    <Card.Body className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-warning-600 dark:text-warning-400 mt-0.5 shrink-0" aria-hidden="true" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-warning-800 dark:text-warning-200">
                          シフト申請の提出締切: {format(deadlineInfo.deadline, 'M月d日(E) HH:mm', { locale: ja })}
                        </p>
                        <p className="text-xs text-warning-700 dark:text-warning-300 mt-1 tabular-nums">
                          残り {deadlineInfo.remainingLabel}（{format(deadlineInfo.targetMonth, 'yyyy年M月', { locale: ja })} 分）
                        </p>
                      </div>
                    </Card.Body>
                  </Card>
                )}
                {deadlineInfo && deadlineInfo.passed && (
                  <Card padding="md" role="status" aria-live="polite" className="border-l-4 border-danger-500 dark:border-danger-400 bg-danger-50 dark:bg-danger-900/30">
                    <Card.Body className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-danger-600 dark:text-danger-400 mt-0.5 shrink-0" aria-hidden="true" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-danger-800 dark:text-danger-200">
                          締切過ぎ — 提出には管理者承認が必要です
                        </p>
                        <p className="text-xs text-danger-700 dark:text-danger-300 mt-1 tabular-nums">
                          {format(deadlineInfo.deadline, 'M月d日(E) HH:mm', { locale: ja })} に締め切られました（{format(deadlineInfo.targetMonth, 'yyyy年M月', { locale: ja })} 分）
                        </p>
                      </div>
                    </Card.Body>
                  </Card>
                )}

                {canManageTenant && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-300 tracking-wider">カレンダー表示:</span>
                    <button
                      type="button"
                      onClick={() => setShowAllMembersPrefs(false)}
                      aria-pressed={!showAllMembersPrefs}
                      className={`px-3 h-8 text-xs font-semibold rounded-md motion-safe:transition-colors duration-120 ease-out-expo focus-ring ${
                        !showAllMembersPrefs
                          ? 'bg-primary-600 text-white'
                          : 'bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700'
                      }`}
                    >
                      自分のシフト申請
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAllMembersPrefs(true)}
                      aria-pressed={showAllMembersPrefs}
                      className={`px-3 h-8 text-xs font-semibold rounded-md motion-safe:transition-colors duration-120 ease-out-expo focus-ring ${
                        showAllMembersPrefs
                          ? 'bg-primary-600 text-white'
                          : 'bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700'
                      }`}
                    >
                      全員のシフト申請
                    </button>
                    {storeId && (
                      <button
                        type="button"
                        onClick={() => setShowBulkApplyModal(true)}
                        className="px-3 h-8 text-xs font-semibold rounded-md motion-safe:transition-colors duration-120 ease-out-expo focus-ring bg-white dark:bg-neutral-800 border border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/30"
                      >
                        プリセット一括適用
                      </button>
                    )}
                  </div>
                )}

                {/* 一括シフト申請 — エントリー / 選択モード操作 UI (§5.1 / §5.5)
                    self view (= !showAllMembersPrefs) かつ storeId 有り の時のみ表示 */}
                {!(canManageTenant && showAllMembersPrefs) && storeId && (
                  isBulkMode ? (
                    <div
                      role="region"
                      aria-label="一括シフト申請 選択モード"
                      className="flex items-center justify-between gap-2 flex-wrap rounded-md border border-info-200 dark:border-info-700 bg-info-50 dark:bg-info-900/30 px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-info-700 dark:text-info-200 tabular-nums">
                          {messages.shiftPreference.bulk.selectedCount(selectedBulkDates.size)}
                        </span>
                        {selectedBulkDates.size > 0 && (
                          <button
                            type="button"
                            onClick={handleClearAllBulkDates}
                            className="text-xs font-semibold text-info-700 dark:text-info-300 hover:underline focus-ring"
                          >
                            {messages.shiftPreference.bulk.clearAll}
                          </button>
                        )}
                      </div>
                      <div className="hidden md:flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          iconLeft={<X className="w-4 h-4" />}
                          onClick={handleCancelBulkMode}
                        >
                          {messages.shiftPreference.bulk.cancelMode}
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={handleProceedBulkDialog}
                          disabled={selectedBulkDates.size === 0}
                        >
                          {messages.shiftPreference.bulk.proceedButton(selectedBulkDates.size)}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        variant="secondary"
                        size="sm"
                        iconLeft={<CalendarPlus className="w-4 h-4" />}
                        onClick={handleEnterBulkMode}
                        disabled={isDeadlinePassed && !canEditDeadline}
                        aria-pressed={isBulkMode}
                        aria-label={messages.shiftPreference.bulk.entryButtonAria}
                      >
                        {messages.shiftPreference.bulk.entryButton}
                      </Button>
                    </div>
                  )
                )}

                <ShiftPreferenceCalendar
                  preferences={preferencesForCalendar}
                  onDateClick={(date) => {
                    if (canManageTenant && showAllMembersPrefs) {
                      setAllMemberPrefDate(date);
                    } else {
                      setSelectedPrefDate(date);
                    }
                  }}
                  memberNames={canManageTenant && showAllMembersPrefs ? memberNames : undefined}
                  canManageTenant={canManageTenant && showAllMembersPrefs}
                  onApprovePreference={canManageTenant && showAllMembersPrefs ? handleApprovePreference : undefined}
                  onRejectPreference={canManageTenant && showAllMembersPrefs ? handleRejectPreference : undefined}
                  canManageStore={(sid) => sid ? isManagerOf(sid) : false}
                  onMutated={fetchPreferenceRange}
                  bulkSelectionMode={isBulkMode && !(canManageTenant && showAllMembersPrefs)}
                  selectedDates={selectedBulkDates}
                  onToggleBulkDate={handleToggleBulkDate}
                />

                {/* 提出予定サマリ（自分視点のみ） */}
                {!(canManageTenant && showAllMembersPrefs) && (
                  <div className="lg:hidden">
                    <Card padding="md">
                      <Card.Body className="grid grid-cols-2 gap-3 text-center">
                        <div>
                          <p className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">
                            {preferenceSummary.preferred}
                          </p>
                          <p className="text-[11px] text-neutral-500 dark:text-neutral-300 mt-0.5">申請日</p>
                        </div>
                        <div className="border-l border-neutral-100 dark:border-neutral-700">
                          <p className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">
                            {preferenceSummary.unavailable}
                          </p>
                          <p className="text-[11px] text-neutral-500 dark:text-neutral-300 mt-0.5">出勤不可</p>
                        </div>
                      </Card.Body>
                    </Card>
                  </div>
                )}

                {/* 時間指定の詳細リスト */}
                {!(canManageTenant && showAllMembersPrefs) && timedPreferences.length > 0 && (
                  <div className="lg:hidden">
                    <Card padding="none">
                      <Card.Header className="border-b border-neutral-100 dark:border-neutral-700 mb-0 pb-3 px-4 pt-4 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                        時間指定の詳細
                      </Card.Header>
                      <ul className="divide-y divide-neutral-100 dark:divide-neutral-700">
                        {timedPreferences.map((p) => {
                          const theme = getPreferenceTheme(p.preference_type);
                          return (
                            <li key={p.id}>
                              <button
                                type="button"
                                onClick={() => setSelectedPrefDate(p.date)}
                                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-left focus-ring"
                              >
                                <div className={`w-10 h-10 rounded-md flex flex-col items-center justify-center shrink-0 ${theme.iconBoxClass}`}>
                                  <span className="text-[10px] font-semibold leading-none">{p.date.slice(5, 7)}/</span>
                                  <span className="text-[14px] font-bold tabular-nums leading-none">{p.date.slice(8, 10)}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{theme.label}</p>
                                  {p.start_time && p.end_time && (
                                    <p className="text-xs text-neutral-500 dark:text-neutral-300 tabular-nums">
                                      {formatTimeRange(p.start_time, p.end_time, { separator: ' - ' })}
                                    </p>
                                  )}
                                </div>
                                <ChevronRight className="w-4 h-4 text-neutral-400 dark:text-neutral-500" aria-hidden="true" />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </Card>
                  </div>
                )}

                <div className="lg:hidden">
                  <BottomSheet
                    isOpen={!!selectedPrefDate}
                    onClose={() => setSelectedPrefDate(null)}
                    title={selectedPrefDate ? `${selectedPrefDate} のシフト申請` : undefined}
                  >
                    {selectedPrefDate && (
                      <ShiftPreferenceForm
                        date={selectedPrefDate}
                        existingPreference={myPreferences.find((p) => p.date === selectedPrefDate && p.store_id === storeId) ?? myPreferences.find((p) => p.date === selectedPrefDate)}
                        onSubmit={handlePrefSubmit}
                        onDelete={handlePrefDelete}
                        onCancel={() => setSelectedPrefDate(null)}
                        presets={presets}
                        selectableStores={stores}
                        defaultStoreId={storeId}
                        isDeadlinePassed={isDeadlinePassed}
                        canBypassDeadline={canEditDeadline}
                      />
                    )}
                  </BottomSheet>

                  <BottomSheet
                    isOpen={!!allMemberPrefDate}
                    onClose={() => setAllMemberPrefDate(null)}
                    title={allMemberPrefDate ? `${allMemberPrefDate} のシフト申請一覧` : undefined}
                  >
                    <ul className="divide-y divide-neutral-100 dark:divide-neutral-700 p-2 space-y-2">
                      {allMemberPrefsForDate.length === 0 && (
                        <li>
                          <EmptyState
                            size="sm"
                            title={messages.empty.shiftPreferenceDay.title}
                          />
                        </li>
                      )}
                      {allMemberPrefsForDate.map(p => (
                        <li key={p.id}>
                          <PreferenceActionRow
                            preference={p}
                            memberName={memberNames.get(p.user_id)}
                            onApprove={handleApprovePreference}
                            onReject={handleRejectPreference}
                            canManage={p.store_id ? isManagerOf(p.store_id) : false}
                            variant="full"
                            onMutated={fetchPreferenceRange}
                            onRevert={handleRevertPreference}
                            storeName={adminListStores.find(s => s.id === p.store_id)?.name}
                            showStoreBadge={adminListStores.length >= 2}
                          />
                        </li>
                      ))}
                    </ul>
                  </BottomSheet>
                </div>

                {/* sticky 追加ボタン（自分視点のみ） — bulk モード中は「次へ / キャンセル」に差し替え (§5.5) */}
                {!(canManageTenant && showAllMembersPrefs) && (
                  <div className="lg:hidden sticky bottom-16 md:bottom-0 -mx-4 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] bg-white/95 dark:bg-neutral-900/95 backdrop-blur border-t border-neutral-200 dark:border-neutral-700 z-20">
                    {isBulkMode ? (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="lg"
                          onClick={handleCancelBulkMode}
                          iconLeft={<X className="w-4 h-4" />}
                        >
                          {messages.shiftPreference.bulk.cancelMode}
                        </Button>
                        <Button
                          variant="primary"
                          size="lg"
                          fullWidth
                          onClick={handleProceedBulkDialog}
                          disabled={selectedBulkDates.size === 0}
                        >
                          {messages.shiftPreference.bulk.proceedButton(selectedBulkDates.size)}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        iconLeft={<Plus className="w-4 h-4" />}
                        onClick={() => setSelectedPrefDate(format(new Date(), 'yyyy-MM-dd'))}
                      >
                        本日のシフト申請を追加・編集
                      </Button>
                    )}
                  </div>
                )}
              </div>

              <div className="hidden lg:block">
                <ShiftPreferenceSidebar
                  mode={canManageTenant && showAllMembersPrefs ? "admin" : "self"}
                  selectedDate={canManageTenant && showAllMembersPrefs ? allMemberPrefDate : selectedPrefDate}
                  onSelectedDateChange={canManageTenant && showAllMembersPrefs ? setAllMemberPrefDate : setSelectedPrefDate}
                  preferences={allPreferences}
                  myPreferences={myPreferences}
                  memberNames={memberNames}
                  pendingPreferenceCount={pendingPreferenceCount}
                  preferenceSummary={preferenceSummary}
                  adminSummary={adminSummary}
                  timedPreferences={timedPreferences}
                  onApprovePreference={handleApprovePreference}
                  onRejectPreference={handleRejectPreference}
                  onRevertPreference={handleRevertPreference}
                  canManageStore={(sid) => sid ? isManagerOf(sid) : false}
                  onSubmitPreference={handlePrefSubmit}
                  onDeletePreference={handlePrefDelete}
                  presets={presets}
                  stores={stores}
                  defaultStoreId={storeId}
                  onMutated={fetchPreferenceRange}
                />
              </div>
            </div>
          )}

          {preferenceView === 'history' && (
            <>
              {canManageTenant && (
                <div className="mt-2">
                  <ShiftPreferenceAdminList
                    preferences={preferencesForAdminList}
                    memberNames={memberNames}
                    onApprove={handleApprovePreference}
                    onReject={handleRejectPreference}
                    onBulkApprove={handleBulkApprovePreferences}
                    onBulkReject={handleBulkRejectPreferences}
                    onRevert={handleRevertPreference}
                    onRefresh={fetchPreferenceRange}
                    stores={adminListStores}
                    historyMode
                    canManageStore={(sid) => sid ? isManagerOf(sid) : false}
                  />
                </div>
              )}

              {!canManageTenant && (
                <div className="flex flex-col gap-2">
                  {myPreferencesForHistory.length === 0 && (
                    <Card padding="md">
                      <EmptyState
                        size="sm"
                        title={messages.empty.history.title}
                      />
                    </Card>
                  )}
                  {myPreferencesForHistory.map((pref) => {
                    const theme = getPreferenceTheme(pref.preference_type);
                    const statusTone: BadgeTone =
                      pref.status === 'approved'
                        ? 'success'
                        : pref.status === 'rejected'
                        ? 'neutral'
                        : 'warning';
                    const statusLabel =
                      pref.status === 'approved' ? '承認済' : pref.status === 'rejected' ? '却下' : '未対応';
                    return (
                      <Card key={pref.id} padding="md">
                        <Card.Body className="flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">{pref.date}</span>
                            <Badge tone={statusTone} withDot>{statusLabel}</Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${theme.iconBoxClass}`}>
                              <theme.Icon className="w-3 h-3" />
                              {theme.label}
                            </span>
                            {pref.start_time && pref.end_time && (
                              <span className="text-xs text-neutral-500 dark:text-neutral-300 tabular-nums">
                                {formatTimeRange(pref.start_time, pref.end_time, { separator: ' - ' })}
                              </span>
                            )}
                          </div>
                          {pref.note && (
                            <p className="text-xs text-neutral-500 dark:text-neutral-300">{pref.note}</p>
                          )}
                        </Card.Body>
                      </Card>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
      {activeTab === 'leave' && (
        <div className="space-y-6">
          {leaveLoading && (
            <div className="flex items-center justify-center py-6">
              <Spinner size="md" label="読み込み中" showLabel />
            </div>
          )}

          {!canManageTenant && (
            <div>
              {showLeaveForm ? (
                <LeaveForm
                  onSubmit={handleLeaveSubmit}
                  onCancel={() => setShowLeaveForm(false)}
                  remainingPaidLeave={remainingPaidLeave}
                />
              ) : (
                <button
                  onClick={() => setShowLeaveForm(true)}
                  className="w-full px-4 py-3 text-sm font-medium text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/30 motion-safe:transition-colors duration-120 ease-out-expo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400"
                >
                  + 休暇申請
                </button>
              )}
            </div>
          )}

          <LeaveList
            leaves={leaves}
            memberNames={canManageTenant ? memberNames : undefined}
            storeNames={storeNames}
            canManageTenant={canManageTenant}
            onApprove={handleApproveLeaveWrapped}
            onReject={async (leaveId) => { setRejectingLeaveId(leaveId); }}
            onCancel={cancelLeave}
            onRefresh={fetchRange}
          />
        </div>
      )}
      <RejectLeaveModal
        isOpen={!!rejectingLeaveId}
        leaveId={rejectingLeaveId}
        onClose={() => setRejectingLeaveId(null)}
        onSubmit={handleRejectLeaveSubmit}
      />
      <BottomSheet
        isOpen={!!approveLeaveConfirm}
        onClose={() => setApproveLeaveConfirm(null)}
        title="有給残が不足しています"
        description="対象メンバーの有給残が不足していますが、承認しますか？"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setApproveLeaveConfirm(null)}>
              キャンセル
            </Button>
            <Button variant="primary" size="sm" onClick={handleConfirmApproveLeave}>
              承認する
            </Button>
          </div>
        }
      >
        <div />
      </BottomSheet>
      {storeId && canManageTenant && (
        <BulkApplyPresetModal
          isOpen={showBulkApplyModal}
          onClose={() => setShowBulkApplyModal(false)}
          tenantId={tenantId}
          storeId={storeId}
          presets={presets}
          members={members}
          onApplied={() => {
            fetchPreferenceRange();
          }}
        />
      )}

      {/* 一括シフト申請ダイアログ (Engineer C 配線): self view 限定 */}
      {storeId && !(canManageTenant && showAllMembersPrefs) && (
        <BulkShiftPreferenceDialog
          isOpen={isBulkDialogOpen}
          onClose={() => setIsBulkDialogOpen(false)}
          selectedDates={sortedSelectedBulkDates}
          existingPreferenceDates={existingBulkPreferenceDates}
          lockedDates={lockedBulkDates}
          presets={presets}
          onSubmit={handleBulkPreferenceSubmit}
          isDeadlinePassed={isDeadlinePassed}
          canBypassDeadline={canEditDeadline}
        />
      )}
    </div>
  );
}
