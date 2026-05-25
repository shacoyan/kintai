import { useState, useEffect, useCallback, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, addWeeks, subMonths, addMonths } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Plus, ChevronLeft, ChevronRight, AlertTriangle, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Badge, BottomSheet, ShiftSkeleton, EmptyState, Heading } from '../components/ui';
import { messages } from '../lib/messages';
import { getPreferenceTheme } from '../lib/preferenceTheme';
import { Spinner } from '../components/ui/Spinner';
import type { BadgeTone } from '../components/ui';
import { supabase } from '../lib/supabase';
import { useTenant } from '../hooks/useTenant';
import { useShift } from '../hooks/useShift';
import { useTenantAdmin } from '../hooks/useTenantAdmin';
import { useTenantRoles } from '../hooks/useTenantRoles';
import { useShiftPreset } from '../hooks/useShiftPreset';
import { useShiftPreference } from '../hooks/useShiftPreference';
import { useShiftSubmissionDeadline } from '../hooks/useShiftSubmissionDeadline';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { ShiftCalendar } from '../components/Shift/ShiftCalendar';
import { ShiftMobileCalendar } from '../components/Shift/ShiftMobileCalendar';
import { ShiftMobilePresetSheet } from '../components/Shift/ShiftMobilePresetSheet';
import { ShiftMobileTodayList } from '../components/Shift/ShiftMobileTodayList';
import { ShiftMobileToolbar } from '../components/Shift/ShiftMobileToolbar';
import { ShiftEditModal } from '../components/Shift/ShiftEditModal';
import { PreferenceTimeEditModal } from '../components/Shift/PreferenceTimeEditModal';
import { PreferenceAdminActionModal } from '../components/Shift/PreferenceAdminActionModal';
import { ShiftPreferenceAdminList } from '../components/Shift/ShiftPreferenceAdminList';
import { getInitialShiftMonth } from '../utils/initialShiftMonth';
import { UnifiedShiftSidebar } from '../components/Shift/UnifiedShiftSidebar';
import { DayDetailModal } from '../components/Shift/DayDetailModal';
import { LaborCostCard } from '../components/Shift/LaborCostCard';
import { ShiftStatusFilter, readStatusFilter, writeStatusFilter } from '../components/Shift/ShiftStatusFilter';
import type { StatusFilterValue } from '../components/Shift/unifiedShiftTypes';
import { BulkShiftPreferenceDialog } from '../components/Shift/BulkShiftPreferenceDialog';
import { formatTimeRange } from '../utils/formatTimeRange';
import { useStoreContext } from '../contexts/StoreContext';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../hooks/useAuth';
import type { ShiftPreferenceType, BulkSubmitPreferenceArgs, TenantMember } from '../types';

type PreferenceView = 'current' | 'history';

