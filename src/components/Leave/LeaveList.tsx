import { useState } from 'react';
import type { LeaveRequest, LeaveType } from '../../types';
import { CalendarOff } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Button } from '../ui/Button';

interface LeaveListProps {
  leaves: LeaveRequest[];
  memberNames?: Map<string, string>;
  canManageTenant: boolean;
  onApprove: (leaveId: string) => Promise<void>;
  onReject: (leaveId: string) => Promise<void>;
  onCancel: (leaveId: string) => Promise<void>;
  onRefresh: () => void;
}

const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  paid: '有給',
  half_am: 'AM半休',
  half_pm: 'PM半休',
  absence: '欠勤',
  other: 'その他',
};

const LEAVE_TYPE_COLOR: Record<LeaveType, string> = {
  paid: 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300',
  half_am: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
  half_pm: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
  absence: 'bg-neutral-100 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-200',
  other: 'bg-info-100 text-info-800 dark:bg-info-900/30 dark:text-info-300',
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: '申請中', className: 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-300' },
  approved: { label: '承認済', className: 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300' },
  rejected: { label: '却下', className: 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-300' },
  cancelled: { label: '取消', className: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400' },
};

export function LeaveList({ leaves, memberNames, canManageTenant, onApprove, onReject, onCancel, onRefresh }: LeaveListProps) {
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
    <div className="bg-white dark:bg-neutral-800 rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-700">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">休暇申請一覧</h2>
      </div>

      {error && (
        <div className="mx-6 mt-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
        {leaves.length === 0 ? (
          <div className="px-6 py-12">
            <EmptyState
              icon={<CalendarOff className="w-12 h-12 text-slate-400" />}
              title="休暇申請はありません"
              description="「休暇申請」ボタンから新規申請できます"
            />
          </div>
        ) : (
          leaves.map((leave) => {
            const statusBadge = STATUS_BADGE[leave.status] || STATUS_BADGE.pending;
            const typeColor = LEAVE_TYPE_COLOR[leave.leave_type] || LEAVE_TYPE_COLOR.other;

            return (
              <div key={leave.id} className="px-6 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {memberNames && (
                      <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
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
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">{leave.date}</span>
                </div>

                {leave.reason && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">{leave.reason}</p>
                )}

                {leave.status === 'rejected' && leave.review_note && (
                  <p className="text-xs text-danger-600 dark:text-danger-400 mb-1">却下理由: {leave.review_note}</p>
                )}

                {leave.status === 'pending' && (
                  <div className="flex gap-1.5 mt-1">
                    {canManageTenant ? (
                      <>
                        <Button
                          onClick={() => handleAction(() => onApprove(leave.id))}
                          disabled={processing}
                          variant="primary"
                          className="h-auto px-2.5 py-1 text-xs"
                        >
                          承認
                        </Button>
                        <Button
                          onClick={() => handleAction(() => onReject(leave.id))}
                          disabled={processing}
                          variant="danger"
                          className="h-auto px-2.5 py-1 text-xs"
                        >
                          却下
                        </Button>
                      </>
                    ) : (
                      <Button
                        onClick={() => handleAction(() => onCancel(leave.id))}
                        disabled={processing}
                        variant="tertiary"
                        className="h-auto px-2.5 py-1 text-xs"
                      >
                        取り消し
                      </Button>
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
