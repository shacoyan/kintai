import { format, parseISO } from 'date-fns';
import { CorrectionRequest } from '../../types';

interface CorrectionListProps {
  requests: CorrectionRequest[];
  onReview?: (id: string, status: 'approved' | 'rejected') => void;
}

const statusConfig = {
  pending: { label: '承認待ち', bgClass: 'bg-yellow-100 text-yellow-800' },
  approved: { label: '承認済み', bgClass: 'bg-green-100 text-green-800' },
  rejected: { label: '却下', bgClass: 'bg-red-100 text-red-800' },
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
      <div className="text-center py-8 text-gray-500">
        修正申請はありません
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">日付</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">申請出勤</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">申請退勤</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">理由</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ステータス</th>
            {onReview && (
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
            )}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {requests.map((request) => {
            const config = statusConfig[request.status];
            return (
              <tr key={request.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">{request.date}</td>
                <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">{formatTime(request.requested_clock_in)}</td>
                <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">{formatTime(request.requested_clock_out)}</td>
                <td className="px-4 py-3 text-sm text-gray-700 max-w-xs truncate">{request.reason}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bgClass}`}>
                    {config.label}
                  </span>
                </td>
                {onReview && (
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    {request.status === 'pending' ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => onReview(request.id, 'approved')}
                          className="px-3 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 transition-colors"
                        >
                          承認
                        </button>
                        <button
                          onClick={() => onReview(request.id, 'rejected')}
                          className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 transition-colors"
                        >
                          却下
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