export function ShiftPage() {
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const { currentTenant, myRole, isOwner } = useTenant();
  const tenantId = currentTenant?.id || '';
  const canManageTenant = myRole === 'owner' || myRole === 'manager';
  const { currentStore, stores, isManagerOf } = useStoreContext();
  const storeId = currentStore?.id ?? null;
  // Loop7 / 要望 X: PC では BottomSheet を完全 unmount し、useBodyScrollLock を発火させない。
  // CSS の `lg:hidden` は display:none のみで React の unmount にはならないため、
  // BottomSheet が PC でもマウントされ続け `document.body.style.overflow = 'hidden'` が
  // 走ってしまう症状を根治する。Tailwind の lg ブレークポイントと一致させる。
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const { myShifts, allShifts, loading: shiftLoading, getMyShifts, getAllShifts, deleteShift, approveShift, rejectShift, modifyShift, tentativeApproveShift, cancelShiftTentative, revertShiftToTentative, restoreShift, getLaborCostEstimate } = useShift(tenantId, storeId);
  const { members, fetchMembers } = useTenantAdmin(tenantId);
  const { roles, fetchRoles } = useTenantRoles(tenantId);
  const { presets, fetchPresets } = useShiftPreset(tenantId, storeId);
  const { myPreferences, allPreferences, loading: prefLoading, fetchMyPreferences, fetchAllPreferences, submitPreference, deletePreference, approvePreference, rejectPreference, revertPreference, bulkSubmitPreferences } = useShiftPreference(tenantId, storeId);
  const { showToast } = useToast();

  const [searchParams, setSearchParams] = useSearchParams();

  const initialShiftMonth = useMemo(() => {
    const monthParam = searchParams.get('month');
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split('-').map(Number);
      if (y && m && m >= 1 && m <= 12) return new Date(y, m - 1, 1);
    }
    return getInitialShiftMonth();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [shiftViewMonth, setShiftViewMonth] = useState<Date>(initialShiftMonth);
  const [shiftViewMode, setShiftViewMode] = useState<'week' | '2week' | 'month'>('month');

  useEffect(() => {
    const ym = format(shiftViewMonth, 'yyyy-MM');
    if (searchParams.get('month') !== ym) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('month', ym);
        return next;
      }, { replace: true });
    }
  }, [shiftViewMonth, searchParams, setSearchParams]);

  const [selectedShift, setSelectedShift] = useState<import('../types').Shift | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Iter 2-B (Worker B): SP BottomSheet を SP 日付タップで自動 open しないよう
  // selectedDate と分離。BottomSheet は「+N 件すべて見る」or 明示的トリガーから開く。
  const [mobileSheetDate, setMobileSheetDate] = useState<string | null>(null);
  // Iter 2-B (Worker B): SP「プリセット」ボタンで開く preset chooser sheet。
  const [mobilePresetSheetOpen, setMobilePresetSheetOpen] = useState<boolean>(false);
  // Loop15: カレンダーの自分の preference を直接押したときに開く時間変更モーダル用 state。
  const [selectedPreference, setSelectedPreference] = useState<import('../types').ShiftPreference | null>(null);
  // Loop16-B: 他人の preference を直接押したときの管理アクションモーダル用 state。
  const [adminTargetPreference, setAdminTargetPreference] = useState<import('../types').ShiftPreference | null>(null);
  // Loop16-C: 空白セルクリックで開く「新規シフト申請モーダル」用の対象日付 state。
  const [newPreferenceDate, setNewPreferenceDate] = useState<string | null>(null);
  const [preferenceView, setPreferenceView] = useState<PreferenceView>('current');
  const [statusFilter, setStatusFilter] = useState<Set<StatusFilterValue>>(() => readStatusFilter());
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  // 一括シフト申請 (Engineer C / §4): 選択モード on/off, 選択 Set, ダイアログ表示
  const [isBulkMode, setIsBulkMode] = useState<boolean>(false);
  const [selectedBulkDates, setSelectedBulkDates] = useState<Set<string>>(() => new Set());
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState<boolean>(false);
  const BULK_MAX_DATES = 31;

  useEffect(() => {
    writeStatusFilter(statusFilter);
  }, [statusFilter]);

  useEffect(() => {
    if (searchParams.has('tab')) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('tab');
        return next;
      }, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingPreferenceCount = useMemo(
    () => allPreferences.filter(p => p.status === 'pending').length,
    [allPreferences]
  );

  const preferencesForCalendar = useMemo(() => {
    if (canManageTenant) return allPreferences;
    return myPreferences.filter(p => p.status !== 'rejected');
  }, [canManageTenant, allPreferences, myPreferences]);

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

  const fetchRange = useCallback(() => {
    const now = new Date();
    const start = format(startOfMonth(addWeeks(now, -2)), 'yyyy-MM-dd');
    const end = format(endOfMonth(addWeeks(now, 4)), 'yyyy-MM-dd');
    if (canManageTenant) {
      getAllShifts(start, end);
      fetchMembers();
    } else {
      getMyShifts(start, end);
    }
  }, [canManageTenant, getAllShifts, getMyShifts, fetchMembers]);

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
    if (tenantId) {
      fetchPreferenceRange();
    }
  }, [tenantId, fetchPreferenceRange]);

  // Loop17: roles を取得して人件費サマリ Card で role.default_monthly_salary を参照する
  useEffect(() => {
    if (tenantId && canManageTenant) {
      void fetchRoles();
    }
  }, [tenantId, canManageTenant, fetchRoles]);

  const shifts = canManageTenant ? allShifts : myShifts;
  const tentativeCount = useMemo(
    () => shifts.filter(s => s.status === 'tentative').length,
    [shifts]
  );
  const approvedCount = useMemo(
    () => shifts.filter(s => s.status === 'approved').length,
    [shifts]
  );
  const leaves = canManageTenant ? [] : []; // Leave removed, but keep variable if needed elsewhere or remove. Removing all leave logic.

  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach(m => map.set(m.user_id, m.display_name ?? '不明'));
    return map;
  }, [members]);

  const membersById = useMemo(() => {
    const map = new Map<string, TenantMember>();
    members.forEach((m) => {
      if (canManageTenant || m.user_id === currentUserId) {
        map.set(m.user_id, m);
      }
    });
    return map;
  }, [canManageTenant, currentUserId, members]);

  const targetMonth = useMemo(() => getInitialShiftMonth(), []);
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

  // Loop17: 人件費サマリ Card 用の payrollMembers / laborEstimates 復活 (Loop2 配線)
  // Loop18 Reviewer P0: カレンダー表示月 (shiftViewMonth) に同期させる。
  //   targetMonth はシフト申請締切ターゲット用 (deadlineInfo) として別役割で残置。
  // オーナー要望 (2026-05-23): 想定人件費は「現在選択中の店舗」のスタッフ分のみに絞る。
  //   store_members を fetch して tenant_members.id ベースで filter する。
  //   storeId=null (店舗未選択) or 取得前は null のままで members 全件 fallback (既存挙動維持)。
  const [storeMemberIds, setStoreMemberIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!storeId || !canManageTenant) {
      setStoreMemberIds(null);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from('store_members')
        .select('member_id')
        .eq('store_id', storeId);
      if (cancelled) return;
      if (error) {
        console.warn('[ShiftPage] store_members fetch failed:', error.message);
        setStoreMemberIds(null);
        return;
      }
      const ids = new Set<string>((data ?? []).map((r: { member_id: string }) => r.member_id));
      setStoreMemberIds(ids);
    })();
    return () => { cancelled = true; };
  }, [storeId, canManageTenant]);

  const payrollMembers = useMemo(() => {
    if (!canManageTenant) return [];
    // storeMemberIds が null の場合 (店舗未選択 or 取得前) は members 全件で fallback
    if (!storeMemberIds) return members;
    return members.filter(m => storeMemberIds.has(m.id));
  }, [members, canManageTenant, storeMemberIds]);

  const spRoleTypeMap = useMemo(() => {
    const map = new Map<string, 'owner' | 'manager' | 'fulltime' | 'parttime'>();
    for (const member of members) {
      if (member.role === 'owner') {
        map.set(member.user_id, 'owner');
      } else if (member.role === 'manager') {
        map.set(member.user_id, 'manager');
      } else {
        map.set(member.user_id, member.is_parttime ? 'parttime' : 'fulltime');
      }
    }
    return map;
  }, [members]);

  // P2: 月給 fallback 用の rolesMap を共通 util (getEffectiveMonthlySalary) に渡す
  const rolesMap = useMemo(() => new Map(roles.map(r => [r.id, r])), [roles]);

  const laborEstimates = useMemo(() => {
    if (!canManageTenant) return { tentative: [], all: [] };
    const monthStart = format(startOfMonth(shiftViewMonth), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(shiftViewMonth), 'yyyy-MM-dd');
    const monthShifts = allShifts.filter(s => s.date >= monthStart && s.date <= monthEnd);
    // P1: 「仮承認分」ラベルとの整合性確保のため status === 'tentative' のみに限定
    //   (approved は含めない)。全体見込みは monthShifts (tentative + approved) のまま。
    const tentativeShifts = monthShifts.filter(s => s.status === 'tentative');
    return {
      tentative: getLaborCostEstimate(tentativeShifts, payrollMembers, rolesMap),
      all: getLaborCostEstimate(monthShifts, payrollMembers, rolesMap),
    };
  }, [canManageTenant, allShifts, shiftViewMonth, getLaborCostEstimate, payrollMembers, rolesMap]);

  const handlePrefSubmit = async (
    date: string,
    type: ShiftPreferenceType,
    startTime?: string,
    endTime?: string,
    note?: string,
    storeIdOverride?: string,
  ) => {
    await submitPreference(date, type, startTime, endTime, note, storeIdOverride);
    setSelectedDate(null);
    fetchPreferenceRange();
  };

  const handlePrefDelete = async (id: string) => {
    await deletePreference(id);
    setSelectedDate(null);
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
  //   storeId null / preferenceView !== 'current'
  useEffect(() => {
    const shouldDisable =
      !storeId ||
      preferenceView !== 'current';
    if (shouldDisable) {
      setIsBulkMode((prev) => (prev ? false : prev));
      setSelectedBulkDates((prev) => (prev.size > 0 ? new Set() : prev));
      setIsBulkDialogOpen((prev) => (prev ? false : prev));
    }
  }, [storeId, preferenceView]);

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
  // Dialog のロック警告に配線。
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

  if (!tenantId) return null;

  if (!storeId) {
    return (
      <div className="p-6">
        <Card padding="md">
          <Card.Body className="text-center text-sm text-stone-700 dark:text-stone-300">
            店舗を選択してください。ヘッダーの店舗セレクターから操作対象の店舗を選ぶと、シフト・シフト申請が表示されます。
          </Card.Body>
        </Card>
      </div>
    );
  }

  // 初回ロード時 (各 hook の loading かつ初期データ未取得) はページ全体スケルトン
  const initialLoading =
    shiftLoading && prefLoading &&
    myShifts.length === 0 &&
    allShifts.length === 0 &&
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
    <div className="max-w-[1200px] mx-auto px-5 py-6 space-y-6">
      <div className="flex flex-col gap-4 pb-16">
        {/* ヘッダー: 「シフト」見出しのみ (月表示 + pending 件数バッジ削除) */}
        <header className="flex flex-col gap-1">
          <Heading level={1}>
            <span className="lg:hidden">シフト</span>
            <span className="hidden lg:inline">シフト管理</span>
          </Heading>
        </header>

        {/* Iter 5-A: PC 統合 Card (Toolbar + Calendar + Legend) */}
        <div className="hidden lg:block">
          <Card padding="none" className="overflow-hidden">
            <div className="flex items-center gap-2 flex-wrap px-4 py-3">
              <div className="inline-flex items-center bg-stone-100 dark:bg-stone-800 rounded-[8px] p-[3px] self-start">
                <button
                  type="button"
                  onClick={() => setPreferenceView('current')}
                  aria-pressed={preferenceView === 'current'}
                  className={`inline-flex items-center rounded-md px-2.5 py-[5px] text-[12px] font-medium motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    preferenceView === 'current'
                      ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-50 shadow-sm'
                      : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
                  }`}
                >
                  現在
                </button>
                <button
                  type="button"
                  onClick={() => setPreferenceView('history')}
                  aria-pressed={preferenceView === 'history'}
                  className={`inline-flex items-center rounded-md px-2.5 py-[5px] text-[12px] font-medium motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    preferenceView === 'history'
                      ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-50 shadow-sm'
                      : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
                  }`}
                >
                  履歴
                </button>
              </div>

              {preferenceView === 'current' && (
                <>
                  <div className="hidden sm:block w-px h-[20px] bg-stone-200 dark:bg-stone-700" aria-hidden="true" />
                  <div className="inline-flex items-center bg-stone-100 dark:bg-stone-800 rounded-[8px] p-[3px] self-start">
                    {(['week', '2week', 'month'] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setShiftViewMode(v)}
                        aria-pressed={shiftViewMode === v}
                        className={`inline-flex items-center rounded-md px-2.5 py-[5px] text-[12px] font-medium motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                          shiftViewMode === v
                            ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-50 shadow-sm'
                            : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
                        }`}
                      >
                        {v === 'week' ? '週' : v === '2week' ? '2週' : '月'}
                      </button>
                    ))}
                  </div>
                  <div className="hidden sm:block w-px h-[20px] bg-stone-200 dark:bg-stone-700" aria-hidden="true" />
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShiftViewMonth(subMonths(shiftViewMonth, 1))}
                      aria-label="前月"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-500 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-stone-100 focus-ring"
                    >
                      <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <div className="flex min-w-[80px] flex-col items-center">
                      <span className="text-base font-semibold text-stone-900 dark:text-stone-100 tabular-nums">
                        {format(shiftViewMonth, 'yyyy / MM')}
                      </span>
                      <span className="text-[10px] text-stone-500 dark:text-stone-400">
                        {format(shiftViewMonth, 'M月')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShiftViewMonth(addMonths(shiftViewMonth, 1))}
                      aria-label="次月"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-500 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-stone-100 focus-ring"
                    >
                      <ChevronRight className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="hidden sm:block w-px h-[20px] bg-stone-200 dark:bg-stone-700" aria-hidden="true" />
                  <div className="min-w-0 flex-1 sm:flex-none">
                    <ShiftStatusFilter
                      value={statusFilter}
                      onChange={setStatusFilter}
                      showPreferenceStatus={canManageTenant}
                      counts={{
                        pending_preference: pendingPreferenceCount,
                        tentative: tentativeCount,
                        approved: approvedCount,
                      }}
                    />
                  </div>

                  <div className="hidden sm:block flex-1" aria-hidden="true" />
                  <div className="flex flex-wrap items-center gap-2">
                    {storeId && !isBulkMode && (
                      <Button
                        variant="success"
                        size="sm"
                        iconLeft={<Plus className="w-3.5 h-3.5" />}
                        onClick={handleEnterBulkMode}
                        disabled={isDeadlinePassed && !canEditDeadline}
                        className="shrink-0 grow sm:grow-0"
                        aria-pressed={isBulkMode}
                        aria-label={messages.shiftPreference.bulk.entryButtonAria}
                      >
                        {messages.shiftPreference.bulk.entryButton}
                      </Button>
                    )}
                    {canManageTenant && (() => {
                      // Iter 2-A (Worker A) / P1: 正典準拠順序 — 申請 → 本承認 → 却下。
                      // 「仮承認を一括本承認」: 表示中の月に含まれる shift.status === 'tentative' を一括で本承認する。
                      // - approveShift (RPC approve_shift_final) を 1 件ずつ呼ぶ。エラー件数は console.warn でログ出力。
                      // - 「未承認を一括却下」と同じパターン (filter → confirm → for ループ → fetchRange)。
                      const monthStart = format(startOfMonth(shiftViewMonth), 'yyyy-MM-dd');
                      const monthEnd = format(endOfMonth(shiftViewMonth), 'yyyy-MM-dd');
                      const tentativeInRange = shifts.filter(
                        s => s.status === 'tentative' && s.date >= monthStart && s.date <= monthEnd
                      );
                      const tCount = tentativeInRange.length;
                      const handleBulkApproveTentative = async () => {
                        if (tCount === 0) return;
                        // eslint-disable-next-line no-alert
                        if (!window.confirm(`${tCount}件を本承認します。よろしいですか？`)) return;
                        let errors = 0;
                        for (const s of tentativeInRange) {
                          try {
                            await approveShift(s.id);
                          } catch {
                            errors += 1;
                          }
                        }
                        fetchRange();
                        if (errors > 0) {
                          // eslint-disable-next-line no-console
                          console.warn(`[bulkApproveTentative] ${errors} 件で承認エラーが発生しました`);
                        }
                      };
                      return (
                        /* Iter 2-A / P1: outline 風 */
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleBulkApproveTentative}
                          disabled={tCount === 0}
                          className="shrink-0 grow sm:grow-0 !bg-white !border !border-stone-200 !text-stone-900 hover:!bg-stone-100 dark:!bg-stone-800 dark:!border-stone-700 dark:!text-stone-100 dark:hover:!bg-stone-700"
                          aria-label={`表示中の期間の仮承認シフトを一括本承認（${tCount}件）`}
                        >
                          仮承認を一括本承認{tCount > 0 ? `（${tCount}）` : ''}
                        </Button>
                      );
                    })()}
                    {canManageTenant && (() => {
                      const monthStart = format(startOfMonth(shiftViewMonth), 'yyyy-MM-dd');
                      const monthEnd = format(endOfMonth(shiftViewMonth), 'yyyy-MM-dd');
                      const pendingInRange = preferencesForCalendar.filter(
                        p => p.status === 'pending' && p.date >= monthStart && p.date <= monthEnd
                      );
                      const count = pendingInRange.length;
                      const handleBulkRejectInRange = async () => {
                        if (count === 0) return;
                        // eslint-disable-next-line no-alert
                        if (!window.confirm(`${count}件却下します。よろしいですか？`)) return;
                        let errors = 0;
                        for (const p of pendingInRange) {
                          try {
                            await rejectPreference(p.id);
                          } catch {
                            errors += 1;
                          }
                        }
                        fetchPreferenceRange();
                        fetchRange();
                        if (errors > 0) {
                          // eslint-disable-next-line no-console
                          console.warn(`[bulkRejectInRange] ${errors} 件で却下エラーが発生しました`);
                        }
                      };
                      return (
                        /* Iter 2-A / P1: ghost-danger 風 — border なし + 赤文字 + hover で淡赤背景 */
                        <Button
                          variant="tertiary"
                          size="sm"
                          onClick={handleBulkRejectInRange}
                          disabled={count === 0}
                          className="shrink-0 grow sm:grow-0 !text-red-700 hover:!bg-red-50 dark:!text-red-300 dark:hover:!bg-red-900/30"
                          aria-label={`表示中の期間の未承認 preference を一括却下（${count}件）`}
                        >
                          未承認を一括却下{count > 0 ? `（${count}）` : ''}
                        </Button>
                      );
                    })()}
                  </div>
                </>
              )}
            </div>

            {preferenceView === 'current' && (
              <>
                <div className="border-t border-stone-100 dark:border-stone-700/60">
                  <ShiftCalendar
                    shifts={shifts}
                    preferences={preferencesForCalendar}
                    viewMode={shiftViewMode}
                    baseDate={shiftViewMonth}
                    onDateClick={(date) => {
                      if (isBulkMode) {
                        handleToggleBulkDate(date);
                      } else {
                        // Iter 2-A (Worker A) / P0 fix:
                        // PC は DayDetailModal を起動する。新規申請は modal 内 Quick Add ボタンから。
                        setSelectedDate(date);
                      }
                    }}
                    onShiftClick={(shift) => setSelectedShift(shift)}
                    onPreferenceClick={(p) => {
                      // Loop15 + Loop16-B (+ Reviewer P1 fix):
                      // - 自分の preference は時間変更モーダル
                      // - 他人 + 当該店舗の manager (= isManagerOf(p.store_id), owner は常に true) は管理アクションモーダル
                      // - 他人 + 一般スタッフ or 他店舗 manager は何もしない
                      //   ※ canManageTenant のみで判定すると店舗 A の manager が店舗 B の preference を承認可能になる。
                      //   PreferenceActionRow と同じ canManageStore 相当のガードで揃える。
                      if (currentUserId && p.user_id === currentUserId) {
                        setSelectedPreference(p);
                      } else if (canManageTenant && p.store_id && isManagerOf(p.store_id)) {
                        setAdminTargetPreference(p);
                      }
                    }}
                    memberNames={canManageTenant ? memberNames : undefined}
                    statusFilter={statusFilter}
                    showPreferenceStatus={canManageTenant}
                    leaves={leaves}
                    onViewMonthChange={setShiftViewMonth}
                    currentUserId={currentUserId}
                    selectedBulkDates={isBulkMode ? selectedBulkDates : undefined}
                    membersById={membersById}
                  />
                </div>

                <div className="border-t border-stone-100 dark:border-stone-700/60 px-4 py-3">
                  <div className="flex items-center gap-[18px] flex-wrap text-[11px]">
                    <div className="font-semibold text-stone-500 dark:text-stone-400">役職</div>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: '#7c3aed' }} />
                      <span className="text-stone-600 dark:text-stone-300">会長 / 内勤</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: '#2563eb' }} />
                      <span className="text-stone-600 dark:text-stone-300">店長</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: '#0d9488' }} />
                      <span className="text-stone-600 dark:text-stone-300">正社員</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: '#ea580c' }} />
                      <span className="text-stone-600 dark:text-stone-300">バイト</span>
                    </span>
                    <div className="hidden sm:block w-px h-4 bg-stone-200 dark:bg-stone-700" aria-hidden="true" />
                    <div className="font-semibold text-stone-500 dark:text-stone-400">雇用形態</div>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block w-3.5 h-2"
                        style={{ background: 'rgba(13, 148, 136, 0.18)', borderLeft: '2px solid #0d9488' }}
                      />
                      <span className="text-stone-600 dark:text-stone-300">月給</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block w-3.5 h-2"
                        style={{
                          background: 'rgba(234, 88, 12, 0.12)',
                          borderLeft: '2px solid #ea580c',
                          borderTop: '1px dashed #ea580c88',
                          borderBottom: '1px dashed #ea580c88',
                        }}
                      />
                      <span className="text-stone-600 dark:text-stone-300">時給</span>
                    </span>
                    <div className="hidden sm:block w-px h-4 bg-stone-200 dark:bg-stone-700" aria-hidden="true" />
                    <div className="font-semibold text-stone-500 dark:text-stone-400">ステータス</div>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-3.5 h-2 rounded-sm" style={{ background: '#ecfdf5', border: '1px solid #059669' }} />
                      <span className="text-stone-600 dark:text-stone-300">本承認</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-3.5 h-2 rounded-sm" style={{ background: '#fff7ed', border: '1px solid #f97316' }} />
                      <span className="text-stone-600 dark:text-stone-300">仮承認</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-3.5 h-2 rounded-sm" style={{ background: '#eff6ff', border: '1px solid #2563eb' }} />
                      <span className="text-stone-600 dark:text-stone-300">申請中</span>
                    </span>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>

        {preferenceView === 'current' && (
          <>
          <div className="lg:grid lg:grid-cols-[1fr_320px] lg:gap-5 lg:items-start">
            <div className="flex flex-col gap-4">
              {prefLoading && (
                <div className="flex items-center justify-center py-6">
                  <Spinner size="md" label="読み込み中" showLabel />
                </div>
              )}

              {/* Deadline Banner */}
              {/* 理由: Deadline 警告バナーの左ボーダー強調 (例外③) */}
              {deadlineInfo && !deadlineInfo.passed && (
                <Card padding="md" role="status" aria-live="polite" className="border-l-4 border-orange-500 dark:border-orange-400 bg-orange-50 dark:bg-orange-800/30">
                  <Card.Body className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" aria-hidden="true" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-orange-700 dark:text-orange-100">
                        シフト申請の提出締切: {format(deadlineInfo.deadline, 'M月d日(E) HH:mm', { locale: ja })}
                      </p>
                      <p className="text-xs text-orange-700 dark:text-orange-200 mt-1 tabular-nums">
                        残り {deadlineInfo.remainingLabel}（{format(deadlineInfo.targetMonth, 'yyyy年M月', { locale: ja })} 分）
                      </p>
                    </div>
                  </Card.Body>
                </Card>
              )}
              {/* 理由: Deadline エラーバナー（締切過ぎ）の左ボーダー強調 (例外③) */}
              {deadlineInfo && deadlineInfo.passed && (
                <Card padding="md" role="status" aria-live="polite" className="border-l-4 border-red-500 dark:border-red-400 bg-red-50 dark:bg-red-800/30">
                  <Card.Body className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-red-700 dark:text-red-100">
                        締切過ぎ — 提出には管理者承認が必要です
                      </p>
                      <p className="text-xs text-red-700 dark:text-red-200 mt-1 tabular-nums">
                        {format(deadlineInfo.deadline, 'M月d日(E) HH:mm', { locale: ja })} に締め切られました（{format(deadlineInfo.targetMonth, 'yyyy年M月', { locale: ja })} 分）
                      </p>
                    </div>
                  </Card.Body>
                </Card>
              )}

              {/* Bulk Toolbar — エントリーボタンは上の StatusFilter 行に移動。ここには isBulkMode 選択中のバーのみ残す */}
              {storeId && isBulkMode && (
                /* 理由: 一括選択モード active 状態の枠線強調 (例外③) */
                <div
                  role="region"
                  aria-label="一括シフト申請 選択モード"
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 flex-wrap rounded-md border border-blue-100 dark:border-blue-700 bg-blue-50 dark:bg-blue-800/30 px-3 py-2 sticky bottom-2 z-30 sm:static shadow-md sm:shadow-none"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-blue-700 dark:text-blue-100 tabular-nums">
                      {messages.shiftPreference.bulk.selectedCount(selectedBulkDates.size)}
                    </span>
                    {selectedBulkDates.size > 0 && (
                      <button
                        type="button"
                        onClick={handleClearAllBulkDates}
                        className="text-xs font-semibold text-blue-700 dark:text-blue-200 hover:underline focus-ring"
                      >
                        {messages.shiftPreference.bulk.clearAll}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      iconLeft={<X className="w-4 h-4" />}
                      onClick={handleCancelBulkMode}
                      className="grow sm:grow-0"
                    >
                      {messages.shiftPreference.bulk.cancelMode}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleProceedBulkDialog}
                      disabled={selectedBulkDates.size === 0}
                      className="grow sm:grow-0"
                    >
                      {messages.shiftPreference.bulk.proceedButton(selectedBulkDates.size)}
                    </Button>
                  </div>
                </div>
              )}

              {/* Grid Content: ShiftCalendar */}
              {shiftLoading && (
                <div className="flex items-center justify-center py-6">
                  <Spinner size="md" label="読み込み中" showLabel />
                </div>
              )}

              {/* SP モバイル UI — Worker C 担当 */}
              <div className="lg:hidden flex flex-col gap-3">
                <ShiftMobileToolbar
                  shiftViewMonth={shiftViewMonth}
                  onPrevMonth={() => setShiftViewMonth(subMonths(shiftViewMonth, 1))}
                  onNextMonth={() => setShiftViewMonth(addMonths(shiftViewMonth, 1))}
                  onFilterClick={() => setMobileFilterOpen(true)}
                  pendingFilterCount={statusFilter.size > 0 ? statusFilter.size : undefined}
                />

                <ShiftMobileCalendar
                  shiftViewMonth={shiftViewMonth}
                  shifts={shifts}
                  preferences={preferencesForCalendar}
                  currentUserId={currentUserId}
                  selectedDate={selectedDate}
                  selectedBulkDates={isBulkMode ? selectedBulkDates : undefined}
                  isBulkMode={isBulkMode}
                  onDateClick={(date) => {
                    if (isBulkMode) {
                      handleToggleBulkDate(date);
                    } else {
                      setSelectedDate(date);
                      // Iter 2-B (Worker B): SP では BottomSheet を自動 open しない。
                      // ShiftMobileTodayList が selectedDate に切り替わって表示される。
                    }
                  }}
                />

                <ShiftMobileTodayList
                  selectedDate={selectedDate}
                  shifts={shifts}
                  preferences={preferencesForCalendar}
                  memberNames={memberNames}
                  roleTypeMap={spRoleTypeMap}
                  onShiftClick={(shift) => setSelectedShift(shift)}
                  onSeeAll={() => {
                    const target = selectedDate ?? format(new Date(), 'yyyy-MM-dd');
                    setMobileSheetDate(target);
                  }}
                />
              </div>

              {/* SP BottomSheet: Unified Sidebar inline component */}
              {!isDesktop && (
                <BottomSheet
                  isOpen={!!mobileSheetDate}
                  onClose={() => setMobileSheetDate(null)}
                  title={mobileSheetDate ? `${mobileSheetDate} のシフト・申請` : undefined}
                >
                  {mobileSheetDate && (
                    <UnifiedShiftSidebar
                      mode={canManageTenant ? "manager" : "staff"}
                      currentUserId={currentUserId}
                      selectedDate={mobileSheetDate}
                      onSelectedDateChange={setMobileSheetDate}
                      shifts={canManageTenant ? allShifts : myShifts}
                      preferences={canManageTenant ? allPreferences : myPreferences}
                      myPreferences={myPreferences}
                      memberNames={memberNames}
                      storeNames={storeNames}
                      onApproveShift={approveShift}
                      onRejectShift={rejectShift}
                      onTentativeApproveShift={tentativeApproveShift}
                      onCancelShiftTentative={cancelShiftTentative}
                      onRevertShiftToTentative={async(id)=>{await revertShiftToTentative(id);}}
                      onRestoreShift={async(id)=>{await restoreShift(id);}}
                      onModifyShift={(s)=>setSelectedShift(s)}
                      onDeleteShift={deleteShift}
                      onApprovePreference={handleApprovePreference}
                      onRejectPreference={handleRejectPreference}
                      onRevertPreference={handleRevertPreference}
                      onSubmitPreference={handlePrefSubmit}
                      onDeletePreference={handlePrefDelete}
                      canManageStore={(sid)=>sid?isManagerOf(sid):false}
                      presets={presets}
                      stores={stores}
                      defaultStoreId={storeId}
                      onMutated={() => { fetchPreferenceRange(); fetchRange(); }}
                      adminSummary={adminSummary}
                      preferenceSummary={preferenceSummary}
                      pendingPreferenceCount={pendingPreferenceCount}
                      isDeadlinePassed={isDeadlinePassed}
                      canBypassDeadline={canEditDeadline}
                    />
                  )}
                </BottomSheet>
              )}

              {!isDesktop && (
                <ShiftMobilePresetSheet
                  isOpen={mobilePresetSheetOpen}
                  onClose={() => setMobilePresetSheetOpen(false)}
                  presets={presets}
                  targetDate={selectedDate ?? format(new Date(), 'yyyy-MM-dd')}
                  disabled={isDeadlinePassed && !canEditDeadline}
                  onSelect={async (preset) => {
                    try {
                      const targetDateStr = selectedDate ?? format(new Date(), 'yyyy-MM-dd');
                      await submitPreference(targetDateStr, 'preferred', preset.start_time, preset.end_time, undefined, undefined);
                      fetchPreferenceRange();
                      setMobilePresetSheetOpen(false);
                    } catch {
                      // submitPreference already reports the error.
                    }
                  }}
                />
              )}

              {!isDesktop && (
                <BottomSheet
                  isOpen={mobileFilterOpen}
                  onClose={() => setMobileFilterOpen(false)}
                  title="フィルタ"
                >
                  <div className="p-4">
                    <ShiftStatusFilter
                      value={statusFilter}
                      onChange={setStatusFilter}
                      showPreferenceStatus={canManageTenant}
                      counts={{
                        pending_preference: pendingPreferenceCount,
                        tentative: tentativeCount,
                        approved: approvedCount,
                      }}
                    />
                  </div>
                </BottomSheet>
              )}

              <div className="lg:hidden sticky bottom-16 md:bottom-0 -mx-4 px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] bg-white/92 dark:bg-stone-900/92 backdrop-blur-md border-t border-stone-200 dark:border-stone-700 z-20">
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
                  <div className="grid grid-cols-[96px_1fr] gap-2">
                    <Button
                      variant="secondary"
                      size="lg"
                      onClick={() => setMobilePresetSheetOpen(true)}
                      disabled={isDeadlinePassed && !canEditDeadline}
                    >
                      プリセット
                    </Button>
                    <Button
                      variant="primary"
                      size="lg"
                      iconLeft={<Plus className="w-4 h-4" />}
                      onClick={() => setNewPreferenceDate(format(new Date(), 'yyyy-MM-dd'))}
                    >
                      希望シフト提出
                    </Button>
                  </div>
                )}
              </div>
            </div>

              {isDesktop && (
                <aside
                  aria-label="シフトページ Right rail"
                  className="hidden lg:flex lg:flex-col lg:gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
                >
                  {canManageTenant && payrollMembers.length > 0 && (
                    <LaborCostCard
                      members={payrollMembers}
                      roles={roles}
                      tentativeLaborEstimates={laborEstimates.tentative}
                      allLaborEstimates={laborEstimates.all}
                      targetMonth={shiftViewMonth}
                    />
                  )}
                </aside>
              )}
            </div>

            {isDesktop && (
              <DayDetailModal
                mode={canManageTenant ? "manager" : "staff"}
                currentUserId={currentUserId}
                selectedDate={selectedDate}
                onSelectedDateChange={setSelectedDate}
                onQuickAdd={() => {
                  // Iter 2-A (Worker A) / P0 fix:
                  // DayDetailModal の「+ 追加」ボタン経由で新規申請モーダルへ。
                  if (selectedDate) {
                    setNewPreferenceDate(selectedDate);
                    setSelectedDate(null);
                  }
                }}
                shifts={canManageTenant ? allShifts : myShifts}
                preferences={canManageTenant ? allPreferences : myPreferences}
                myPreferences={myPreferences}
                memberNames={memberNames}
                storeNames={storeNames}
                onApproveShift={approveShift}
                onRejectShift={rejectShift}
                onTentativeApproveShift={tentativeApproveShift}
                onCancelShiftTentative={cancelShiftTentative}
                onRevertShiftToTentative={async(id)=>{await revertShiftToTentative(id);}}
                onRestoreShift={async(id)=>{await restoreShift(id);}}
                onModifyShift={(s)=>setSelectedShift(s)}
                onDeleteShift={deleteShift}
                onApprovePreference={handleApprovePreference}
                onRejectPreference={handleRejectPreference}
                onRevertPreference={handleRevertPreference}
                onSubmitPreference={handlePrefSubmit}
                onDeletePreference={handlePrefDelete}
                canManageStore={(sid)=>sid?isManagerOf(sid):false}
                presets={presets}
                stores={stores}
                defaultStoreId={storeId}
                onMutated={() => { fetchPreferenceRange(); fetchRange(); }}
                adminSummary={adminSummary}
                preferenceSummary={preferenceSummary}
                pendingPreferenceCount={pendingPreferenceCount}
                isDeadlinePassed={isDeadlinePassed}
                canBypassDeadline={canEditDeadline}
              />
            )}
          </>
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
                            <span className="text-sm font-semibold text-stone-900 dark:text-stone-100 tabular-nums">{pref.date}</span>
                            <Badge tone={statusTone} withDot>{statusLabel}</Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${theme.iconBoxClass}`}>
                              <theme.Icon className="w-3 h-3" />
                              {theme.label}
                            </span>
                            {pref.start_time && pref.end_time && (
                              <span className="text-xs text-stone-500 dark:text-stone-300 tabular-nums">
                                {formatTimeRange(pref.start_time, pref.end_time, { separator: ' - ' })}
                              </span>
                            )}
                          </div>
                          {pref.note && (
                            <p className="text-xs text-stone-500 dark:text-stone-300">{pref.note}</p>
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
      {storeId && (
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

      {selectedShift && canManageTenant && (
        <ShiftEditModal
          shift={selectedShift}
          memberName={memberNames.get(selectedShift.user_id)}
          canManageTenant={canManageTenant}
          onModify={modifyShift}
          onDelete={deleteShift}
          onApprove={approveShift}
          onReject={rejectShift}
          onTentativeApprove={tentativeApproveShift}
          onCancelTentative={cancelShiftTentative}
          onRevertToTentative={async (id) => { await revertShiftToTentative(id); }}
          onRestore={async (id) => { await restoreShift(id); }}
          onClose={() => setSelectedShift(null)}
          onRefresh={fetchRange}
          selectableStores={isOwner ? stores : stores.filter(s => isManagerOf(s.id))}
          storeName={stores.find(s => s.id === selectedShift.store_id)?.name}
          canManageStore={selectedShift.store_id ? isManagerOf(selectedShift.store_id) : false}
          // Loop15: カレンダー直押し時はいきなり時間変更モードを開く。
          initialMode="edit"
        />
      )}

      {/* Loop15: 自分の preference をカレンダーから直押ししたときの時間変更モーダル */}
      {selectedPreference && (
        <PreferenceTimeEditModal
          preference={selectedPreference}
          presets={presets}
          defaultStoreId={storeId}
          selectableStores={stores}
          isDeadlinePassed={isDeadlinePassed}
          canBypassDeadline={canEditDeadline}
          onSubmit={async (date, type, startTime, endTime, note, storeIdOverride) => {
            await handlePrefSubmit(date, type, startTime, endTime, note, storeIdOverride);
            setSelectedPreference(null);
          }}
          onDelete={async (id) => {
            await handlePrefDelete(id);
            setSelectedPreference(null);
          }}
          onClose={() => setSelectedPreference(null)}
        />
      )}

      {/* Loop16-B (+ Reviewer P1 fix): 他人の preference を admin が直押ししたときの管理アクションモーダル
          - canManageTenant かつ当該店舗の manager (owner は全店舗 true) のときのみ render。
          - state を直接いじってバイパスされても render guard で防御。 */}
      {adminTargetPreference && canManageTenant && adminTargetPreference.store_id && isManagerOf(adminTargetPreference.store_id) && (
        <PreferenceAdminActionModal
          preference={adminTargetPreference}
          memberName={memberNames.get(adminTargetPreference.user_id)}
          storeName={adminTargetPreference.store_id ? storeNames.get(adminTargetPreference.store_id) : undefined}
          presets={presets}
          onApprove={async (id, startTime, endTime) => {
            await handleApprovePreference(id, startTime, endTime);
          }}
          onReject={async (id) => {
            await handleRejectPreference(id);
          }}
          onClose={() => setAdminTargetPreference(null)}
        />
      )}

      {/* Loop16-C: 空白セルクリックで開く「自分の新規シフト申請モーダル」 */}
      {newPreferenceDate && (
        <PreferenceTimeEditModal
          newDate={newPreferenceDate}
          presets={presets}
          defaultStoreId={storeId}
          selectableStores={stores}
          isDeadlinePassed={isDeadlinePassed}
          canBypassDeadline={canEditDeadline}
          onSubmit={async (date, type, startTime, endTime, note, storeIdOverride) => {
            await handlePrefSubmit(date, type, startTime, endTime, note, storeIdOverride);
            setNewPreferenceDate(null);
          }}
          onDelete={async (id) => {
            await handlePrefDelete(id);
            setNewPreferenceDate(null);
          }}
          onClose={() => setNewPreferenceDate(null)}
        />
      )}
    </div>
  );
}
