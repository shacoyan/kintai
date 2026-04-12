import { useState } from 'react';
import type { LeaveRequest, LeaveType } from '../../types';

interface LeaveListProps {
  leaves: LeaveRequest[];
  memberNames?: Map<string, string>;
  isAdmin: boolean;
  onApprove: (leaveId: string) => Promise<void>;
  onReject: (leaveId: string) => Promise<void>;
  onCancel: (leaveId: string) => Promise<void>;
  onRefresh: () => void;
}

const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  paid: '有給',
  half_paid: '半休',
  absence: '欠勤',
  other: 'その他',
};

const LEAVE_TYPE_COLOR: Record<LeaveType, string> = {
  paid: 'bg-green-100 text-green-800',
  half_paid: 'bg-teal-100 text-teal-800',
  absence: 'bg-gray-100 text-gray-800',
  other: 'bg-purple-100 text-purple-800',
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: '申請中', className: 'bg-yellow-100 text-yellow-800' },
  approved: { label: '承認済', className: 'bg-green-100 text-green-800' },
  rejected: { label: '却下', className: 'bg-red-100 text-red-800' },
  cancelled: { label: '取消', className: 'bg-gray-100 text-gray-500' },
};

export function LeaveList({ leaves, memberNames, isAdmin, onApprove, onReject, onCancel, onRefresh }: LeaveListProps) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAction = async (action: () => Promise<void>) => {
    setProcessing(true);
    setError(null);
    try {
      await action();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作に失敗しました');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">休暇申請一覧</h2>
      </div>

      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="divide-y divide-gray-200">
        {leaves.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">休暇申請はありません</div>
        ) : (
          leaves.map((leave) => {
            const statusBadge = STATUS_BADGE[leave.status] || STATUS_BADGE.pending;
            const typeColor = LEAVE_TYPE_COLOR[leave.leave_type] || LEAVE_TYPE_COLOR.other;

            return (
              <div key={leave.id} className="px-6 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {memberNames && (
                      <span className="text-sm font-medium text-gray-900">
                        {memberNames.get(leave.user_id) || '不明'}
                      </span>
                    )}
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${typeColor}`}>
                      {LEAVE_TYPE_LABEL[leave.leave_type]}
                    </span>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge.className}`}>
                      {statusBadge.label}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500">{leave.date}</span>
                </div>

                {leave.reason && (
                  <p className="text-xs text-gray-500 mb-1">{leave.reason}</p>
                )}

                {leave.status === 'pending' && (
                  <div className="flex gap-1.5 mt-1">
                    {isAdmin ? (
                      <>
                        <button
                          onClick={() => handleAction(() => onApprove(leave.id))}
                          disabled={processing}
                          className="px-2.5 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50 transition"
                        >
                          承認
                        </button>
                        <button
                          onClick={() => handleAction(() => onReject(leave.id))}
                          disabled={processing}
                          className="px-2.5 py-1 text-xs font-medium text-red-600 bg-red-50 rounded hover:bg-red-100 disabled:opacity-50 transition"
                        >
                          却下
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleAction(() => onCancel(leave.id))}
                        disabled={processing}
                        className="px-2.5 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50 transition"
                      >
                        取り消し
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
