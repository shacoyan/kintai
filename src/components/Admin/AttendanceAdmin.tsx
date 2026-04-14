import { useState, useEffect } from 'react';
import { useAdmin } from '../../hooks/useAdmin';
import { format, parseISO, differenceInMinutes } from 'date-fns';
import type { AttendanceRecord } from '../../types';
import { useToast } from '../../contexts/ToastContext';

interface AttendanceAdminProps {
  tenantId: string;
}

export function AttendanceAdmin({ tenantId }: AttendanceAdminProps) {
  const { showToast } = useToast();
  const { members, memberAttendance, loading, fetchMembers, fetchMemberAttendance, updateAttendance, deleteAttendance } = useAdmin(tenantId);

  const now = new Date();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [startDate, setStartDate] = useState(format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(now, 'yyyy-MM-dd'));
  const [searched, setSearched] = useState(false);
  const [edits, setEdits] = useState<Record<string, { clock_in: string; clock_out: string }>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  useEffect(() => {
    if (members.length > 0 && !selectedUserId) {
      setSelectedUserId(members[0].user_id);
    }
  }, [members, selectedUserId]);

  const handleSearch = async () => {
    if (!selectedUserId || !startDate || !endDate) return;
    await fetchMemberAttendance(selectedUserId, startDate, endDate);
    setEdits({});
    setSearched(true);
  };

  const handleFieldChange = (recordId: string, field: 'clock_in' | 'clock_out', value: string) => {
    setEdits((prev) => {
      const existing = prev[recordId] || { clock_in: '', clock_out: '' };
      return {
        ...prev,
        [recordId]: { ...existing, [field]: value },
      };
    });
  };

  const getEditValue = (record: AttendanceRecord, field: 'clock_in' | 'clock_out'): string => {
    if (edits[record.id]?.[field] !== undefined) return edits[record.id][field];
    const val = record[field];
    return val ? format(parseISO(val), "yyyy-MM-dd'T'HH:mm") : '';
  };

  const calcBreakMinutes = (record: AttendanceRecord): number => {
    if (!record.breaks || record.breaks.length === 0) return 0;
    return record.breaks.reduce((sum, b) => {
      if (b.start_time && b.end_time) {
        return sum + differenceInMinutes(parseISO(b.end_time), parseISO(b.start_time));
      }
      return sum;
    }, 0);
  };

  const fmtMinutes = (min: number): string => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  };

  const handleSave = async (recordId: string) => {
    const edit = edits[recordId];
    if (!edit) return;
    const record = memberAttendance.find((r) => r.id === recordId);
    if (!record) return;

    // datetime-local値をISO文字列に統一してから計算
    const clockInISO = edit.clock_in ? new Date(edit.clock_in).toISOString() : record.clock_in;
    const clockOutISO = edit.clock_out ? new Date(edit.clock_out).toISOString() : record.clock_out;
    let totalWorkMinutes: number | undefined;
    if (clockInISO && clockOutISO) {
      const breakMin = calcBreakMinutes(record);
      totalWorkMinutes = Math.max(0, differenceInMinutes(parseISO(clockOutISO), parseISO(clockInISO)) - breakMin);
    }

    try {
      await updateAttendance(recordId, {
        ...(edit.clock_in ? { clock_in: new Date(edit.clock_in).toISOString() } : {}),
        ...(edit.clock_out ? { clock_out: new Date(edit.clock_out).toISOString() } : {}),
        ...(totalWorkMinutes !== undefined ? { total_work_minutes: totalWorkMinutes } : {}),
      });
      setEdits((prev) => {
        const next = { ...prev };
        delete next[recordId];
        return next;
      });
      showToast('勤怠記録を更新しました', 'success');
      await fetchMemberAttendance(selectedUserId, startDate, endDate);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '勤怠記録の更新に失敗しました', 'error');
    }
  };

  const handleDeleteConfirm = async (recordId: string) => {
    setConfirmDeleteId(null);
    try {
      await deleteAttendance(recordId);
      showToast('勤怠記録を削除しました', 'success');
      await fetchMemberAttendance(selectedUserId, startDate, endDate);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '勤怠記録の削除に失敗しました', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">勤怠記録検索</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">メンバー</label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-gray-600"
            >
              <option value="">選択してください</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.display_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">開始日</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-gray-600" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">終了日</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-gray-600" />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleSearch}
              disabled={!selectedUserId || loading}
              className="w-full bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {loading ? '検索中...' : '検索'}
            </button>
          </div>
        </div>
      </div>

      {searched && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">検索結果</h3>
          </div>
          {memberAttendance.length === 0 ? (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">該当する勤怠記録がありません</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">日付</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">出勤時刻</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">退勤時刻</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">休憩</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">労働時間</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">操作</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {memberAttendance.map((record) => {
                    const breakMin = calcBreakMinutes(record);
                    const hasEdit = !!edits[record.id];
                    return (
                      <tr key={record.id} className={hasEdit ? 'bg-yellow-50 dark:bg-yellow-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">{record.date}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          <input
                            type="datetime-local"
                            value={getEditValue(record, 'clock_in')}
                            onChange={(e) => handleFieldChange(record.id, 'clock_in', e.target.value)}
                            className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                          />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          <input
                            type="datetime-local"
                            value={getEditValue(record, 'clock_out')}
                            onChange={(e) => handleFieldChange(record.id, 'clock_out', e.target.value)}
                            className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                          />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{fmtMinutes(breakMin)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{fmtMinutes(record.total_work_minutes || 0)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm space-x-2">
                          <button
                            onClick={() => handleSave(record.id)}
                            disabled={!hasEdit}
                            className="bg-green-600 text-white px-3 py-1 rounded text-xs hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                          >
                            保存
                          </button>
                          {confirmDeleteId === record.id ? (
                            <span className="inline-flex items-center gap-1">
                              <button
                                onClick={() => handleDeleteConfirm(record.id)}
                                className="bg-red-600 text-white px-2 py-1 rounded text-xs hover:bg-red-700 transition"
                              >
                                確認
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 px-2 py-1 rounded text-xs hover:bg-gray-400 dark:hover:bg-gray-500 transition"
                              >
                                戻す
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(record.id)}
                              className="bg-red-600 text-white px-3 py-1 rounded text-xs hover:bg-red-700 transition"
                            >
                              削除
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
