import { format, parseISO } from 'date-fns';
import { FileEdit } from 'lucide-react';
import { CorrectionRequest } from '../../types';
import { EmptyState } from '../ui/EmptyState';

interface CorrectionListProps {
  requests: CorrectionRequest[];
  onReview?: (id: string, status: 'approved' | 'rejected') => void;
}

const statusConfig = {
  pending: { label: '承認待ち', bgClass: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200' },
  approved: { label: '承認済み', bgClass: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200' },
  rejected: { label: '却下', bgClass: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200' },
} as const;

const typeConfig = {
  correction: { label: '修正', bgClass: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200' },
  delete: { label: '削除', bgClass: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200' },
} as const;

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
        icon={<FileEdit className="w-12 h-12 text-slate-400 dark:text-slate-500" />}
        title="修正申請はありません"
        description="履歴画面から打刻の修正を申請できます"
      />
    );
  }

  return (
    <>
      {/* モバイル: カード表示 */}
      <div className="sm:hidden divide-y divide-gray-200 dark:divide-gray-700">
        {requests.map((request) => {
          const statusCfg = statusConfig[request.status];
          const requestType = request.request_type || 'correction';
          const typeCfg = typeConfig[requestType];
          return (
            <div key={request.id} className="px-4 py-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{request.date}</span>
                <div className="flex gap-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeCfg.bgClass}`}>
                    {typeCfg.label}
                  </span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.bgClass}`}>
                    {statusCfg.label}
                  </span>
                </div>
              </div>
              {requestType !== 'delete' && (
                <div className="flex gap-4 text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                  <span>出勤: {formatTime(request.requested_clock_in)}</span>
                  <span>退勤: {formatTime(request.requested_clock_out)}</span>
                </div>
              )}
              <p className="text-sm text-gray-700 dark:text-gray-300">{request.reason}</p>
              {onReview && request.status === 'pending' && (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => onReview(request.id, 'approved')}
                    className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-green-600 dark:bg-green-700 rounded hover:bg-green-700 dark:hover:bg-green-600 transition-colors"
                  >
                    承認
                  </button>
                  <button
                    onClick={() => onReview(request.id, 'rejected')}
                    className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 dark:bg-red-700 rounded hover:bg-red-700 dark:hover:bg-red-600 transition-colors"
                  >
                    却下
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* デスクトップ: テーブル表示 */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">日付</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">種類</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">申請出勤</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">申請退勤</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">理由</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">ステータス</th>
              {onReview && (
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">操作</th>
              )}
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700 tabular-nums">
            {requests.map((request) => {
              const statusCfg = statusConfig[request.status];
              const requestType = request.request_type || 'correction';
              const typeCfg = typeConfig[requestType];
              return (
                <tr key={request.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">{request.date}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${typeCfg.bgClass}`}>
                      {typeCfg.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">
                    {requestType === 'delete' ? '-' : formatTime(request.requested_clock_in)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">
                    {requestType === 'delete' ? '-' : formatTime(request.requested_clock_out)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 max-w-xs truncate">{request.reason}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusCfg.bgClass}`}>
                      {statusCfg.label}
                    </span>
                  </td>
                  {onReview && (
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {request.status === 'pending' ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => onReview(request.id, 'approved')}
                            className="px-3 py-1 text-xs font-medium text-white bg-green-600 dark:bg-green-700 rounded hover:bg-green-700 dark:hover:bg-green-600 transition-colors"
                          >
                            承認
                          </button>
                          <button
                            onClick={() => onReview(request.id, 'rejected')}
                            className="px-3 py-1 text-xs font-medium text-white bg-red-600 dark:bg-red-700 rounded hover:bg-red-700 dark:hover:bg-red-600 transition-colors"
                          >
                            却下
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400 dark:text-gray-500">-</span>
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
