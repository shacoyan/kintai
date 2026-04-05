// FILE: components/Admin/AdminDashboard.tsx
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

interface AttendanceWithProfile {
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
  profiles: {
    display_name: string | null;
  } | null;
}

interface AdminDashboardProps {
  tenantId: string;
}

export function AdminDashboard({ tenantId }: AdminDashboardProps) {
  const [records, setRecords] = useState<AttendanceWithProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const today = format(new Date(), 'yyyy-MM-dd');

  useEffect(() => {
    fetchTodayRecords();
  }, [tenantId]);

  async function fetchTodayRecords() {
    setLoading(true);
    const { data, error } = await supabase
      .from('attendance_records')
      .select('*, profiles(display_name)')
      .eq('tenant_id', tenantId)
      .eq('date', today);

    if (error) {
      console.error('Error fetching records:', error);
    } else {
      setRecords(data || []);
    }
    setLoading(false);
  }

  function getStatus(record: AttendanceWithProfile) {
    if (record.clock_out) {
      return { label: '退勤済', className: 'bg-gray-100 text-gray-600' };
    }
    if (record.break_start && !record.break_end) {
      return { label: '休憩中', className: 'bg-yellow-100 text-yellow-600' };
    }
    if (record.clock_in) {
      return { label: '出勤中', className: 'bg-green-100 text-green-600' };
    }
    return { label: '未出勤', className: 'bg-red-100 text-red-600' };
  }

  function formatTime(time: string | null) {
    if (!time) return '-';
    return format(new Date(time), 'HH:mm');
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
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
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                名前
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                ステータス
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                出勤
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                退勤
              </th>
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
                        {record.profiles?.display_name || '不明'}
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
  );
}
