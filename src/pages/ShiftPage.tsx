import { useState, useEffect, useCallback, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, addWeeks } from 'date-fns';
import { Clock, History, CheckCircle2, Circle, XCircle } from 'lucide-react';
import { useTenant } from '../hooks/useTenant';
import { useShift } from '../hooks/useShift';
import { useLeave } from '../hooks/useLeave';
import { useAdmin } from '../hooks/useAdmin';
import { useShiftPreset } from '../hooks/useShiftPreset';
import { useShiftPreference } from '../hooks/useShiftPreference';
import { ShiftCalendar } from '../components/Shift/ShiftCalendar';
import { ShiftEditModal } from '../components/Shift/ShiftEditModal';
import { ShiftAdminPanel } from '../components/Shift/ShiftAdminPanel';
import { LaborCostSummary } from '../components/Shift/LaborCostSummary';
import { LeaveForm } from '../components/Leave/LeaveForm';
import { LeaveList } from '../components/Leave/LeaveList';
import { ShiftPreferenceCalendar } from '../components/Shift/ShiftPreferenceCalendar';
import { ShiftPreferenceForm } from '../components/Shift/ShiftPreferenceForm';
import { ShiftPreferenceAdminList } from '../components/Shift/ShiftPreferenceAdminList';
import { useStoreContext } from '../contexts/StoreContext';
import type { ShiftPreferenceType } from '../types';

type TabId = 'shift' | 'leave' | 'preference';
type PreferenceView = 'current' | 'history';

