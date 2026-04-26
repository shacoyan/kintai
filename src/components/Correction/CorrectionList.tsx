import { format, parseISO } from 'date-fns';
import { FileEdit } from 'lucide-react';
import { CorrectionRequest } from '../../types';
import { Badge, Button, EmptyState } from '../ui';
import type { BadgeTone } from '../ui';

interface CorrectionListProps {
  requests: CorrectionRequest[];
  onReview?: (id: string, status: 'approved' | 'rejected') => void;
}

const statusConfig = {
  pending: { label: '承認待ち' },
  approved: { label: '承認済み' },
  rejected: { label: '却下' },
} as const;

const typeConfig = {
  correction: { label: '修正' },
  delete: { label: '削除' },
} as const;

function statusToTone(status: 'pending' | 'approved' | 'rejected'): BadgeTone {
  return status === 'approved' ? 'success' : status === 'pending' ? 'warning' : 'danger';
}

function typeToTone(type: 'correction' | 'delete'): BadgeTone {
  return type === 'delete' ? 'danger' : 'primary';
}

function formatTime(time: string | null): string {
  if (!time) return '-';
  try {
    return format(parseISO(time), 'HH:mm');
  } catch {
    return time.substring(0, 5);
  }
}

export function CorrectionList({ requests, onReview }: CorrectionListProps) {
  if (requests.length === 0) {
    return (
      <EmptyState
        icon={<FileEdit className="w-12 h-12 text-neutral-400 dark:text-neutral-500" />}
        title="修正申請はありません"
        description="履歴画面から打刻の修正を申請できます"
      />
    );
  }

  return (
    <>
      {/* モバイル: カード表示 */}
      <div className="sm:hidden divide-y divide-neutral-200 dark:divide-neutral-700">
        {requests.map((request) => {
          const statusCfg = statusConfig[request.status];
          const requestType = request.request_type || 'correction';
          const typeCfg = typeConfig[requestType];
          const statusTone = statusToTone(request.status);
          const typeTone = typeToTone(requestType);
          return (
            <div key={request.id} className="px-4 py-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{request.date}</span>
                <div className="flex gap-2">
                  <Badge tone={typeTone}>{typeCfg.label}</Badge>
                  <Badge tone={statusTone}>{statusCfg.label}</Badge>
                </div>
              </div>
              {requestType !== 'delete' && (
                <div className="flex gap-4 text-sm text-neutral-600 dark:text-neutral-400 tabular-nums">
                  <span>出勤: {formatTime(request.requested_clock_in)}</span>
                  <span>退勤: {formatTime(request.requested_clock_out)}</span>
                </div>
              )}
              <p className="text-sm text-neutral-700 dark:text-neutral-300">{request.reason}</p>
              {onReview && request.status === 'pending' && (
                <div className="flex gap-2 pt-1">
                  <Button variant="primary" size="sm" className="flex-1" onClick={() => onReview(request.id, 'approved')}>
                    承認
                  </Button>
                  <Button variant="danger" size="sm" className="flex-1" onClick={() => onReview(request.id, 'rejected')}>
                    却下
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* デスクトップ: テーブル表示 */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
          <thead className="bg-neutral-50 dark:bg-neutral-700">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">日付</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">種類</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">申請出勤</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">申請退勤</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">理由</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">ステータス</th>
              {onReview && (
                <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">操作</th>
              )}
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-700 tabular-nums">
            {requests.map((request) => {
              const statusCfg = statusConfig[request.status];
              const requestType = request.request_type || 'correction';
              const typeCfg = typeConfig[requestType];
              const statusTone = statusToTone(request.status);
              const typeTone = typeToTone(requestType);
              return (
                <tr key={request.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-neutral-900 dark:text-neutral-100 whitespace-nowrap">{request.date}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Badge tone={typeTone}>{typeCfg.label}</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-neutral-900 dark:text-neutral-100 whitespace-nowrap">
                    {requestType === 'delete' ? '-' : formatTime(request.requested_clock_in)}
                  </td>
                  <td className="px-4 py-3 text-sm text-neutral-900 dark:text-neutral-100 whitespace-nowrap">
                    {requestType === 'delete' ? '-' : formatTime(request.requested_clock_out)}
                  </td>
                  <td className="px-4 py-3 text-sm text-neutral-700 dark:text-neutral-300 max-w-xs truncate">{request.reason}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Badge tone={statusTone}>{statusCfg.label}</Badge>
                  </td>
                  {onReview && (
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {request.status === 'pending' ? (
                        <div className="flex gap-2">
                          <Button variant="primary" size="sm" onClick={() => onReview(request.id, 'approved')}>
                            承認
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => onReview(request.id, 'rejected')}>
                            却下
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-neutral-400 dark:text-neutral-500">-</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
