import { useState, useEffect, useCallback, useMemo, useRef, startTransition } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { format, startOfMonth, endOfMonth, addWeeks, subMonths, addMonths } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Plus, ChevronLeft, ChevronRight, AlertTriangle, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Badge, BottomSheet, ShiftSkeleton, EmptyState, Heading, ConfirmDialog } from '../components/ui';
import { messages } from '../lib/messages';
import { getPreferenceTheme } from '../lib/preferenceTheme';
import { Spinner } from '../components/ui/Spinner';
import type { BadgeTone } from '../components/ui';
import { supabase } from '../lib/supabase';
import { useTenant } from '../hooks/useTenant';
import { useShift } from '../hooks/useShift';
import { useTenantAdmin } from '../hooks/useTenantAdmin';
import { useTenantRoles } from '../hooks/useTenantRoles';
import { useMemberStorePayrolls } from '../hooks/useMemberStorePayrolls';
import { useShiftPreset } from '../hooks/useShiftPreset';
import { useShiftPreference } from '../hooks/useShiftPreference';
import { useShiftSubmissionDeadline } from '../hooks/useShiftSubmissionDeadline';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { ShiftCalendar } from '../components/Shift/ShiftCalendar';
import { ShiftMobileCalendar } from '../components/Shift/ShiftMobileCalendar';
import { ShiftMobileMonthHeader } from '../components/Shift/ShiftMobileMonthHeader';
import { ShiftMobileFab } from '../components/Shift/ShiftMobileFab';
import { ShiftDayCoverageHeader } from '../components/Shift/ShiftDayCoverageHeader';
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
import { buildTentativeShiftMap, getEffectiveTime } from '../utils/preferenceEffectiveTime';
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

  const { myShifts, allShifts, loading: shiftLoading, getMyShifts, getAllShifts, deleteShift, approveShift, rejectShift, modifyShift, tentativeApproveShift, cancelShiftTentative, revertShiftToTentative, restoreShift, getLaborCostEstimate, addShiftForMember, finalApproveStoreShifts } = useShift(tenantId, storeId);
  const { members, fetchMembers } = useTenantAdmin(tenantId);
  const { roles, fetchRoles } = useTenantRoles(tenantId);
  // Phase 2: 店舗別人件費 (member_store_payrolls)。0 行のテナントでは payrollsMap が空 Map のまま →
  // getLaborCostEstimate 内で tenant_members 既定値にフォールバック → 既存挙動完全互換。
  const { payrollsMap: memberStorePayrollsMap, fetchMemberStorePayrolls } = useMemberStorePayrolls(tenantId);
  const { presets, fetchPresets } = useShiftPreset(tenantId, storeId);
  const { myPreferences, allPreferences, loading: prefLoading, fetchMyPreferences, fetchAllPreferences, submitPreference, deletePreference, approvePreference, rejectPreference, revertPreference, bulkSubmitPreferences, approvePreferencesByIds, rejectPreferencesByIds } = useShiftPreference(tenantId, storeId);
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
  // Loop15: カレンダーの自分の preference を直接押したときに開く時間変更モーダル用 state。
  const [selectedPreference, setSelectedPreference] = useState<import('../types').ShiftPreference | null>(null);
  // Loop16-B: 他人の preference を直接押したときの管理アクションモーダル用 state。
  const [adminTargetPreference, setAdminTargetPreference] = useState<import('../types').ShiftPreference | null>(null);
  // Loop16-C: 空白セルクリックで開く「新規シフト申請モーダル」用の対象日付 state。
  const [newPreferenceDate, setNewPreferenceDate] = useState<string | null>(null);
  const [preferenceView, setPreferenceView] = useState<PreferenceView>('current');
  const [statusFilter, setStatusFilter] = useState<Set<StatusFilterValue>>(() => readStatusFilter());
  // 一括本承認 / 一括却下の確認ダイアログ用ペイロード
  const [bulkConfirm, setBulkConfirm] = useState<
    | { kind: 'approve'; count: number; monthStart: string; monthEnd: string }
    | { kind: 'reject'; count: number; ids: string[] }
    | null
  >(null);
  const [bulkConfirmBusy, setBulkConfirmBusy] = useState(false);

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
    () => allPreferences.filter(p => p.status === 'pending' && p.preference_type !== 'unavailable').length,
    [allPreferences]
  );
  const unavailablePreferenceCount = useMemo(
    () => allPreferences.filter(p => p.status === 'pending' && p.preference_type === 'unavailable').length,
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

  // P3-4: staff 履歴の override 表示用（自分の確定シフトのみ＝myShifts スコープ）
  const myOverrideShiftMap = useMemo(() => buildTentativeShiftMap(myShifts), [myShifts]);

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

  // Phase 2: 店舗別人件費 (member_store_payrolls) を読み込む。
  // payrollsMap 取得失敗時は空 Map のままで、getLaborCostEstimate は既存挙動にフォールバック。
  useEffect(() => {
    if (tenantId && canManageTenant) {
      void fetchMemberStorePayrolls();
    }
  }, [tenantId, canManageTenant, fetchMemberStorePayrolls]);

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
    // Phase 2: payrollsMap を渡し、店舗別 override を反映した人件費計算を行う。
    // payrollsMap が空 (= 0 行テナント) では tenant_members 既定値にフォールバックし regression なし。
    return {
      tentative: getLaborCostEstimate(tentativeShifts, payrollMembers, rolesMap, memberStorePayrollsMap),
      all: getLaborCostEstimate(monthShifts, payrollMembers, rolesMap, memberStorePayrollsMap),
    };
  }, [canManageTenant, allShifts, shiftViewMonth, getLaborCostEstimate, payrollMembers, rolesMap, memberStorePayrollsMap]);

  // Perf: モーダル子コンポーネントの React.memo 効果を維持するため useCallback 化。
  // 依存は最小限 (DB 操作 fn + fetchRange/fetchPreferenceRange) のみ。setX 系 setter は安定参照のため依存に入れない。
  const handlePrefSubmit = useCallback(async (
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
    showToast(messages.toast.shiftPreferenceSubmitted, 'success');
  }, [submitPreference, fetchPreferenceRange, showToast]);

  const handlePrefDelete = useCallback(async (id: string) => {
    await deletePreference(id);
    setSelectedDate(null);
    fetchPreferenceRange();
    showToast(messages.toast.shiftPreferenceDeleted, 'success');
  }, [deletePreference, fetchPreferenceRange, showToast]);

  const handleApprovePreference = useCallback(async (id: string, startTime?: string, endTime?: string) => {
    await approvePreference(id, startTime, endTime);
    fetchPreferenceRange();
    fetchRange();
  }, [approvePreference, fetchPreferenceRange, fetchRange]);

  const handleRejectPreference = useCallback(async (id: string) => {
    await rejectPreference(id);
    fetchPreferenceRange();
  }, [rejectPreference, fetchPreferenceRange]);

  const handleRevertPreference = useCallback(async (id: string) => {
    await revertPreference(id);
    fetchPreferenceRange();
    fetchRange();
  }, [revertPreference, fetchPreferenceRange, fetchRange]);

  // 店長以上が空白セルから他メンバーのシフトを直接 INSERT (status=tentative)
  const handleAddShiftForMember = useCallback(async (
    date: string,
    userId: string,
    targetStoreId: string,
    startTime: string,
    endTime: string,
  ) => {
    await addShiftForMember(date, userId, targetStoreId, startTime, endTime);
    fetchRange();
    fetchPreferenceRange();
  }, [addShiftForMember, fetchRange, fetchPreferenceRange]);

  // Perf: モーダル側 (UnifiedShiftSidebar / DayDetailModal) の props identity を安定させるため、
  //   1) 個別 inline lambda (revert/restore/modify, canManageStore, onMutated, onShiftClick 等) を全部 useCallback 化
  //   2) onDateClick (PC/SP) も useCallback
  //   3) setSelectedDate は startTransition で wrap → click 即時反応 + state 更新を低優先度化
  // P1-3: 差し戻しは原子 RPC (revert_shift_to_tentative・055 改修) を呼んだ後、
  //   希望↔シフトの双方向同期を UI に反映するため preference / shift の両レンジを再取得する。
  //   (旧実装は revertShiftToTentative のみで preference を再取得せず、approved 希望が画面に残っていた)
  const handleRevertShiftToTentative = useCallback(async (id: string) => {
    try {
      await revertShiftToTentative(id);
      showToast('シフトを仮承認に差し戻しました', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'シフトの差し戻しに失敗しました';
      showToast(msg, 'error');
      throw e;
    } finally {
      fetchPreferenceRange();
      fetchRange();
    }
  }, [revertShiftToTentative, showToast, fetchPreferenceRange, fetchRange]);

  // Bug#1(2026-06-19): 仮承認シフト (tentative) を「申請中 (pending)」へ差し戻す cancel_shift_tentative も、
  //   他 mutation と同じく成功後に preference / shift の両レンジを再取得する必要がある。
  //   旧実装は生 cancelShiftTentative を props 直渡ししており、RPC が tentative→pending に更新しても
  //   allShifts/myShifts が stale tentative のまま残り、getLaborCostEstimate の COUNTABLE が拾い続けて
  //   人件費見込みに残存していた (= revert と同型の refetch ラッパーが欠けていた)。
  const handleCancelShiftTentative = useCallback(async (id: string) => {
    try {
      await cancelShiftTentative(id);
      showToast('申請中に差し戻しました', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'シフトの差し戻しに失敗しました';
      showToast(msg, 'error');
      throw e;
    } finally {
      fetchPreferenceRange();
      fetchRange();
    }
  }, [cancelShiftTentative, showToast, fetchPreferenceRange, fetchRange]);

  const handleRestoreShift = useCallback(async (id: string) => {
    await restoreShift(id);
  }, [restoreShift]);

  const handleModifyShift = useCallback((s: import('../types').Shift) => {
    setSelectedShift(s);
  }, []);

  const handleShiftClick = useCallback((shift: import('../types').Shift) => {
    setSelectedShift(shift);
  }, []);

  const handleCanManageStore = useCallback((sid: string | null | undefined) => {
    return sid ? isManagerOf(sid) : false;
  }, [isManagerOf]);

  const handleMutated = useCallback(() => {
    fetchPreferenceRange();
    fetchRange();
  }, [fetchPreferenceRange, fetchRange]);

  const handleQuickAdd = useCallback(() => {
    if (selectedDate) {
      setNewPreferenceDate(selectedDate);
      setSelectedDate(null);
    }
  }, [selectedDate]);

  // 自分の preference は時間変更モーダル、他人 + 当該店舗 manager は管理アクションモーダル、それ以外は no-op。
  const handlePreferenceClick = useCallback((p: import('../types').ShiftPreference) => {
    if (currentUserId && p.user_id === currentUserId) {
      setSelectedPreference(p);
    } else if (canManageTenant && p.store_id && isManagerOf(p.store_id)) {
      setAdminTargetPreference(p);
    }
  }, [currentUserId, canManageTenant, isManagerOf]);

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

  // PC ShiftCalendar / SP ShiftMobileCalendar から呼ばれる日付クリックハンドラ。
  // - bulk mode 中はトグル
  // - 通常は selectedDate を startTransition で更新 → DayDetailModal の重い再 render を低優先度化、
  //   click ハンドラ自体は即時 return → スクロール/ボタンの体感が改善する。
  const handleCalendarDateClick = useCallback((date: string) => {
    if (isBulkMode) {
      handleToggleBulkDate(date);
    } else {
      startTransition(() => {
        setSelectedDate(date);
      });
    }
  }, [isBulkMode, handleToggleBulkDate]);

  // §A-3: SP セルタップ = 即 BottomSheet 起動（二段階禁止）。
  // bulk 中は従来どおりトグル。通常は selectedDate（FAB 申請のデフォルト日付）も更新し
  // mobileSheetDate を直接セットしてシートを即起動する。
  const handleMobileCellOpen = useCallback((date: string) => {
    // 直前の横スワイプ成立から 350ms 以内のセルタップは抑止（二重発火防止 §E-4）。
    // boolean 永続フラグは pointercancel 経路で残留し正規タップを 1 回潰すため、時間窓方式を採用。
    if (Date.now() - lastSwipeAtRef.current < 350) {
      return;
    }
    if (isBulkMode) {
      handleToggleBulkDate(date);
      return;
    }
    setSelectedDate(date);
    setMobileSheetDate(date);
  }, [isBulkMode, handleToggleBulkDate]);

  // §E-4: 横スワイプ月送り（ライブラリ非依存・pointer 実装）。
  // X ドラッグ量が 60px を超え、かつ X が Y に対し優位なときのみ月送り。Y 優位は縦スクロール優先で無視。
  // 堅牢化: pointerId を追跡し、pointercancel をクリア。+N ボタン等のインタラクティブ要素起点は無視。
  // スワイプ成立時刻を ref に記録し、直後（350ms 以内）に発火するセル onClick を抑止して
  // 「月送り」と「セルタップ=BottomSheet 起動」の二重発火を防ぐ（時間窓方式・§E-4）。
  const swipeRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const lastSwipeAtRef = useRef(0);
  // 各日セルは role="button" を持つため除外セレクタに入れるとセル面スワイプ起点が記録されない（P1）。
  // [role="button"] は外し、実 button / リンク / フォーム要素（+N・FAB は実 button）のみ除外する。
  const isInteractiveTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return !!target.closest('button, a, input, select, textarea');
  };
  const handleSwipePointerDown = useCallback((e: ReactPointerEvent) => {
    if (isInteractiveTarget(e.target)) {
      swipeRef.current = null;
      return;
    }
    swipeRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  }, []);
  const handleSwipePointerUp = useCallback((e: ReactPointerEvent) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start || start.pointerId !== e.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      lastSwipeAtRef.current = Date.now();
      setShiftViewMonth((prev) => (dx < 0 ? addMonths(prev, 1) : subMonths(prev, 1)));
    }
  }, []);
  const handleSwipePointerCancel = useCallback(() => {
    swipeRef.current = null;
  }, []);

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

  // P1-5: for..of の直列 await (N+1) を撤去し、set-based RPC (approve_preferences(p_ids uuid[]))
  //   をフックラッパ経由で 1 回だけ呼ぶ。unavailable は RPC 側 (preference_type IN('preferred','available'))
  //   で対象外になるため、フロントでの個別フィルタは不要。fetch は完了後 1 回のみ。
  const handleBulkApprovePreferences = async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      const { approvedCount } = await approvePreferencesByIds(ids);
      if (approvedCount > 0) {
        showToast(`${approvedCount}件のシフト申請を承認しました`, 'success');
      } else {
        showToast('承認できるシフト申請がありませんでした', { tone: 'warning' });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '一括承認に失敗しました';
      showToast(msg, 'error');
    } finally {
      fetchPreferenceRange();
      fetchRange();
    }
  };

  // P1-5: 一括却下も set-based RPC (reject_preferences(p_ids uuid[])) を 1 回呼ぶ。
  const handleBulkRejectPreferences = async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      const { rejectedCount } = await rejectPreferencesByIds(ids);
      if (rejectedCount > 0) {
        showToast(`${rejectedCount}件のシフト申請を却下しました`, 'success');
      } else {
        showToast('却下できるシフト申請がありませんでした', { tone: 'warning' });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '一括却下に失敗しました';
      showToast(msg, 'error');
    } finally {
      fetchPreferenceRange();
      fetchRange();
    }
  };

  // 一括本承認の実処理（P2-5: 成功/失敗トーストを reject 側にパリティ。RPC 呼出・引数・後続 fetch は不変）。
  const runBulkApproveTentative = async (
    monthStart: string,
    monthEnd: string,
    count: number,
  ) => {
    if (!storeId) return;
    setBulkConfirmBusy(true);
    try {
      await finalApproveStoreShifts(tenantId, storeId, monthStart, monthEnd);
      showToast(`${count}件のシフトを本承認しました`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '一括本承認に失敗しました';
      showToast(msg, 'error');
    } finally {
      setBulkConfirmBusy(false);
      fetchRange();
    }
  };

  // 一括確認ダイアログの確定ハンドラ
  const handleBulkConfirm = async () => {
    if (!bulkConfirm) return;
    const payload = bulkConfirm;
    setBulkConfirm(null);
    if (payload.kind === 'approve') {
      await runBulkApproveTentative(payload.monthStart, payload.monthEnd, payload.count);
    } else {
      setBulkConfirmBusy(true);
      try {
        await handleBulkRejectPreferences(payload.ids);
      } finally {
        setBulkConfirmBusy(false);
      }
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

  const isCurrentPreferenceView = preferenceView === 'current';
  const isHistoryPreferenceView = preferenceView === 'history';

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

        {/* PC レイアウト: 統合 Card + Right rail */}
        {isCurrentPreferenceView && (
          <div className="hidden lg:block">
            <div className="lg:grid lg:grid-cols-[1fr_320px] lg:gap-5 lg:items-start">
              <main className="min-w-0">
                <Card padding="none" className="overflow-hidden">
            <div className="flex items-center gap-2 flex-wrap px-4 py-2.5">
              <div className="inline-flex items-center bg-stone-100 dark:bg-stone-800 rounded-[8px] p-[3px] self-start">
                <button
                  type="button"
                  onClick={() => setPreferenceView('current')}
                  aria-pressed={isCurrentPreferenceView}
                  className={`inline-flex items-center rounded-md px-2.5 py-[5px] text-[12px] font-medium motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    isCurrentPreferenceView
                      ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-50 shadow-sm'
                      : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
                  }`}
                >
                  現在
                </button>
                <button
                  type="button"
                  onClick={() => setPreferenceView('history')}
                  aria-pressed={isHistoryPreferenceView}
                  className={`inline-flex items-center rounded-md px-2.5 py-[5px] text-[12px] font-medium motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    isHistoryPreferenceView
                      ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-50 shadow-sm'
                      : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
                  }`}
                >
                  履歴
                </button>
              </div>

              {isCurrentPreferenceView && (
                <>
                  <div className="hidden sm:block w-px h-[20px] bg-stone-200 dark:bg-stone-700" aria-hidden="true" />
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShiftViewMonth(subMonths(shiftViewMonth, 1))}
                      aria-label="前月"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-500 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <div className="flex min-w-[80px] flex-col items-center">
                      <span className="text-base font-semibold text-stone-900 dark:text-stone-100 tabular-nums">
                        {format(shiftViewMonth, 'yyyy / MM')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShiftViewMonth(addMonths(shiftViewMonth, 1))}
                      aria-label="次月"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-500 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      <ChevronRight className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>

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
                  <div className="min-w-0 flex-1 sm:flex-none">
                    <ShiftStatusFilter
                      value={statusFilter}
                      onChange={setStatusFilter}
                      showPreferenceStatus={canManageTenant}
                      counts={{
                        pending_preference: pendingPreferenceCount,
                        unavailable_preference: unavailablePreferenceCount,
                        tentative: tentativeCount,
                        approved: approvedCount,
                      }}
                    />
                  </div>
                </>
              )}
            </div>

            {isCurrentPreferenceView && (
              <div className="border-t border-stone-100 dark:border-stone-700/60 flex flex-wrap items-center gap-2 px-4 py-2.5">
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

                <div className="flex-1" aria-hidden="true" />

                {canManageTenant && (() => {
                  // Iter 2-A (Worker A) / P1: 正典準拠順序 — 申請 → 本承認 → 却下。
                  // 「仮承認を一括本承認」: 表示中の月に含まれる shift.status === 'tentative' を一括で本承認する。
                  // - 097: N+1 解消。選択中の月の期間を渡す単一 RPC (approve_store_shifts_final) で一括本承認。
                  //   通知は RPC 側が per-item と同型 (shift_approved) で一括 INSERT するため、フロントの通知ループは撤去。
                  //   月スコープは RPC 側で date BETWEEN p_from AND p_to により保証 (他月は不可触)。
                  const monthStart = format(startOfMonth(shiftViewMonth), 'yyyy-MM-dd');
                  const monthEnd = format(endOfMonth(shiftViewMonth), 'yyyy-MM-dd');
                  const tentativeInRange = shifts.filter(
                    s => s.status === 'tentative' && s.date >= monthStart && s.date <= monthEnd
                  );
                  const tCount = tentativeInRange.length;
                  const handleBulkApproveTentative = () => {
                    if (tCount === 0) return;
                    if (!storeId) return;
                    setBulkConfirm({ kind: 'approve', count: tCount, monthStart, monthEnd });
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
                  // P1-5: 表示中の月の pending を ids に集約し、set-based RPC を 1 回呼ぶ。
                  const handleBulkRejectInRange = () => {
                    if (count === 0) return;
                    setBulkConfirm({ kind: 'reject', count, ids: pendingInRange.map(p => p.id) });
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
            )}

                  {deadlineInfo && !deadlineInfo.passed && (
                    <div className="border-t border-stone-100 dark:border-stone-700/60 px-4 py-3 bg-orange-50/60 dark:bg-orange-900/20">
                      <div role="status" aria-live="polite" className="flex items-start gap-3 border-l-4 border-orange-500 dark:border-orange-400 pl-3">
                        <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" aria-hidden="true" />
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-orange-700 dark:text-orange-100">
                            シフト申請の提出締切: {format(deadlineInfo.deadline, 'M月d日(E) HH:mm', { locale: ja })}
                          </p>
                          <p className="text-xs text-orange-700 dark:text-orange-200 mt-1 tabular-nums">
                            残り {deadlineInfo.remainingLabel}（{format(deadlineInfo.targetMonth, 'yyyy年M月', { locale: ja })} 分）
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {deadlineInfo && deadlineInfo.passed && (
                    <div className="border-t border-stone-100 dark:border-stone-700/60 px-4 py-3 bg-red-50/60 dark:bg-red-900/20">
                      <div role="status" aria-live="polite" className="flex items-start gap-3 border-l-4 border-red-500 dark:border-red-400 pl-3">
                        <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-red-700 dark:text-red-100">
                            締切過ぎ — 提出には管理者承認が必要です
                          </p>
                          <p className="text-xs text-red-700 dark:text-red-200 mt-1 tabular-nums">
                            {format(deadlineInfo.deadline, 'M月d日(E) HH:mm', { locale: ja })} に締め切られました（{format(deadlineInfo.targetMonth, 'yyyy年M月', { locale: ja })} 分）
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {(prefLoading || shiftLoading) && (
                    <div className="border-t border-stone-100 dark:border-stone-700/60 flex items-center justify-center py-6">
                      <Spinner size="md" label="読み込み中" showLabel />
                    </div>
                  )}

                <div className="border-t border-stone-100 dark:border-stone-700/60">
                  <ShiftCalendar
                    shifts={shifts}
                    preferences={preferencesForCalendar}
                    viewMode={shiftViewMode}
                    baseDate={shiftViewMonth}
                    onDateClick={handleCalendarDateClick}
                    onShiftClick={handleShiftClick}
                    onPreferenceClick={handlePreferenceClick}
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
                </Card>

                {storeId && isBulkMode && (
                  /* 理由: 一括選択モード active 状態の枠線強調 (例外③) */
                  <div
                    role="region"
                    aria-label="一括シフト申請 選択モード"
                    className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 flex-wrap rounded-md border border-blue-100 dark:border-blue-700 bg-blue-50 dark:bg-blue-800/30 px-3 py-2 static shadow-none"
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
              </main>

              <aside
                aria-label="シフトページ Right rail"
                className="lg:flex lg:flex-col lg:gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
              >
                {canManageTenant && payrollMembers.length > 0 && (
                  <LaborCostCard
                    members={payrollMembers}
                    roles={roles}
                    tentativeLaborEstimates={laborEstimates.tentative}
                    allLaborEstimates={laborEstimates.all}
                    targetMonth={shiftViewMonth}
                    payrollsMap={memberStorePayrollsMap}
                  />
                )}
              </aside>
            </div>
          </div>
        )}

        {isHistoryPreferenceView && (
          <div className="hidden lg:block">
            <Card padding="none" className="overflow-hidden">
              <div className="flex items-center gap-2 flex-wrap px-4 py-3">
                <div className="inline-flex items-center bg-stone-100 dark:bg-stone-800 rounded-[8px] p-[3px] self-start">
                  <button
                    type="button"
                    onClick={() => setPreferenceView('current')}
                    aria-pressed={isCurrentPreferenceView}
                    className={`inline-flex items-center rounded-md px-2.5 py-[5px] text-[12px] font-medium motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      isCurrentPreferenceView
                        ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-50 shadow-sm'
                        : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
                    }`}
                  >
                    現在
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreferenceView('history')}
                    aria-pressed={isHistoryPreferenceView}
                    className={`inline-flex items-center rounded-md px-2.5 py-[5px] text-[12px] font-medium motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      isHistoryPreferenceView
                        ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-50 shadow-sm'
                        : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
                    }`}
                  >
                    履歴
                  </button>
                </div>
              </div>
            </Card>
          </div>
        )}

        {isHistoryPreferenceView && (
          <div className="lg:hidden">
            <Card padding="none" className="overflow-hidden">
              <div className="flex items-center gap-2 flex-wrap px-4 py-3">
                <div className="inline-flex items-center bg-stone-100 dark:bg-stone-800 rounded-[8px] p-[3px] self-start">
                  <button
                    type="button"
                    onClick={() => setPreferenceView('current')}
                    aria-pressed={isCurrentPreferenceView}
                    className={`inline-flex items-center rounded-md px-2.5 py-[5px] text-[12px] font-medium motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      isCurrentPreferenceView
                        ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-50 shadow-sm'
                        : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
                    }`}
                  >
                    現在
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreferenceView('history')}
                    aria-pressed={isHistoryPreferenceView}
                    className={`inline-flex items-center rounded-md px-2.5 py-[5px] text-[12px] font-medium motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      isHistoryPreferenceView
                        ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-50 shadow-sm'
                        : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
                    }`}
                  >
                    履歴
                  </button>
                </div>
              </div>
            </Card>
          </div>
        )}

        {isCurrentPreferenceView && (
          <>
          <div className="lg:hidden">
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

              {/* SP モバイル UI（Google カレンダー風・統合フェーズ Engineer F 配線） */}
              <div className="lg:hidden flex flex-col gap-3">
                {/* ① sticky 月ヘッダ（月ラベル + 前後送り + 今日 + 曜日ヘッダ 一塊） */}
                <ShiftMobileMonthHeader
                  shiftViewMonth={shiftViewMonth}
                  onPrevMonth={() => setShiftViewMonth(subMonths(shiftViewMonth, 1))}
                  onNextMonth={() => setShiftViewMonth(addMonths(shiftViewMonth, 1))}
                  onToday={() => setShiftViewMonth(startOfMonth(new Date()))}
                />

                {/* ② StatusFilter（カレンダー直上に常設・横スクロール） */}
                <div className="-mx-1 px-1 overflow-x-auto">
                  <ShiftStatusFilter
                    value={statusFilter}
                    onChange={setStatusFilter}
                    showPreferenceStatus={canManageTenant}
                    counts={{
                      pending_preference: pendingPreferenceCount,
                      unavailable_preference: unavailablePreferenceCount,
                      tentative: tentativeCount,
                      approved: approvedCount,
                    }}
                  />
                </div>

                {/* ②-b まとめて申請ボタン（常設・FAB と並存／bulk 中は下部確定バーがあるので非表示） */}
                {storeId && !isBulkMode && (
                  <Button
                    variant="success"
                    size="lg"
                    fullWidth
                    iconLeft={<Plus className="w-4 h-4" />}
                    onClick={handleEnterBulkMode}
                    disabled={isDeadlinePassed && !canEditDeadline}
                    aria-label={messages.shiftPreference.bulk.entryButtonAria}
                  >
                    {messages.shiftPreference.bulk.entryButton}
                  </Button>
                )}

                {/* ③ 月グリッド（名前チップ化・横スワイプ対応ラッパー §E-4） */}
                <div
                  onPointerDown={handleSwipePointerDown}
                  onPointerUp={handleSwipePointerUp}
                  onPointerCancel={handleSwipePointerCancel}
                  style={{ touchAction: 'pan-y' }}
                >
                  <ShiftMobileCalendar
                    shiftViewMonth={shiftViewMonth}
                    shifts={shifts}
                    preferences={preferencesForCalendar}
                    currentUserId={currentUserId}
                    selectedDate={selectedDate}
                    selectedBulkDates={isBulkMode ? selectedBulkDates : undefined}
                    isBulkMode={isBulkMode}
                    statusFilter={statusFilter}
                    showPreferenceStatus={canManageTenant}
                    memberNames={memberNames}
                    roleTypeMap={spRoleTypeMap}
                    onDateClick={handleMobileCellOpen}
                    onOverflowClick={handleMobileCellOpen}
                  />
                </div>
              </div>

              {/* SP BottomSheet: Unified Sidebar inline component */}
              {!isDesktop && (
                <BottomSheet
                  isOpen={!!mobileSheetDate}
                  onClose={() => setMobileSheetDate(null)}
                  title={mobileSheetDate ? `${mobileSheetDate} のシフト・申請` : undefined}
                >
                  {mobileSheetDate && (
                    <>
                    {/* §D-1: カバレッジ判定ヘッダを Sidebar 直前に注入（UnifiedShiftSidebar 非改変）。
                        staff には店舗 allShifts を出せず myShifts だけでは「確定0名/未配置」と誤読されるため、
                        canManageTenant のときのみ描画する（P2-a・スコープ境界）。 */}
                    {canManageTenant && (
                      <ShiftDayCoverageHeader
                        date={mobileSheetDate}
                        shifts={allShifts}
                        currentUserId={currentUserId}
                      />
                    )}
                    <UnifiedShiftSidebar
                      mode={canManageTenant ? "manager" : "staff"}
                      currentUserId={currentUserId}
                      canManageTenant={canManageTenant}
                      allMembers={payrollMembers}
                      onAddShiftForMember={handleAddShiftForMember}
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
                      onCancelShiftTentative={handleCancelShiftTentative}
                      onRevertShiftToTentative={handleRevertShiftToTentative}
                      onRestoreShift={handleRestoreShift}
                      onModifyShift={handleModifyShift}
                      onDeleteShift={deleteShift}
                      onApprovePreference={handleApprovePreference}
                      onRejectPreference={handleRejectPreference}
                      onRevertPreference={handleRevertPreference}
                      onSubmitPreference={handlePrefSubmit}
                      onDeletePreference={handlePrefDelete}
                      canManageStore={handleCanManageStore}
                      presets={presets}
                      stores={stores}
                      defaultStoreId={storeId}
                      onMutated={handleMutated}
                      adminSummary={adminSummary}
                      preferenceSummary={preferenceSummary}
                      pendingPreferenceCount={pendingPreferenceCount}
                      isDeadlinePassed={isDeadlinePassed}
                      canBypassDeadline={canEditDeadline}
                    />
                    </>
                  )}
                </BottomSheet>
              )}

              {/* §E-6: bulk mode 中の確定 sticky バーのみ残す。通常時の各申請ボタンは FAB へ移管。 */}
              {isBulkMode && (
                <div className="lg:hidden mt-3 rounded-md px-3 py-3">
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
                </div>
              )}

              {/* §F-3: FAB + 申請メニュー（bulk 中は下部確定バーと競合回避のため非表示）。
                  PC では完全 unmount し、SP→PC リサイズ時の body scroll lock 残留を防ぐ（§H-2(2)）。 */}
              {!isDesktop && !isBulkMode && (
                <ShiftMobileFab
                  canManageTenant={canManageTenant}
                  disabled={isDeadlinePassed && !canEditDeadline}
                  onRequestPreference={() => setNewPreferenceDate(selectedDate ?? format(new Date(), 'yyyy-MM-dd'))}
                  onBulkRequest={handleEnterBulkMode}
                  onAddShift={canManageTenant ? () => setMobileSheetDate(selectedDate ?? format(new Date(), 'yyyy-MM-dd')) : undefined}
                />
              )}
            </div>
          </div>

            {isDesktop && (
              <DayDetailModal
                mode={canManageTenant ? "manager" : "staff"}
                currentUserId={currentUserId}
                canManageTenant={canManageTenant}
                allMembers={payrollMembers}
                onAddShiftForMember={handleAddShiftForMember}
                selectedDate={selectedDate}
                onSelectedDateChange={setSelectedDate}
                onQuickAdd={handleQuickAdd}
                shifts={canManageTenant ? allShifts : myShifts}
                preferences={canManageTenant ? allPreferences : myPreferences}
                myPreferences={myPreferences}
                memberNames={memberNames}
                storeNames={storeNames}
                onApproveShift={approveShift}
                onRejectShift={rejectShift}
                onTentativeApproveShift={tentativeApproveShift}
                onCancelShiftTentative={handleCancelShiftTentative}
                onRevertShiftToTentative={handleRevertShiftToTentative}
                onRestoreShift={handleRestoreShift}
                onModifyShift={handleModifyShift}
                onDeleteShift={deleteShift}
                onApprovePreference={handleApprovePreference}
                onRejectPreference={handleRejectPreference}
                onRevertPreference={handleRevertPreference}
                onSubmitPreference={handlePrefSubmit}
                onDeletePreference={handlePrefDelete}
                canManageStore={handleCanManageStore}
                presets={presets}
                stores={stores}
                defaultStoreId={storeId}
                onMutated={handleMutated}
                adminSummary={adminSummary}
                preferenceSummary={preferenceSummary}
                pendingPreferenceCount={pendingPreferenceCount}
                isDeadlinePassed={isDeadlinePassed}
                canBypassDeadline={canEditDeadline}
              />
            )}
          </>
          )}

          {isHistoryPreferenceView && (
            <>
              {canManageTenant && (
                <div className="mt-2">
                  <ShiftPreferenceAdminList
                    preferences={preferencesForAdminList}
                    shifts={allShifts}
                    memberNames={memberNames}
                    onApprove={handleApprovePreference}
                    onReject={handleRejectPreference}
                    onBulkApprove={handleBulkApprovePreferences}
                    onBulkReject={handleBulkRejectPreferences}
                    onRevert={handleRevertPreference}
                    onRefresh={fetchPreferenceRange}
                    stores={adminListStores}
                    historyMode
                    canManageStore={handleCanManageStore}
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
                    const eff = getEffectiveTime(pref, myOverrideShiftMap);
                    const showOverrideRow =
                      eff.isOverridden && !!pref.start_time && !!pref.end_time && !!eff.start && !!eff.end;
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
                            {pref.start_time && pref.end_time && !showOverrideRow && (
                              <span className="text-xs text-stone-500 dark:text-stone-300 tabular-nums">
                                {formatTimeRange(pref.start_time, pref.end_time, { separator: ' - ' })}
                              </span>
                            )}
                          </div>
                          {showOverrideRow && (
                            <div className="text-[11px] text-stone-500 dark:text-stone-300 leading-relaxed">
                              <div>
                                申請:{' '}
                                <span className="tabular-nums">
                                  {formatTimeRange(pref.start_time!, pref.end_time!, { separator: ' 〜 ' })}
                                </span>
                              </div>
                              <div>
                                確定:{' '}
                                <span className="tabular-nums font-semibold text-emerald-600 dark:text-emerald-200">
                                  {formatTimeRange(eff.start!, eff.end!, { separator: ' 〜 ' })}
                                </span>
                              </div>
                            </div>
                          )}
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
          onCancelTentative={handleCancelShiftTentative}
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
          canApprove={canManageTenant && !!selectedPreference.store_id && isManagerOf(selectedPreference.store_id)}
          onApprove={async (id) => {
            await handleApprovePreference(id);
            setSelectedPreference(null);
          }}
          onApproveWithTime={async (id, startTime, endTime) => {
            await handleApprovePreference(id, startTime, endTime);
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

      <ConfirmDialog
        open={bulkConfirm !== null}
        title={bulkConfirm?.kind === 'reject' ? 'シフト申請を一括却下' : 'シフトを一括本承認'}
        description={
          bulkConfirm?.kind === 'reject'
            ? `${bulkConfirm.count}件却下します。よろしいですか？`
            : bulkConfirm
              ? `${bulkConfirm.count}件を本承認します。よろしいですか？`
              : undefined
        }
        confirmLabel={bulkConfirm?.kind === 'reject' ? '却下する' : '本承認する'}
        variant={bulkConfirm?.kind === 'reject' ? 'danger' : 'normal'}
        loading={bulkConfirmBusy}
        onCancel={() => setBulkConfirm(null)}
        onConfirm={() => { void handleBulkConfirm(); }}
      />
    </div>
  );
}
