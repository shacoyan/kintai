import { useState, useEffect, useCallback, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, addWeeks } from 'date-fns';
import { Clock, History, CheckCircle2, Circle, XCircle, Loader2, Plus, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, Card, Badge, BottomSheet } from '../components/ui';
import type { BadgeTone } from '../components/ui';
import { useTenant } from '../hooks/useTenant';
import { useShift } from '../hooks/useShift';
import { useLeave } from '../hooks/useLeave';
import { useTenantAdmin } from '../hooks/useTenantAdmin';
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

interface PrefListStyle {
  Icon: LucideIcon;
  label: string;
  iconBox: string;
}

const PREF_LIST_STYLE: Record<ShiftPreferenceType, PrefListStyle> = {
  preferred: { Icon: CheckCircle2, label: '希望', iconBox: 'bg-primary-50 text-primary-700' },
  available: { Icon: Circle, label: '出勤可能', iconBox: 'bg-info-50 text-info-500' },
  unavailable: { Icon: XCircle, label: '出勤不可', iconBox: 'bg-warning-50 text-warning-500' },
};

export function ShiftPage() {
  const { currentTenant, myRole, isOwner } = useTenant();
  const tenantId = currentTenant?.id || '';
  const canManageTenant = myRole === 'owner' || myRole === 'manager';
  const { currentStore, stores, isManagerOf } = useStoreContext();
  const storeId = currentStore?.id ?? null;

  const { myShifts, allShifts, loading: shiftLoading, getMyShifts, getAllShifts, deleteShift, approveShift, rejectShift, modifyShift, bulkApprove, getLaborCostEstimate } = useShift(tenantId, storeId);
  const { myLeaves, allLeaves, loading: leaveLoading, getMyLeaves, getAllLeaves, submitLeave, cancelLeave, approveLeave, rejectLeave } = useLeave(tenantId);
  const { members, fetchMembers } = useTenantAdmin(tenantId);
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
    const base = canManageTenant && showAllMembersPrefs ? allPreferences : myPreferences;
    return base.filter(p => p.status !== 'rejected');
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

  const preferenceSummary = useMemo(() => {
    const active = myPreferences.filter((p) => p.status !== 'rejected');
    return {
      preferredCount: active.filter((p) => p.preference_type === 'preferred').length,
      availableCount: active.filter((p) => p.preference_type === 'available').length,
      unavailableCount: active.filter((p) => p.preference_type === 'unavailable').length,
    };
  }, [myPreferences]);

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
      fetchAllPreferences(start, end);
    } else {
      fetchMyPreferences(start, end);
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
    if (!canManageTenant || members.length === 0) return [];
    return getLaborCostEstimate(shifts, members);
  }, [canManageTenant, shifts, members, getLaborCostEstimate]);

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
              {tab.id === 'shift' && canManageTenant && pendingShifts.length > 0 && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
                  {pendingShifts.length}
                </span>
              )}
              {tab.id === 'preference' && canManageTenant && pendingPreferenceCount > 0 && (
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
            memberNames={canManageTenant ? memberNames : undefined}
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
              canManage={selectedShift.store_id ? isManagerOf(selectedShift.store_id) : false}
            />
          )}

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
                canManage={(sid) => sid ? isManagerOf(sid) : false}
              />

              <LaborCostSummary estimates={laborEstimates} />
            </>
          )}
        </div>
      )}

      {activeTab === 'preference' && (
        <div className="flex flex-col gap-4 pb-24">
          {prefLoading && (
            <div className="flex justify-center py-4">
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" aria-label="読み込み中" />
            </div>
          )}

          {/* 表示切替: 現在 / 履歴 */}
          <div className="inline-flex items-center gap-1 p-1 bg-neutral-100 rounded-md self-start">
            <button
              type="button"
              onClick={() => setPreferenceView('current')}
              aria-pressed={preferenceView === 'current'}
              className={`inline-flex items-center gap-1.5 px-3 h-9 text-xs font-semibold rounded transition-colors duration-120 focus-ring ${
                preferenceView === 'current'
                  ? 'bg-white text-primary-700 shadow-xs'
                  : 'bg-transparent text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              現在
            </button>
            <button
              type="button"
              onClick={() => setPreferenceView('history')}
              aria-pressed={preferenceView === 'history'}
              className={`inline-flex items-center gap-1.5 px-3 h-9 text-xs font-semibold rounded transition-colors duration-120 focus-ring ${
                preferenceView === 'history'
                  ? 'bg-white text-primary-700 shadow-xs'
                  : 'bg-transparent text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              履歴
            </button>
          </div>

          {preferenceView === 'current' && (
            <>
              {canManageTenant && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-neutral-500 tracking-wider">カレンダー表示:</span>
                  <button
                    type="button"
                    onClick={() => setShowAllMembersPrefs(false)}
                    aria-pressed={!showAllMembersPrefs}
                    className={`px-3 h-8 text-xs font-semibold rounded-md transition-colors duration-120 focus-ring ${
                      !showAllMembersPrefs
                        ? 'bg-primary-600 text-white'
                        : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                    }`}
                  >
                    自分の希望
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAllMembersPrefs(true)}
                    aria-pressed={showAllMembersPrefs}
                    className={`px-3 h-8 text-xs font-semibold rounded-md transition-colors duration-120 focus-ring ${
                      showAllMembersPrefs
                        ? 'bg-primary-600 text-white'
                        : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                    }`}
                  >
                    全員の希望
                  </button>
                </div>
              )}

              <ShiftPreferenceCalendar
                preferences={preferencesForCalendar}
                onDateClick={(date) => {
                  if (canManageTenant && showAllMembersPrefs) return;
                  setSelectedPrefDate(date);
                }}
                memberNames={canManageTenant && showAllMembersPrefs ? memberNames : undefined}
                canManageTenant={canManageTenant && showAllMembersPrefs}
              />

              {/* 提出予定サマリ（自分視点のみ） */}
              {!(canManageTenant && showAllMembersPrefs) && (
                <Card padding="md">
                  <Card.Body className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-2xl font-semibold text-neutral-900 tabular-nums">
                        {preferenceSummary.preferredCount}
                      </p>
                      <p className="text-[11px] text-neutral-500 mt-0.5">希望日</p>
                    </div>
                    <div className="border-x border-neutral-100">
                      <p className="text-2xl font-semibold text-neutral-900 tabular-nums">
                        {preferenceSummary.availableCount}
                      </p>
                      <p className="text-[11px] text-neutral-500 mt-0.5">出勤可</p>
                    </div>
                    <div>
                      <p className="text-2xl font-semibold text-neutral-900 tabular-nums">
                        {preferenceSummary.unavailableCount}
                      </p>
                      <p className="text-[11px] text-neutral-500 mt-0.5">出勤不可</p>
                    </div>
                  </Card.Body>
                </Card>
              )}

              {/* 時間指定の詳細リスト */}
              {!(canManageTenant && showAllMembersPrefs) && timedPreferences.length > 0 && (
                <Card padding="none">
                  <Card.Header className="border-b border-neutral-100 mb-0 pb-3 px-4 pt-4 text-sm font-semibold text-neutral-700">
                    時間指定の詳細
                  </Card.Header>
                  <ul className="divide-y divide-neutral-100">
                    {timedPreferences.map((p) => {
                      const style = PREF_LIST_STYLE[p.preference_type];
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedPrefDate(p.date)}
                            className="w-full px-4 py-3 flex items-center gap-3 hover:bg-neutral-50 text-left focus-ring"
                          >
                            <div className={`w-10 h-10 rounded-md flex flex-col items-center justify-center shrink-0 ${style.iconBox}`}>
                              <span className="text-[10px] font-semibold leading-none">{p.date.slice(5, 7)}/</span>
                              <span className="text-[14px] font-bold tabular-nums leading-none">{p.date.slice(8, 10)}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-neutral-900">{style.label}</p>
                              {p.start_time && p.end_time && (
                                <p className="text-xs text-neutral-500 tabular-nums">
                                  {p.start_time.slice(0, 5)} - {p.end_time.slice(0, 5)}
                                </p>
                              )}
                            </div>
                            <ChevronRight className="w-4 h-4 text-neutral-400" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              )}

              <BottomSheet
                isOpen={!!selectedPrefDate}
                onClose={() => setSelectedPrefDate(null)}
                title={selectedPrefDate ? `${selectedPrefDate} のシフト希望` : undefined}
              >
                {selectedPrefDate && (
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
                )}
              </BottomSheet>

              {canManageTenant && (
                <div className="mt-2">
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

              {/* sticky 追加ボタン（自分視点のみ） */}
              {!(canManageTenant && showAllMembersPrefs) && (
                <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-white/95 backdrop-blur border-t border-neutral-200 z-10">
                  <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    iconLeft={<Plus className="w-4 h-4" />}
                    onClick={() => setSelectedPrefDate(format(new Date(), 'yyyy-MM-dd'))}
                  >
                    本日の希望を追加・編集
                  </Button>
                </div>
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
                    onRefresh={fetchPreferenceRange}
                    historyMode
                    canManage={(sid) => sid ? isManagerOf(sid) : false}
                  />
                </div>
              )}

              {!canManageTenant && (
                <div className="flex flex-col gap-2">
                  {myPreferencesForHistory.length === 0 && (
                    <Card padding="md">
                      <p className="text-center text-sm text-neutral-500">履歴はありません</p>
                    </Card>
                  )}
                  {myPreferencesForHistory.map((pref) => {
                    const style = PREF_LIST_STYLE[pref.preference_type];
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
                            <span className="text-sm font-semibold text-neutral-900 tabular-nums">{pref.date}</span>
                            <Badge tone={statusTone} withDot>{statusLabel}</Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${style.iconBox}`}>
                              <style.Icon className="w-3 h-3" />
                              {style.label}
                            </span>
                            {pref.start_time && pref.end_time && (
                              <span className="text-xs text-neutral-500 tabular-nums">
                                {pref.start_time.slice(0, 5)} - {pref.end_time.slice(0, 5)}
                              </span>
                            )}
                          </div>
                          {pref.note && (
                            <p className="text-xs text-neutral-500">{pref.note}</p>
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
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            </div>
          )}

          {!canManageTenant && (
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
            memberNames={canManageTenant ? memberNames : undefined}
            canManageTenant={canManageTenant}
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
