import { useState, useEffect, useCallback, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, addWeeks } from 'date-fns';
import { MemberManagement } from './MemberManagement';
import { PayrollCalculation } from './PayrollCalculation';
import { AttendanceAdmin } from './AttendanceAdmin';
import { useCorrection } from '../../hooks/useCorrection';
import { useLeave } from '../../hooks/useLeave';
import { useAdmin } from '../../hooks/useAdmin';
import { useTenant } from '../../hooks/useTenant';
import { CorrectionList } from '../Correction/CorrectionList';
import { LeaveList } from '../Leave/LeaveList';
import { ShiftPresetManager } from './ShiftPresetManager';
import { StoreManagement } from './StoreManagement';

interface AdminDashboardProps {
  tenantId: string;
}

const tabs = [
  { id: 'members', label: 'メンバー管理' },
  { id: 'payroll', label: '給与計算' },
  { id: 'attendance', label: '勤怠管理' },
  { id: 'corrections', label: '修正申請' },
  { id: 'leaves', label: '休暇管理' },
  { id: 'presets', label: 'シフトプリセット' },
  { id: 'stores', label: '店舗管理' },
] as const;

type TabId = typeof tabs[number]['id'];

export function AdminDashboard({ tenantId }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabId>('members');
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { currentTenant } = useTenant();
  const { requests, loading: correctionLoading, fetchRequests, reviewRequest } = useCorrection(tenantId);
  const { allLeaves, loading: leaveLoading, getAllLeaves, approveLeave, rejectLeave } = useLeave(tenantId);
  const { members: adminMembers, fetchMembers: fetchAdminMembers } = useAdmin(tenantId);

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

  const pendingLeaves = allLeaves.filter(l => l.status === 'pending');

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
        {activeTab === 'members' && <MemberManagement tenantId={tenantId} />}
        {activeTab === 'payroll' && <PayrollCalculation tenantId={tenantId} />}
        {activeTab === 'attendance' && <AttendanceAdmin tenantId={tenantId} />}
        {activeTab === 'corrections' && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">修正申請（承認待ち）</h2>
                {pendingRequests.length > 0 && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                    {pendingRequests.length}件
                  </span>
                )}
              </div>
              {reviewError && (
                <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-md dark:bg-red-900/20 dark:border-red-800">
                  <p className="text-sm text-red-600 dark:text-red-400">{reviewError}</p>
                </div>
              )}
              {correctionLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                </div>
              ) : (
                <CorrectionList requests={pendingRequests} onReview={handleReview} />
              )}
            </div>

            {processedRequests.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">修正申請履歴</h2>
                </div>
                <CorrectionList requests={processedRequests} />
              </div>
            )}
          </div>
        )}
        {activeTab === 'leaves' && (
          <div className="space-y-6">
            {leaveLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              </div>
            ) : (
              <LeaveList
                leaves={allLeaves}
                memberNames={leaveMemberNames}
                isAdmin={true}
                onApprove={approveLeave}
                onReject={rejectLeave}
                onCancel={async () => {}}
                onRefresh={fetchLeaves}
              />
            )}
          </div>
        )}
        {activeTab === 'presets' && (
          <ShiftPresetManager tenantId={tenantId} />
        )}
        {activeTab === 'stores' && (
          <StoreManagement tenantId={tenantId} />
        )}
      </>
    );
  }

  return (
    <div className="space-y-6">
      {currentTenant && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">招待コード（メンバーに共有してください）</p>
            <p className="text-2xl font-mono font-bold tracking-widest text-gray-900 dark:text-gray-100">
              {currentTenant.invite_code}
            </p>
          </div>
          <button
            onClick={handleCopyCode}
            className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
          >
            {copied ? 'コピーしました' : 'コピー'}
          </button>
        </div>
      )}

      {/* Mobile tabs - horizontal scroll */}
      <div className="md:hidden border-b border-gray-200 dark:border-gray-700 overflow-x-auto -mx-4 px-4">
        <nav className="flex space-x-4 min-w-max">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {tab.label}
              {tab.id === 'leaves' && pendingLeaves.length > 0 && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                  {pendingLeaves.length}
                </span>
              )}
              {tab.id === 'corrections' && pendingRequests.length > 0 && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                  {pendingRequests.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Mobile content */}
      <div className="md:hidden">
        {renderContent()}
      </div>

      {/* Desktop layout - sidebar + content */}
      <div className="hidden md:flex gap-6">
        {/* Sidebar */}
        <nav className="w-48 shrink-0">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-2 sticky top-20 space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium border-l-2 border-blue-600 dark:border-blue-400 rounded-l-none'
                    : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700'
                }`}
              >
                <span>{tab.label}</span>
                {tab.id === 'leaves' && pendingLeaves.length > 0 && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                    {pendingLeaves.length}
                  </span>
                )}
                {tab.id === 'corrections' && pendingRequests.length > 0 && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                    {pendingRequests.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
