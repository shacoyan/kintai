import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { useCorrection } from '../../hooks/useCorrection';
import { CorrectionList } from '../Correction/CorrectionList';

interface AttendanceWithMember {
  id: string;
  tenant_id: string;
  user_id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  break_start: string | null;
  break_end: string | null;
  total_work_minutes: number | null;
  created_at: string;
  tenant_members: {
    display_name: string;
  }[] | null;
}

interface AdminDashboardProps {
  tenantId: string;
}

export function AdminDashboard({ tenantId }: AdminDashboardProps) {
  const [records, setRecords] = useState<AttendanceWithMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { requests, loading: correctionLoading, fetchRequests, reviewRequest } = useCorrection(tenantId);

  const today = format(new Date(), 'yyyy-MM-dd');

  useEffect(() => {
    fetchTodayRecords();
    fetchRequests();
  }, [tenantId]);

  async function fetchTodayRecords() {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('attendance_records')
      .select('*, tenant_members!attendance_records_user_id_fkey(display_name)')
      .eq('tenant_id', tenantId)
      .eq('date', today);

    if (fetchError) {
      console.error('Error fetching records:', fetchError);
      setError(fetchError.message);
    } else {
      setRecords((data as AttendanceWithMember[]) || []);
    }
    setLoading(false);
  }

  function getStatus(record: AttendanceWithMember) {
    if (record.clock_out) {
      return { label: '退勤済', className: 'bg-gray-100 text-gray-600' };
    }
    if (record.clock_in) {
      return { label: '出勤中', className: 'bg-green-100 text-green-600' };
    }
    return { label: '未出勤', className: 'bg-red-100 text-red-600' };
  }

  function formatTime(time: string | null) {
    if (!time) return '-';
    return format(parseISO(time), 'HH:mm');
  }

  async function handleReview(requestId: string, status: 'approved' | 'rejected') {
    try {
      await reviewRequest(requestId, status);
    } catch (err) {
      console.error('Failed to review request:', err);
    }
  }

  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const processedRequests = requests.filter((r) => r.status !== 'pending');

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
        <p className="text-red-600">{error}</p>
        <button onClick={fetchTodayRecords} className="mt-2 text-sm text-blue-600 hover:underline">再読み込み</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 本日の勤怠状況 */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            本日の勤怠状況（{format(new Date(), 'M月d日', { locale: ja })}）
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">名前</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ステータス</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">出勤</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">退勤</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {records.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                    本日の勤怠記録はありません
                  </td>
                </tr>
              ) : (
                records.map((record) => {
                  const status = getStatus(record);
                  return (
                    <tr key={record.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {record.tenant_members?.[0]?.display_name || '不明'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {formatTime(record.clock_in)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {formatTime(record.clock_out)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 修正申請（承認待ち） */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">修正申請（承認待ち）</h2>
          {pendingRequests.length > 0 && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
              {pendingRequests.length}件
            </span>
          )}
        </div>
        {correctionLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <CorrectionList requests={pendingRequests} onReview={handleReview} />
        )}
      </div>

      {/* 修正申請履歴 */}
      {processedRequests.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">修正申請履歴</h2>
          </div>
          <CorrectionList requests={processedRequests} />
        </div>
      )}
    </div>
  );
}
