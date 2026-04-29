import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { logger } from '../../lib/logger';
import { format, startOfMonth, endOfMonth, addWeeks } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { formatSupabaseError } from '../../lib/errors';
import { MemberManagement } from './MemberManagement';
import { PayrollCalculation } from './PayrollCalculation';
import { AttendanceAdmin } from './AttendanceAdmin';
import { ActiveMembersCard } from './ActiveMembersCard';
import { useCorrection } from '../../hooks/useCorrection';
import { useLeave } from '../../hooks/useLeave';
import { useTenantAdmin } from '../../hooks/useTenantAdmin';
import { useUnsubmittedMembers } from '../../hooks/useUnsubmittedMembers';
import { useTenant, usePayrollCloseDay } from '../../hooks/useTenant';
import { useStoreContext } from '../../contexts/StoreContext';
import { useToast } from '../../contexts/ToastContext';
import { CorrectionList } from '../Correction/CorrectionList';
import { LeaveList } from '../Leave/LeaveList';
import { RejectLeaveModal } from '../Leave/RejectLeaveModal';
import { BottomSheet } from '../ui/BottomSheet';
import { ShiftPresetManager } from './ShiftPresetManager';
import { StoreManagement } from './StoreManagement';
import { ShiftMismatchAlert } from './ShiftMismatchAlert';
import { ShiftDeadlineSettingsModal } from './ShiftDeadlineSettingsModal';
import { AdminSettings } from './AdminSettings';
import { detectMismatches } from '../../utils/shiftMismatch';
import { useSearchParams } from 'react-router-dom';
import {
  QrCode,
  Check,
  Copy,
  LayoutDashboard,
  Users,
  Wallet,
  Clock,
  Edit3,
  Plane,
  Sliders,
  Store,
  AlertCircle,
  CalendarCheck,
  AlertTriangle,
  CalendarClock,
  UserX,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { StatCard, Card, PageSkeleton, ErrorBanner, Button, Heading } from '../ui';
import type { Shift, AttendanceRecord } from '../../types';

interface AdminDashboardProps {
  tenantId: string;
}

const tabs = [
  { id: 'dashboard' as const, label: 'ダッシュボード', icon: LayoutDashboard },
  { id: 'members' as const, label: 'メンバー', icon: Users },
  { id: 'payroll' as const, label: '給与', icon: Wallet },
  { id: 'attendance' as const, label: '勤怠', icon: Clock },
  { id: 'corrections' as const, label: '修正', icon: Edit3 },
  { id: 'leaves' as const, label: '休暇', icon: Plane },
  { id: 'presets' as const, label: 'プリセット', icon: Sliders },
  { id: 'stores' as const, label: '店舗', icon: Store },
  { id: 'mismatch' as const, label: '不一致', icon: AlertCircle },
  { id: 'settings' as const, label: '設定', icon: Settings },
];

type TabId = typeof tabs[number]['id'];

const SECTIONS = [
  { label: '概要', items: ['dashboard'] },
  { label: 'メンバー管理', items: ['members'] },
  { label: '給与・勤怠', items: ['payroll', 'attendance', 'corrections', 'leaves', 'mismatch'] },
  { label: '設定', items: ['presets', 'stores', 'settings'] },
] as const;

export function AdminDashboard({ tenantId }: AdminDashboardProps) {
  const [searchParams] = useSearchParams();
  const initialTab = (() => {
    const t = searchParams.get('tab');
    if (t && tabs.some(x => x.id === t)) return t as TabId;
    return 'dashboard';
  })();
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [rejectingLeaveId, setRejectingLeaveId] = useState<string | null>(null);
  const [approveConfirm, setApproveConfirm] = useState<{ leaveId: string; userId: string } | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deadlineModalOpen, setDeadlineModalOpen] = useState(false);
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const [regenLoading, setRegenLoading] = useState(false);

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [isPC, setIsPC] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)');
    setIsPC(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsPC(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const onTabKeyDown = useCallback((e: React.KeyboardEvent, idx: number) => {
    const enabledTabs = tabs;
    let nextIdx = idx;

    if (isPC && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      nextIdx = e.key === 'ArrowUp' ? (idx - 1 + enabledTabs.length) % enabledTabs.length : (idx + 1) % enabledTabs.length;
    } else if (!isPC && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      nextIdx = e.key === 'ArrowLeft' ? (idx - 1 + enabledTabs.length) % enabledTabs.length : (idx + 1) % enabledTabs.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIdx = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIdx = enabledTabs.length - 1;
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setActiveTab(enabledTabs[idx].id);
      return;
    } else {
      return;
    }

    const nextTab = enabledTabs[nextIdx];
    if (nextTab) {
      setActiveTab(nextTab.id);
      const targetIdx = nextIdx;
      requestAnimationFrame(() => {
        tabRefs.current[targetIdx]?.focus();
      });
    }
  }, [isPC]);

  const { currentTenant, isOwner, myRole, regenerateInviteCode } = useTenant();
  const { currentStore, stores } = useStoreContext();
  const storeNames = useMemo(() => new Map(stores.map(s => [s.id, s.name])), [stores]);
  const { showToast } = useToast();
  const canEditDeadline = isOwner || myRole === 'manager';
  // === Loop 7 (Engineer A) ===
  const {
    closeDay: payrollCloseDay,
    loading: closeDayLoading,
    updateCloseDay,
  } = usePayrollCloseDay(tenantId);
  const [localCloseDay, setLocalCloseDay] = useState<number>(payrollCloseDay);
  useEffect(() => {
    setLocalCloseDay(payrollCloseDay);
  }, [payrollCloseDay]);
  // === /Loop 7 (Engineer A) ===
  const { requests, loading: correctionLoading, fetchRequests, reviewRequest } = useCorrection(tenantId);
  const { allLeaves, loading: leaveLoading, getAllLeaves, approveLeave, rejectLeave, getRemainingPaidLeave } = useLeave(tenantId);
  const { members: adminMembers, fetchMembers: fetchAdminMembers } = useTenantAdmin(tenantId);

  // 未提出メンバー検出（次月分のシフト希望）
  const unsubmittedTargetMonth = useMemo(() => {
    const next = new Date();
    next.setMonth(next.getMonth() + 1);
    return startOfMonth(next);
  }, []);
  const { unsubmitted: unsubmittedMembers, loading: unsubmittedLoading } = useUnsubmittedMembers(
    tenantId,
    currentStore?.id ?? null,
    unsubmittedTargetMonth,
  );

  const leaveRange = useMemo(() => {
    const now = new Date();
    return {
      start: format(startOfMonth(addWeeks(now, -2)), 'yyyy-MM-dd'),
      end: format(endOfMonth(addWeeks(now, 4)), 'yyyy-MM-dd'),
    };
  }, []);

  const fetchLeaves = useCallback(() => {
    getAllLeaves(leaveRange.start, leaveRange.end);
    fetchAdminMembers();
  }, [getAllLeaves, leaveRange, fetchAdminMembers]);

  const leaveMemberNames = useMemo(() => {
    const map = new Map<string, string>();
    adminMembers.forEach(m => map.set(m.user_id, m.display_name));
    return map;
  }, [adminMembers]);

  const handleApproveLeave = async (leaveId: string) => {
    const leave = allLeaves.find(l => l.id === leaveId);
    if (!leave) return;
    if (leave.leave_type === 'paid' || leave.leave_type === 'half_am' || leave.leave_type === 'half_pm') {
      const remaining = await getRemainingPaidLeave(leave.user_id);
      const required = leave.leave_type === 'paid' ? 1 : 0.5;
      if (remaining < required) {
        setApproveConfirm({ leaveId, userId: leave.user_id });
        return;
      }
    }
    await approveLeave(leaveId);
  };
  const handleConfirmApprove = async () => {
    if (!approveConfirm) return;
    await approveLeave(approveConfirm.leaveId);
    setApproveConfirm(null);
    fetchLeaves();
  };
  const handleRejectSubmit = async (note: string) => {
    if (!rejectingLeaveId) return;
    await rejectLeave(rejectingLeaveId, note);
    fetchLeaves();
  };

  const pendingLeaves = allLeaves.filter(l => l.status === 'pending');

  const [mismatchShifts, setMismatchShifts] = useState<Shift[]>([]);
  const [mismatchAttendance, setMismatchAttendance] = useState<AttendanceRecord[]>([]);
  const [mismatchLoading, setMismatchLoading] = useState(false);

  const fetchMismatchData = useCallback(async () => {
    setMismatchLoading(true);
    try {
      const now = new Date();
      const startDate = format(startOfMonth(now), 'yyyy-MM-dd');
      const endDate = format(endOfMonth(now), 'yyyy-MM-dd');

      let shiftsQuery = supabase
        .from('shifts')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', 'approved')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });
      if (currentStore?.id) {
        shiftsQuery = shiftsQuery.eq('store_id', currentStore.id);
      }

      let attendanceQuery = supabase
        .from('attendance_records')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true })
        .order('clock_in', { ascending: true });
      if (currentStore?.id) {
        attendanceQuery = attendanceQuery.eq('store_id', currentStore.id);
      }

      const [shiftsRes, attendanceRes] = await Promise.all([shiftsQuery, attendanceQuery]);

      if (shiftsRes.error) throw shiftsRes.error;
      if (attendanceRes.error) throw attendanceRes.error;

      setMismatchShifts((shiftsRes.data as Shift[]) || []);
      setMismatchAttendance((attendanceRes.data as AttendanceRecord[]) || []);
    } catch (err) {
      logger.error('mismatch fetch error:', formatSupabaseError(err));
    } finally {
      setMismatchLoading(false);
    }
  }, [tenantId, currentStore?.id]);

  useEffect(() => {
    if (activeTab === 'mismatch') {
      fetchMismatchData();
    }
  }, [activeTab, fetchMismatchData]);

  const mismatches = useMemo(
    () => detectMismatches(mismatchShifts, mismatchAttendance),
    [mismatchShifts, mismatchAttendance],
  );

  const mismatchMemberNames = useMemo(() => {
    const map = new Map<string, string>();
    adminMembers.forEach(m => map.set(m.user_id, m.display_name));
    return map;
  }, [adminMembers]);

  const handleCopyCode = async () => {
    if (!currentTenant?.invite_code) return;
    try {
      await navigator.clipboard.writeText(currentTenant.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // HTTPS以外の環境ではclipboard APIが使えないため無視
    }
  };

  useEffect(() => {
    fetchRequests();
    fetchLeaves();
  }, [tenantId, fetchRequests, fetchLeaves]);

  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const processedRequests = requests.filter((r) => r.status !== 'pending');

  const handleReview = async (requestId: string, status: 'approved' | 'rejected') => {
    setReviewError(null);
    try {
      await reviewRequest(requestId, status);
    } catch (err) {
      setReviewError(formatSupabaseError(err).message);
    }
  };

  function renderContent() {
    return (
      <>
        {activeTab === 'dashboard' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                label="今月の総勤務時間"
                value={0}
                unit="h"
                icon={<Clock size={16} />}
                hint="集計準備中"
              />
              <StatCard
                label="アクティブメンバー"
                value={adminMembers.length}
                unit="名"
                icon={<Users size={16} />}
              />
              <StatCard
                label="シフト充足率"
                value={0}
                unit="%"
                icon={<CalendarCheck size={16} />}
                hint="集計準備中"
              />
              <StatCard
                label="未対応の修正申請"
                value={pendingRequests.length}
                unit="件"
                icon={<AlertTriangle size={16} />}
              />
            </div>

            <ActiveMembersCard
              tenantId={tenantId}
              storeId={currentStore?.id ?? null}
              memberNames={leaveMemberNames}
            />

            {/* 未提出メンバー Card: 0 件 / loading 中は非表示 */}
            {!unsubmittedLoading && unsubmittedMembers.length > 0 && (
              <Card padding="md">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <UserX className="w-5 h-5 text-warning-600" aria-hidden="true" />
                    <Heading level={3} as="h2">
                      シフト希望 未提出メンバー
                    </Heading>
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400">
                    {unsubmittedMembers.length}名
                  </span>
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-300 mb-3">
                  対象月（{format(unsubmittedTargetMonth, 'yyyy年M月')}）に希望提出がないメンバー一覧です。
                </p>
                <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {unsubmittedMembers.map((m) => (
                    <li key={m.user_id} className="flex items-center justify-between py-2">
                      <span className="text-sm text-neutral-800 dark:text-neutral-200">
                        {m.display_name}
                      </span>
                      <Button
                        variant="tertiary"
                        size="sm"
                        disabled
                        title="Loop 11 で通知基盤と統合予定"
                      >
                        リマインドする
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {currentTenant && (
              <Card>
                <Card.Header>
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center justify-center w-10 h-10 bg-neutral-100 dark:bg-neutral-700 rounded-lg">
                      <QrCode className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                    </div>
                    <div>
                      <p className="text-xs text-neutral-500 dark:text-neutral-300 mb-1">招待コード（メンバーに共有してください）</p>
                      <p className="text-xl sm:text-2xl font-mono font-bold tracking-wide break-all text-neutral-900 dark:text-neutral-100">
                        {currentTenant.invite_code}
                      </p>
                    </div>
                  </div>
                </Card.Header>
                <Card.Body>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopyCode}
                      className="px-4 py-2 text-sm font-medium text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100 motion-safe:transition-colors duration-120 ease-out-expo dark:bg-primary-900/30 dark:text-primary-400 dark:hover:bg-primary-900/50 inline-flex items-center space-x-2"
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4" />
                          <span>コピーしました</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          <span>コピー</span>
                        </>
                      )}
                    </button>
                    {isOwner && (
                      <Button
                        variant="secondary"
                        size="sm"
                        iconLeft={<RefreshCw size={14} />}
                        onClick={() => setRegenConfirmOpen(true)}
                      >
                        再発行
                      </Button>
                    )}
                  </div>
                </Card.Body>
              </Card>
            )}
            {/* TODO(Phase 3): useTenantAdmin 拡張で totalHours / fillRate を実値化 */}
          </div>
        )}
        {activeTab === 'members' && <MemberManagement tenantId={tenantId} />}
        {activeTab === 'payroll' && <PayrollCalculation tenantId={tenantId} />}
        {activeTab === 'attendance' && <AttendanceAdmin tenantId={tenantId} />}
        {activeTab === 'corrections' && (
          <div className="space-y-6">
            <Card padding="none">
              <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
                <Heading level={2}>修正申請（承認待ち）</Heading>
                {pendingRequests.length > 0 && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400">
                    {pendingRequests.length}件
                  </span>
                )}
              </div>
              {reviewError && (
                <ErrorBanner message={reviewError} />
              )}
              {correctionLoading ? (
                <PageSkeleton />
              ) : (
                <CorrectionList requests={pendingRequests} onReview={handleReview} storeNames={storeNames} />
              )}
            </Card>

            {processedRequests.length > 0 && (
              <Card padding="none">
                <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-700">
                  <Heading level={2}>修正申請履歴</Heading>
                </div>
                <CorrectionList requests={processedRequests} storeNames={storeNames} />
              </Card>
            )}
          </div>
        )}
        {activeTab === 'leaves' && (
          <div className="space-y-6">
            {leaveLoading ? (
              <PageSkeleton />
            ) : (
              <LeaveList
                leaves={allLeaves}
                memberNames={leaveMemberNames}
                storeNames={storeNames}
                canManageTenant={true}
                onApprove={handleApproveLeave}
                onReject={async (leaveId) => { setRejectingLeaveId(leaveId); }}
                onCancel={async () => {}}
                onRefresh={fetchLeaves}
              />
            )}
          </div>
        )}
        {activeTab === 'presets' && (
          <ShiftPresetManager tenantId={tenantId} storeId={currentStore?.id ?? null} />
        )}
        {activeTab === 'stores' && (
          <div className="space-y-4">
            {canEditDeadline && currentStore && (
              <Card padding="md">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <Heading level={3} as="h2">シフト希望締切</Heading>
                    <p className="text-xs text-neutral-500 dark:text-neutral-300 mt-0.5">
                      対象月（{format(startOfMonth(new Date()), 'yyyy年M月')}）の希望提出締切日時を設定します。
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    iconLeft={<CalendarClock size={16} />}
                    onClick={() => setDeadlineModalOpen(true)}
                  >
                    シフト希望締切を設定
                  </Button>
                </div>
              </Card>
            )}
            {/* === Loop 7 (Engineer A): 給与締め日設定 === */}
            {canEditDeadline && (
              <Card padding="md">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <Heading level={3} as="h2">給与締め日</Heading>
                    <p className="text-xs text-neutral-500 dark:text-neutral-300 mt-0.5">
                      毎月の給与計算における締め日（1〜31、31 は月末扱い）
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={localCloseDay}
                      onChange={(e) =>
                        setLocalCloseDay(Math.min(31, Math.max(1, Number(e.target.value))))
                      }
                      className="w-20 px-2 py-1 border rounded text-sm bg-white dark:bg-neutral-900 dark:border-neutral-700 dark:text-neutral-100"
                    />
                    <label className="flex items-center gap-1 text-sm text-neutral-700 dark:text-neutral-300">
                      <input
                        type="checkbox"
                        checked={localCloseDay === 31}
                        onChange={(e) => setLocalCloseDay(e.target.checked ? 31 : 30)}
                      />
                      月末
                    </label>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={closeDayLoading}
                      onClick={() => updateCloseDay(localCloseDay)}
                    >
                      保存
                    </Button>
                  </div>
                </div>
              </Card>
            )}
            <StoreManagement tenantId={tenantId} />
          </div>
        )}
        {activeTab === 'settings' && <AdminSettings tenantId={tenantId} />}

        {activeTab === 'mismatch' && (
          <div className="space-y-4">
            <Card padding="md">
              <div className="flex items-center justify-between">
                <div>
                  <Heading level={2}>シフト不一致アラート</Heading>
                  <p className="text-xs text-neutral-500 dark:text-neutral-300 mt-0.5">
                    対象: {currentStore?.name ?? '全店舗'}
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-300 mt-0.5">
                    今月の承認済みシフトと実績の差異を表示します（猶予15分）
                  </p>
                </div>
                <Button onClick={fetchMismatchData} loading={mismatchLoading} variant="secondary" size="sm">再読込</Button>
              </div>
            </Card>
            {mismatchLoading ? (
              <PageSkeleton />
            ) : (
              <ShiftMismatchAlert
                mismatches={mismatches}
                memberNames={mismatchMemberNames}
              />
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="space-y-6">
      {/* Mobile tabs - horizontal scroll */}
      <div className="md:hidden border-b border-neutral-200 dark:border-neutral-700 overflow-x-auto -mx-4 px-4">
        <nav role="tablist" className="flex space-x-1 min-w-max" style={{ scrollSnapType: 'x mandatory' }}>
          {tabs.map((tab, idx) => (
            <button
              key={tab.id}
              role="tab"
              id={`admin-tab-${tab.id}`}
              aria-controls={`admin-tabpanel-${tab.id}`}
              aria-selected={activeTab === tab.id}
              tabIndex={activeTab === tab.id ? 0 : -1}
              ref={(el) => { tabRefs.current[idx] = el; }}
              onKeyDown={(e) => onTabKeyDown(e, idx)}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap py-3 px-3 border-b-2 font-medium text-sm motion-safe:transition-colors duration-120 ease-out-expo ${
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300 dark:text-neutral-300 dark:hover:text-neutral-200'
              }`}
              style={{ scrollSnapAlign: 'start' }}
            >
              {tab.label}
              {tab.id === 'leaves' && pendingLeaves.length > 0 && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400">
                  {pendingLeaves.length}
                </span>
              )}
              {tab.id === 'corrections' && pendingRequests.length > 0 && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400">
                  {pendingRequests.length}
                </span>
              )}
              {tab.id === 'mismatch' && mismatches.length > 0 && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">
                  {mismatches.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Mobile content */}
      <div className="md:hidden" role="tabpanel" id={`admin-tabpanel-${activeTab}`} aria-labelledby={`admin-tab-${activeTab}`} tabIndex={0}>
        {renderContent()}
      </div>

      {/* Desktop layout - sidebar + content */}
      <div className="hidden md:flex gap-6">
        {/* Sidebar */}
        <nav className="md:w-[200px] shrink-0">
          <Card padding="sm" className="sticky top-20 dark:bg-neutral-900">
            <div className="space-y-1">
              {SECTIONS.map((section, sectionIndex) => (
                <div key={section.label}>
                  {sectionIndex > 0 && <div className="border-t border-neutral-100 dark:border-neutral-800 my-2" />}
                  <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider px-3 pt-3 pb-1">{section.label}</div>
                  {tabs.filter(tab => (section.items as readonly string[]).includes(tab.id)).map((tab) => {
                    const tabIdx = tabs.findIndex(t => t.id === tab.id);
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        role="tab"
                        id={`admin-tab-${tab.id}`}
                        aria-controls={`admin-tabpanel-${tab.id}`}
                        aria-selected={isActive}
                        tabIndex={isActive ? 0 : -1}
                        ref={(el) => { tabRefs.current[tabIdx] = el; }}
                        onKeyDown={(e) => onTabKeyDown(e, tabIdx)}
                        onClick={() => setActiveTab(tab.id)}
                        aria-current={isActive ? 'page' : undefined}
                        className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between motion-safe:transition-colors duration-120 ease-out-expo ${
                          isActive
                            ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400 font-semibold border-l-2 border-primary-600 dark:border-primary-400 rounded-l-none'
                            : 'text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800/60'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <tab.icon size={16} />
                          <span>{tab.label}</span>
                        </span>
                        {tab.id === 'leaves' && pendingLeaves.length > 0 && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400">
                            {pendingLeaves.length}
                          </span>
                        )}
                        {tab.id === 'corrections' && pendingRequests.length > 0 && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400">
                            {pendingRequests.length}
                          </span>
                        )}
                        {tab.id === 'mismatch' && mismatches.length > 0 && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">
                            {mismatches.length}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </Card>
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0" role="tabpanel" id={`admin-tabpanel-${activeTab}`} aria-labelledby={`admin-tab-${activeTab}`} tabIndex={0}>
          {renderContent()}
        </div>
      </div>

      {canEditDeadline && (
        <ShiftDeadlineSettingsModal
          open={deadlineModalOpen}
          onClose={() => setDeadlineModalOpen(false)}
          targetMonth={startOfMonth(new Date())}
        />
      )}
      <RejectLeaveModal
        isOpen={!!rejectingLeaveId}
        leaveId={rejectingLeaveId}
        onClose={() => setRejectingLeaveId(null)}
        onSubmit={handleRejectSubmit}
      />
      <BottomSheet
        isOpen={!!approveConfirm}
        onClose={() => setApproveConfirm(null)}
        title="有給残が不足しています"
        description="対象メンバーの有給残が不足していますが、承認しますか？"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setApproveConfirm(null)}>
              キャンセル
            </Button>
            <Button variant="primary" size="sm" onClick={handleConfirmApprove}>
              承認する
            </Button>
          </div>
        }
      >
        <div />
      </BottomSheet>
      <BottomSheet
        isOpen={regenConfirmOpen}
        onClose={() => setRegenConfirmOpen(false)}
        title='招待コードを再発行しますか？'
        description='現在のコードは無効になります。新しいコードを再共有してください。'
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setRegenConfirmOpen(false)}>
              キャンセル
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={regenLoading}
              onClick={async () => {
                setRegenLoading(true);
                try {
                  const code = await regenerateInviteCode();
                  showToast(`新しい招待コード: ${code}`, 'success');
                  setRegenConfirmOpen(false);
                } catch (e) {
                  showToast(formatSupabaseError(e).message, 'error');
                } finally {
                  setRegenLoading(false);
                }
              }}
            >
              再発行する
            </Button>
          </div>
        }
      >
        <div />
      </BottomSheet>
    </div>
  );
}
