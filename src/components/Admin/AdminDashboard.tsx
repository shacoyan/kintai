import { useState, useEffect, useCallback, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, addWeeks } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { MemberManagement } from './MemberManagement';
import { PayrollCalculation } from './PayrollCalculation';
import { AttendanceAdmin } from './AttendanceAdmin';
import { ActiveMembersCard } from './ActiveMembersCard';
import { useCorrection } from '../../hooks/useCorrection';
import { useLeave } from '../../hooks/useLeave';
import { useTenantAdmin } from '../../hooks/useTenantAdmin';
import { useTenant } from '../../hooks/useTenant';
import { useStoreContext } from '../../contexts/StoreContext';
import { CorrectionList } from '../Correction/CorrectionList';
import { LeaveList } from '../Leave/LeaveList';
import { RejectLeaveModal } from '../Leave/RejectLeaveModal';
import { BottomSheet } from '../ui/BottomSheet';
import { ShiftPresetManager } from './ShiftPresetManager';
import { StoreManagement } from './StoreManagement';
import { ShiftMismatchAlert } from './ShiftMismatchAlert';
import { ShiftDeadlineSettingsModal } from './ShiftDeadlineSettingsModal';
import { detectMismatches } from '../../utils/shiftMismatch';
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
  CalendarClock
} from 'lucide-react';
import { StatCard, Card, PageSkeleton, ErrorBanner, Button } from '../ui';
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
];

type TabId = typeof tabs[number]['id'];

const SECTIONS = [
  { label: '概要', items: ['dashboard'] },
  { label: 'メンバー管理', items: ['members'] },
  { label: '給与・勤怠', items: ['payroll', 'attendance', 'corrections', 'leaves', 'mismatch'] },
  { label: '設定', items: ['presets', 'stores'] },
] as const;

export function AdminDashboard({ tenantId }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [rejectingLeaveId, setRejectingLeaveId] = useState<string | null>(null);
  const [approveConfirm, setApproveConfirm] = useState<{ leaveId: string; userId: string } | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deadlineModalOpen, setDeadlineModalOpen] = useState(false);
  const { currentTenant, isOwner, myRole } = useTenant();
  const { currentStore } = useStoreContext();
  const canEditDeadline = isOwner || myRole === 'manager';
  const { requests, loading: correctionLoading, fetchRequests, reviewRequest } = useCorrection(tenantId);
  const { allLeaves, loading: leaveLoading, getAllLeaves, approveLeave, rejectLeave, getRemainingPaidLeave } = useLeave(tenantId);
  const { members: adminMembers, fetchMembers: fetchAdminMembers } = useTenantAdmin(tenantId);

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

      const [shiftsRes, attendanceRes] = await Promise.all([
        supabase
          .from('shifts')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('status', 'approved')
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: true }),
        supabase
          .from('attendance_records')
          .select('*')
          .eq('tenant_id', tenantId)
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: true })
          .order('clock_in', { ascending: true }),
      ]);

      if (shiftsRes.error) throw shiftsRes.error;
      if (attendanceRes.error) throw attendanceRes.error;

      setMismatchShifts((shiftsRes.data as Shift[]) || []);
      setMismatchAttendance((attendanceRes.data as AttendanceRecord[]) || []);
    } catch (err) {
      console.error('mismatch fetch error:', err);
    } finally {
      setMismatchLoading(false);
    }
  }, [tenantId]);

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
      const msg = err instanceof Error ? err.message : '申請の処理に失敗しました';
      setReviewError(msg);
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

            {currentTenant && (
              <Card>
                <Card.Header>
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center justify-center w-10 h-10 bg-neutral-100 dark:bg-neutral-700 rounded-lg">
                      <QrCode className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                    </div>
                    <div>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">招待コード（メンバーに共有してください）</p>
                      <p className="text-2xl font-mono font-bold tracking-widest text-neutral-900 dark:text-neutral-100">
                        {currentTenant.invite_code}
                      </p>
                    </div>
                  </div>
                </Card.Header>
                <Card.Body>
                  <button
                    onClick={handleCopyCode}
                    className="px-4 py-2 text-sm font-medium text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors dark:bg-primary-900/30 dark:text-primary-400 dark:hover:bg-primary-900/50 inline-flex items-center space-x-2"
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
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">修正申請（承認待ち）</h2>
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
                <CorrectionList requests={pendingRequests} onReview={handleReview} />
              )}
            </Card>

            {processedRequests.length > 0 && (
              <Card padding="none">
                <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-700">
                  <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">修正申請履歴</h2>
                </div>
                <CorrectionList requests={processedRequests} />
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
                    <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">シフト希望締切</h2>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
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
            <StoreManagement tenantId={tenantId} />
          </div>
        )}
        {activeTab === 'mismatch' && (
          <div className="space-y-4">
            <Card padding="md">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">シフト不一致アラート</h2>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                    今月の承認済みシフトと実績の差異を表示します（猶予15分）
                  </p>
                </div>
                <button
                  onClick={fetchMismatchData}
                  disabled={mismatchLoading}
                  className="px-3 py-1.5 text-sm font-medium text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors dark:bg-primary-900/30 dark:text-primary-400 dark:hover:bg-primary-900/50 disabled:opacity-50"
                >
                  {mismatchLoading ? '読み込み中...' : '再読込'}
                </button>
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
        <nav role="tablist" className="flex space-x-4 min-w-max" style={{ scrollSnapType: 'x mandatory' }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition ${
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300 dark:text-neutral-400 dark:hover:text-neutral-200'
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
      <div className="md:hidden" role="tabpanel">
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
                  {tabs.filter(tab => (section.items as readonly string[]).includes(tab.id)).map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      aria-current={activeTab === tab.id ? 'page' : undefined}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between transition-colors ${
                        activeTab === tab.id
                          ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400 font-semibold border-l-2 border-primary-600 dark:border-primary-400 rounded-l-none'
                          : 'text-neutral-600 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-800/60'
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
                  ))}
                </div>
              ))}
            </div>
          </Card>
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0" role="tabpanel">
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
    </div>
  );
}