export function ShiftPage() {
  const { currentTenant, myRole, isOwner } = useTenant();
  const tenantId = currentTenant?.id || '';
  const isAdmin = myRole === 'owner' || myRole === 'manager';
  const { currentStore, stores, isManagerOf } = useStoreContext();
  const storeId = currentStore?.id ?? null;

  const { myShifts, allShifts, loading: shiftLoading, getMyShifts, getAllShifts, deleteShift, approveShift, rejectShift, modifyShift, bulkApprove, getLaborCostEstimate } = useShift(tenantId, storeId);
  const { myLeaves, allLeaves, loading: leaveLoading, getMyLeaves, getAllLeaves, submitLeave, cancelLeave, approveLeave, rejectLeave } = useLeave(tenantId);
  const { members, fetchMembers } = useAdmin(tenantId);
  const { presets, fetchPresets } = useShiftPreset(tenantId, storeId);
  const { myPreferences, allPreferences, loading: prefLoading, fetchMyPreferences, fetchAllPreferences, submitPreference, deletePreference, approvePreference, rejectPreference } = useShiftPreference(tenantId, storeId);

  const [activeTab, setActiveTab] = useState<TabId>('shift');
  const [selectedShift, setSelectedShift] = useState<import('../types').Shift | null>(null);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [selectedPrefDate, setSelectedPrefDate] = useState<string | null>(null);
  const [showAllMembersPrefs, setShowAllMembersPrefs] = useState(false);
  const [preferenceView, setPreferenceView] = useState<PreferenceView>('current');

  const pendingPreferenceCount = useMemo(
    () => allPreferences.filter(p => p.status === 'pending').length,
    [allPreferences]
  );

  const preferencesForCalendar = useMemo(() => {
    const base = isAdmin && showAllMembersPrefs ? allPreferences : myPreferences;
    return base.filter(p => p.status !== 'rejected');
  }, [isAdmin, showAllMembersPrefs, allPreferences, myPreferences]);

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

  const fetchRange = useCallback(() => {
    const now = new Date();
    const start = format(startOfMonth(addWeeks(now, -2)), 'yyyy-MM-dd');
    const end = format(endOfMonth(addWeeks(now, 4)), 'yyyy-MM-dd');
    if (isAdmin) {
      getAllShifts(start, end);
      getAllLeaves(start, end);
      fetchMembers();
    } else {
      getMyShifts(start, end);
      getMyLeaves(start, end);
    }
  }, [isAdmin, getAllShifts, getAllLeaves, getMyShifts, getMyLeaves, fetchMembers]);

  const fetchPreferenceRange = useCallback(() => {
    const now = new Date();
    const start = format(startOfMonth(now), 'yyyy-MM-dd');
    const end = format(endOfMonth(addWeeks(now, 4)), 'yyyy-MM-dd');
    if (isAdmin) {
      fetchAllPreferences(start, end);
    } else {
      fetchMyPreferences(start, end);
    }
  }, [isAdmin, fetchAllPreferences, fetchMyPreferences]);

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

  const shifts = isAdmin ? allShifts : myShifts;
  const leaves = isAdmin ? allLeaves : myLeaves;

  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach(m => map.set(m.user_id, m.display_name));
    return map;
  }, [members]);

  const handleLeaveSubmit = async (date: string, leaveType: 'paid' | 'half_paid' | 'absence' | 'other', reason?: string) => {
    await submitLeave(date, leaveType, reason);
    setShowLeaveForm(false);
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

  const laborEstimates = useMemo(() => {
    if (!isAdmin || members.length === 0) return [];
    return getLaborCostEstimate(shifts, members);
  }, [isAdmin, shifts, members, getLaborCostEstimate]);

  const pendingShifts = shifts.filter(s => s.status === 'pending');

  if (!tenantId) return null;

  if (!storeId) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-center">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            店舗を選択してください。ヘッダーの店舗セレクターから操作対象の店舗を選ぶと、シフト・希望が表示されます。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-8">
          {([
            { id: 'shift' as TabId, label: 'シフト' },
            { id: 'leave' as TabId, label: '休暇' },
            { id: 'preference' as TabId, label: '希望' },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              {tab.label}
              {tab.id === 'shift' && isAdmin && pendingShifts.length > 0 && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
                  {pendingShifts.length}
                </span>
              )}
              {tab.id === 'preference' && isAdmin && pendingPreferenceCount > 0 && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
                  {pendingPreferenceCount}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'shift' && (
        <div className="space-y-6">
          {shiftLoading && (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            </div>
          )}

          <ShiftCalendar
            shifts={shifts}
            onDateClick={() => {}}
            onShiftClick={(shift) => setSelectedShift(shift)}
            memberNames={isAdmin ? memberNames : undefined}
          />

          {selectedShift && isAdmin && (
            <ShiftEditModal
              shift={selectedShift}
              memberName={memberNames.get(selectedShift.user_id)}
              isAdmin={isAdmin}
              onModify={modifyShift}
              onDelete={deleteShift}
              onApprove={approveShift}
              onReject={rejectShift}
              onClose={() => setSelectedShift(null)}
              onRefresh={fetchRange}
              selectableStores={isOwner ? stores : stores.filter(s => isManagerOf(s.id))}
              storeName={stores.find(s => s.id === selectedShift.store_id)?.name}
              canManage={selectedShift.store_id ? isManagerOf(selectedShift.store_id) : false}
            />
          )}

          {isAdmin && (
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
                canManage={(sid) => sid ? isManagerOf(sid) : false}
              />

              <LaborCostSummary estimates={laborEstimates} />
            </>
          )}
        </div>
      )}

      {activeTab === 'preference' && (
        <div className="space-y-4">
          {prefLoading && (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPreferenceView('current')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition ${
                preferenceView === 'current'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              現在
            </button>
            <button
              onClick={() => setPreferenceView('history')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition ${
                preferenceView === 'history'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              履歴
            </button>
          </div>

          {preferenceView === 'current' && (
            <>
              {isAdmin && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 dark:text-gray-400">カレンダー表示:</span>
                  <button
                    onClick={() => setShowAllMembersPrefs(false)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                      !showAllMembersPrefs
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    自分の希望
                  </button>
                  <button
                    onClick={() => setShowAllMembersPrefs(true)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                      showAllMembersPrefs
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    全員の希望
                  </button>
                </div>
              )}

              <ShiftPreferenceCalendar
                preferences={preferencesForCalendar}
                onDateClick={(date) => {
                  if (isAdmin && showAllMembersPrefs) return;
                  setSelectedPrefDate(date);
                }}
                memberNames={isAdmin && showAllMembersPrefs ? memberNames : undefined}
                isAdmin={isAdmin && showAllMembersPrefs}
              />

              {selectedPrefDate && (
                <div
                  className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
                  onClick={() => setSelectedPrefDate(null)}
                >
                  <div
                    role="dialog"
                    aria-modal="true"
                    className="w-full max-w-md mx-4"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  >
                    <ShiftPreferenceForm
                      date={selectedPrefDate}
                      existingPreference={myPreferences.find((p) => p.date === selectedPrefDate)}
                      onSubmit={handlePrefSubmit}
                      onDelete={handlePrefDelete}
                      onCancel={() => setSelectedPrefDate(null)}
                      presets={presets}
                      selectableStores={stores}
                      defaultStoreId={storeId}
                    />
                  </div>
                </div>
              )}

              {isAdmin && (
                <div className="mt-4">
                  <ShiftPreferenceAdminList
                    preferences={preferencesForAdminList}
                    memberNames={memberNames}
                    onApprove={handleApprovePreference}
                    onReject={handleRejectPreference}
                    onRefresh={fetchPreferenceRange}
                    historyMode={false}
                    canManage={(sid) => sid ? isManagerOf(sid) : false}
                  />
                </div>
              )}
            </>
          )}

          {preferenceView === 'history' && (
            <>
              {isAdmin && (
                <div className="mt-4">
                  <ShiftPreferenceAdminList
                    preferences={preferencesForAdminList}
                    memberNames={memberNames}
                    onApprove={handleApprovePreference}
                    onReject={handleRejectPreference}
                    onRefresh={fetchPreferenceRange}
                    historyMode
                    canManage={(sid) => sid ? isManagerOf(sid) : false}
                  />
                </div>
              )}

              {!isAdmin && (
                <div className="space-y-3">
                  {myPreferencesForHistory.length === 0 && (
                    <div className="text-center text-sm text-gray-500 dark:text-gray-400 py-8">
                      履歴はありません
                    </div>
                  )}
                  {myPreferencesForHistory.map((pref) => {
                    const borderClass = pref.status === 'pending'
                      ? 'border-yellow-300 dark:border-yellow-700'
                      : pref.status === 'approved'
                      ? 'border-green-300 dark:border-green-700'
                      : 'border-gray-300 dark:border-gray-600';

                    const typeIcon = pref.preference_type === 'available'
                      ? <CheckCircle2 className="w-4 h-4 text-green-500" />
                      : pref.preference_type === 'preferred'
                      ? <Circle className="w-4 h-4 text-blue-500" />
                      : <XCircle className="w-4 h-4 text-gray-400" />;
                    
                    const typeLabel = pref.preference_type === 'available'
                      ? '勤務可'
                      : pref.preference_type === 'preferred'
                      ? '勤務希望'
                      : '勤務不可';

                    const statusBadge = pref.status === 'pending'
                      ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">未対応</span>
                      : pref.status === 'approved'
                      ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">承認済</span>
                      : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">却下済</span>;

                    return (
                      <div key={pref.id} className={`rounded-lg border p-3 ${borderClass}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{pref.date}</span>
                          {statusBadge}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          {typeIcon}
                          <span className="text-sm text-gray-700 dark:text-gray-300">{typeLabel}</span>
                        </div>
                        {pref.start_time && pref.end_time && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {pref.start_time} - {pref.end_time}
                          </div>
                        )}
                        {pref.note && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {pref.note}
                          </div>
                        )}
                      </div>
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
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            </div>
          )}

          {!isAdmin && (
            <div>
              {showLeaveForm ? (
                <LeaveForm
                  onSubmit={handleLeaveSubmit}
                  onCancel={() => setShowLeaveForm(false)}
                />
              ) : (
                <button
                  onClick={() => setShowLeaveForm(true)}
                  className="w-full px-4 py-3 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition border border-blue-200 dark:border-blue-800"
                >
                  + 休暇申請
                </button>
              )}
            </div>
          )}

          <LeaveList
            leaves={leaves}
            memberNames={isAdmin ? memberNames : undefined}
            isAdmin={isAdmin}
            onApprove={approveLeave}
            onReject={rejectLeave}
            onCancel={cancelLeave}
            onRefresh={fetchRange}
          />
        </div>
      )}
    </div>
  );
}
