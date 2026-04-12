import { useState, useEffect, useCallback, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, addWeeks } from 'date-fns';
import { useTenant } from '../hooks/useTenant';
import { useShift } from '../hooks/useShift';
import { useLeave } from '../hooks/useLeave';
import { useAdmin } from '../hooks/useAdmin';
import { useShiftPreset } from '../hooks/useShiftPreset';
import { ShiftCalendar } from '../components/Shift/ShiftCalendar';
import { ShiftForm } from '../components/Shift/ShiftForm';
import { ShiftEditModal } from '../components/Shift/ShiftEditModal';
import { ShiftAdminPanel } from '../components/Shift/ShiftAdminPanel';
import { LaborCostSummary } from '../components/Shift/LaborCostSummary';
import { LeaveForm } from '../components/Leave/LeaveForm';
import { LeaveList } from '../components/Leave/LeaveList';

type TabId = 'shift' | 'leave';

export function ShiftPage() {
  const { currentTenant, myRole } = useTenant();
  const tenantId = currentTenant?.id || '';
  const isAdmin = myRole === 'owner' || myRole === 'admin';

  const { myShifts, allShifts, loading: shiftLoading, getMyShifts, getAllShifts, submitShift, deleteShift, approveShift, rejectShift, modifyShift, bulkApprove, getLaborCostEstimate } = useShift(tenantId);
  const { myLeaves, allLeaves, loading: leaveLoading, getMyLeaves, getAllLeaves, submitLeave, cancelLeave, approveLeave, rejectLeave } = useLeave(tenantId);
  const { members, fetchMembers } = useAdmin(tenantId);
  const { presets, fetchPresets } = useShiftPreset(tenantId);

  const [activeTab, setActiveTab] = useState<TabId>('shift');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedShift, setSelectedShift] = useState<import('../types').Shift | null>(null);
  const [showLeaveForm, setShowLeaveForm] = useState(false);

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

  useEffect(() => {
    if (tenantId) {
      fetchRange();
      fetchPresets();
    }
  }, [tenantId, fetchRange, fetchPresets]);

  const shifts = isAdmin ? allShifts : myShifts;
  const leaves = isAdmin ? allLeaves : myLeaves;

  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach(m => map.set(m.user_id, m.display_name));
    return map;
  }, [members]);

  const handleShiftSubmit = async (date: string, startTime: string, endTime: string, note?: string) => {
    await submitShift(date, startTime, endTime, note);
    setSelectedDate(null);
    fetchRange();
  };

  const handleLeaveSubmit = async (date: string, leaveType: 'paid' | 'half_paid' | 'absence' | 'other', reason?: string) => {
    await submitLeave(date, leaveType, reason);
    setShowLeaveForm(false);
    fetchRange();
  };

  const laborEstimates = useMemo(() => {
    if (!isAdmin || members.length === 0) return [];
    return getLaborCostEstimate(shifts, members);
  }, [isAdmin, shifts, members, getLaborCostEstimate]);

  const pendingShifts = shifts.filter(s => s.status === 'pending');

  if (!tenantId) return null;

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          {([
            { id: 'shift' as TabId, label: 'シフト' },
            { id: 'leave' as TabId, label: '休暇' },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
              {tab.id === 'shift' && isAdmin && pendingShifts.length > 0 && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                  {pendingShifts.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'shift' && (
        <div className="space-y-6">
          {(shiftLoading) && (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            </div>
          )}

          <ShiftCalendar
            shifts={shifts}
            onDateClick={(date) => setSelectedDate(date)}
            onShiftClick={(shift) => setSelectedShift(shift)}
            memberNames={isAdmin ? memberNames : undefined}
          />

          {selectedDate && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setSelectedDate(null)}>
              <div role="dialog" aria-modal="true" className="w-full max-w-md mx-4" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                <ShiftForm
                  date={selectedDate}
                  onSubmit={handleShiftSubmit}
                  onCancel={() => setSelectedDate(null)}
                  presets={presets}
                />
              </div>
            </div>
          )}

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
              />

              <LaborCostSummary estimates={laborEstimates} />
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
                  className="w-full px-4 py-3 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition border border-blue-200"
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
