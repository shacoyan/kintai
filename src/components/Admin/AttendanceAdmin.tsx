import { useState, useEffect, useCallback } from 'react';
import type React from 'react';
import { useTenantAdmin } from '../../hooks/useTenantAdmin';
import { format, parseISO, differenceInMinutes, getDaysInMonth } from 'date-fns';
import type { AttendanceRecord, Shift } from '../../types';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { formatSupabaseError } from '../../lib/errors';
import { AlertTriangle, Users } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { useStoreContext } from '../../contexts/StoreContext';

interface AttendanceAdminProps {
  tenantId: string;
}

interface SelectedCell {
  userId: string;
  date: string; // 'yyyy-MM-dd'
  record: AttendanceRecord | null;
}

interface EditState {
  clock_in: string;
  clock_out: string;
}

const OVERTIME_THRESHOLD_MINUTES = 8 * 60; // 8時間

function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function calcBreakMinutes(record: AttendanceRecord): number {
  if (!record.breaks || record.breaks.length === 0) return 0;
  return record.breaks.reduce((sum, b) => {
    if (b.start_time && b.end_time) {
      return sum + differenceInMinutes(parseISO(b.end_time), parseISO(b.start_time));
    }
    return sum;
  }, 0);
}

function calcWorkMinutes(record: AttendanceRecord): number {
  if (record.total_work_minutes != null) return record.total_work_minutes;
  if (record.clock_in && record.clock_out) {
    const gross = differenceInMinutes(parseISO(record.clock_out), parseISO(record.clock_in));
    const breakMin = calcBreakMinutes(record);
    return Math.max(0, gross - breakMin);
  }
  return 0;
}

function toDatetimeLocal(isoString: string | null): string {
  if (!isoString) return '';
  return format(parseISO(isoString), "yyyy-MM-dd'T'HH:mm");
}

function getDayLabel(day: number, year: number, month: number): string {
  const d = new Date(year, month - 1, day);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return weekdays[d.getDay()];
}

function isWeekend(day: number, year: number, month: number): boolean {
  const d = new Date(year, month - 1, day);
  return d.getDay() === 0 || d.getDay() === 6;
}

export function AttendanceAdmin({ tenantId }: AttendanceAdminProps) {
  const { showToast } = useToast();
  const { currentStore } = useStoreContext();
  const {
    members,
    allAttendance,
    loading,
    fetchMembers,
    fetchAllAttendance,
    updateAttendance,
    deleteAttendance,
  } = useTenantAdmin(tenantId);

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [loaded, setLoaded] = useState(false);

  // 承認済みシフト
  const [approvedShifts, setApprovedShifts] = useState<Shift[]>([]);

  // 選択中セル
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);

  // 編集ステート（詳細パネル用）
  const [edit, setEdit] = useState<EditState>({ clock_in: '', clock_out: '' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const fetchShifts = useCallback(async (year: number, month: number) => {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    let query = supabase
      .from('shifts')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'approved')
      .gte('date', startDate)
      .lte('date', endDate);
    
    if (currentStore?.id) {
      query = query.eq('store_id', currentStore.id);
    }
    
    const { data } = await query;
    setApprovedShifts((data as Shift[]) || []);
  }, [tenantId, currentStore?.id]);

  const handleLoad = useCallback(async () => {
    await Promise.all([
      fetchAllAttendance(selectedYear, selectedMonth, currentStore?.id ?? null),
      fetchShifts(selectedYear, selectedMonth),
    ]);
    setLoaded(true);
    setSelectedCell(null);
  }, [fetchAllAttendance, fetchShifts, selectedYear, selectedMonth, currentStore?.id]);

  // 年月が変わったら再ロード
  useEffect(() => {
    if (loaded) {
      setLoaded(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, selectedMonth, currentStore?.id]);

  // カレンダーデータ構築
  const daysInMonth = getDaysInMonth(new Date(selectedYear, selectedMonth - 1));
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // user_id + date でインデックス (複数レコードがある場合は最初の1件)
  const attendanceMap = new Map<string, AttendanceRecord>();
  for (const r of allAttendance) {
    const key = `${r.user_id}__${r.date}`;
    if (!attendanceMap.has(key)) {
      attendanceMap.set(key, r);
    }
  }

  // 承認済みシフトのインデックス
  const shiftSet = new Set<string>();
  for (const s of approvedShifts) {
    shiftSet.add(`${s.user_id}__${s.date}`);
  }

  // メンバーごとの集計
  function getMemberSummary(userId: string) {
    const records = allAttendance.filter((r) => r.user_id === userId && r.clock_in);
    const workDays = new Set(records.map((r) => r.date)).size;
    const totalMin = records.reduce((sum, r) => sum + calcWorkMinutes(r), 0);
    return { workDays, totalMin };
  }

  // セルクリック
  function handleCellClick(userId: string, day: number) {
    const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const key = `${userId}__${dateStr}`;
    const record = attendanceMap.get(key) || null;

    if (selectedCell?.userId === userId && selectedCell?.date === dateStr) {
      setSelectedCell(null);
      return;
    }

    setSelectedCell({ userId, date: dateStr, record });
    setEdit({
      clock_in: toDatetimeLocal(record?.clock_in ?? null),
      clock_out: toDatetimeLocal(record?.clock_out ?? null),
    });
    setConfirmDelete(false);
  }

  // 詳細パネル: 保存
  async function handleSave() {
    if (!selectedCell) return;
    setSaving(true);
    try {
      if (selectedCell.record) {
        const clockInISO = edit.clock_in ? new Date(edit.clock_in).toISOString() : selectedCell.record.clock_in;
        const clockOutISO = edit.clock_out ? new Date(edit.clock_out).toISOString() : selectedCell.record.clock_out;
        let totalWorkMinutes: number | undefined;
        if (clockInISO && clockOutISO) {
          const breakMin = calcBreakMinutes(selectedCell.record);
          totalWorkMinutes = Math.max(
            0,
            differenceInMinutes(parseISO(clockOutISO), parseISO(clockInISO)) - breakMin
          );
        }
        await updateAttendance(selectedCell.record.id, {
          ...(edit.clock_in ? { clock_in: new Date(edit.clock_in).toISOString() } : {}),
          ...(edit.clock_out ? { clock_out: new Date(edit.clock_out).toISOString() } : {}),
          ...(totalWorkMinutes !== undefined ? { total_work_minutes: totalWorkMinutes } : {}),
        });
        showToast('勤怠記録を更新しました', 'success');
      } else {
        if (!edit.clock_in) {
          showToast('出勤時刻を入力してください', 'error');
          setSaving(false);
          return;
        }
        if (!currentStore?.id) {
          showToast('店舗を選択してください', 'error');
          setSaving(false);
          return;
        }
        const clockInISO = new Date(edit.clock_in).toISOString();
        const clockOutISO = edit.clock_out ? new Date(edit.clock_out).toISOString() : null;
        let totalWorkMinutes: number | null = null;
        if (clockInISO && clockOutISO) {
          totalWorkMinutes = Math.max(
            0,
            differenceInMinutes(parseISO(clockOutISO), parseISO(clockInISO))
          );
        }
        const { error: insertError } = await supabase
          .from('attendance_records')
          .insert({
            tenant_id: tenantId,
            store_id: currentStore.id,
            user_id: selectedCell.userId,
            date: selectedCell.date,
            clock_in: clockInISO,
            clock_out: clockOutISO,
            total_work_minutes: totalWorkMinutes,
          });
        if (insertError) throw new Error(insertError.message);
        showToast('勤怠記録を登録しました', 'success');
      }
      await Promise.all([
        fetchAllAttendance(selectedYear, selectedMonth, currentStore?.id ?? null),
        fetchShifts(selectedYear, selectedMonth),
      ]);
      setSelectedCell(null);
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  // 詳細パネル: 削除
  async function handleDelete() {
    if (!selectedCell?.record) return;
    setSaving(true);
    try {
      await deleteAttendance(selectedCell.record.id);
      showToast('勤怠記録を削除しました', 'success');
      await Promise.all([
        fetchAllAttendance(selectedYear, selectedMonth, currentStore?.id ?? null),
        fetchShifts(selectedYear, selectedMonth),
      ]);
      setSelectedCell(null);
      setConfirmDelete(false);
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  // 選択中メンバー名
  const selectedMemberName = selectedCell
    ? (members.find((m) => m.user_id === selectedCell.userId)?.display_name ?? '不明')
    : '';

  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <div className="space-y-6">
      {/* 月選択ヘッダー */}
      <div className="bg-white dark:bg-neutral-800 rounded-lg shadow p-4">
        <h3 className="text-lg font-semibold text-neutral-800 dark:text-neutral-200 mb-4">月次勤怠カレンダー</h3>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">対象店舗: {currentStore?.name ?? '全店舗'}</p>
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
          <div className="grid grid-cols-2 gap-3 md:contents">
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">年</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="border border-neutral-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-neutral-700 dark:text-white dark:border-neutral-600"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}年</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">月</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="border border-neutral-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-neutral-700 dark:text-white dark:border-neutral-600"
              >
                {monthOptions.map((m) => (
                  <option key={m} value={m}>{m}月</option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={handleLoad}
            disabled={loading}
            className="w-full md:w-auto bg-primary-600 text-white px-5 py-2 rounded-md text-sm hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition"
          >
            {loading ? '読込中...' : '表示'}
          </button>
        </div>

        {/* 凡例 */}
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] md:text-xs text-neutral-600 dark:text-neutral-400">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700" />
            出勤（〜8h）
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded bg-info-50 dark:bg-info-900/30 border border-info-300 dark:border-info-700" />
            残業（8h超）
          </span>
          <span className="flex items-center gap-1">
            <AlertTriangle className="w-4 h-4 text-danger-500" aria-hidden="true" />
            シフトあり・勤怠なし
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600" />
            記録なし
          </span>
        </div>
      </div>

      {/* カレンダーグリッド */}
      {loaded && members.length > 0 && (
        <div className="bg-white dark:bg-neutral-800 rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="border-collapse text-xs tabular-nums" style={{ minWidth: `${40 + daysInMonth * 52}px` }}>
              <thead>
                <tr className="bg-neutral-50 dark:bg-neutral-700">
                  <th
                    className="sticky left-0 top-0 z-20 bg-neutral-50 dark:bg-neutral-700 border-b border-r border-neutral-200 dark:border-neutral-600 px-3 py-2 text-left font-medium text-neutral-600 dark:text-neutral-300 whitespace-nowrap"
                    style={{ minWidth: '100px' }}
                  >
                    スタッフ
                  </th>
                  {days.map((day) => {
                    const weekend = isWeekend(day, selectedYear, selectedMonth);
                    const dayLabel = getDayLabel(day, selectedYear, selectedMonth);
                    return (
                      <th
                        key={day}
                        className={`sticky top-0 z-[5] border-b border-r border-neutral-200 dark:border-neutral-600 py-1 font-medium text-center whitespace-nowrap ${
                          weekend
                            ? 'text-danger-500 dark:text-danger-400 bg-rose-50/50 dark:bg-rose-900/10'
                            : 'text-neutral-600 dark:text-neutral-300 bg-neutral-50 dark:bg-neutral-700'
                        }`}
                        style={{ minWidth: '48px', width: '48px' }}
                      >
                        <div>{day}</div>
                        <div className="text-neutral-400 dark:text-neutral-500">{dayLabel}</div>
                      </th>
                    );
                  })}
                  <th className="sticky top-0 z-[5] border-b border-r border-neutral-200 dark:border-neutral-600 px-2 py-2 font-medium text-center text-neutral-600 dark:text-neutral-300 whitespace-nowrap bg-neutral-50 dark:bg-neutral-700">
                    出勤日
                  </th>
                  <th className="sticky top-0 z-[5] border-b border-neutral-200 dark:border-neutral-600 px-2 py-2 font-medium text-center text-neutral-600 dark:text-neutral-300 whitespace-nowrap bg-neutral-50 dark:bg-neutral-700">
                    合計
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
                {members.map((member) => {
                  const { workDays, totalMin } = getMemberSummary(member.user_id);
                  return (
                    <tr key={member.user_id} className="hover:bg-neutral-50 dark:hover:bg-neutral-700/50 motion-safe:transition-colors">
                      <td
                        className="sticky left-0 z-10 bg-white dark:bg-neutral-800 border-r border-neutral-200 dark:border-neutral-600 px-3 py-2 font-medium text-neutral-800 dark:text-neutral-200 whitespace-nowrap"
                        style={{ minWidth: '100px' }}
                      >
                        {member.display_name}
                      </td>

                      {days.map((day) => {
                        const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const key = `${member.user_id}__${dateStr}`;
                        const record = attendanceMap.get(key);
                        const hasShift = shiftSet.has(key);
                        const isSelected =
                          selectedCell?.userId === member.user_id && selectedCell?.date === dateStr;
                        const weekend = isWeekend(day, selectedYear, selectedMonth);

                        let cellContent: React.ReactNode = null;
                        let cellBg = weekend
                          ? 'bg-rose-50/50 dark:bg-rose-900/10'
                          : 'bg-white dark:bg-neutral-800';
                        let textColor = '';

                        if (record && record.clock_in) {
                          const workMin = calcWorkMinutes(record);
                          const isOvertime = workMin > OVERTIME_THRESHOLD_MINUTES;
                          cellBg = isOvertime
                            ? 'bg-info-50 dark:bg-info-900/30'
                            : 'bg-emerald-50 dark:bg-emerald-900/30';
                          textColor = isOvertime
                            ? 'text-info-700 dark:text-info-300 font-semibold'
                            : 'text-emerald-700 dark:text-emerald-300 font-semibold';
                          cellContent = (
                            <span className={textColor}>{fmtMinutes(workMin)}</span>
                          );
                        } else if (hasShift) {
                          cellContent = <AlertTriangle className="w-4 h-4 text-danger-500 mx-auto" aria-label="シフトあり・勤怠なし" />;
                          cellBg = 'bg-rose-50 dark:bg-rose-900/20';
                        }

                        return (
                          <td
                            key={day}
                            onClick={() => handleCellClick(member.user_id, day)}
                            aria-selected={isSelected}
                            className={`
                              border-r border-neutral-200 dark:border-neutral-600 p-1 text-center cursor-pointer
                              motion-safe:transition-all select-none
                              ${cellBg}
                              ${isSelected ? 'ring-2 ring-inset ring-primary-500' : 'hover:ring-1 hover:ring-inset hover:ring-primary-300'}
                            `}
                            style={{ minWidth: '48px', width: '48px', height: '44px' }}
                          >
                            {cellContent}
                          </td>
                        );
                      })}

                      <td className="border-r border-neutral-200 dark:border-neutral-600 px-2 py-2 text-center text-neutral-700 dark:text-neutral-300 whitespace-nowrap">
                        {workDays}日
                      </td>
                      <td className="px-2 py-2 text-center text-neutral-700 dark:text-neutral-300 whitespace-nowrap">
                        {fmtMinutes(totalMin)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loaded && members.length === 0 && (
        <EmptyState
          icon={<Users className="w-12 h-12 text-slate-400" />}
          title="メンバーが登録されていません"
          description="メンバー管理タブからメンバーを追加してください"
        />
      )}

      {/* 詳細・編集 BottomSheet */}
      <BottomSheet
        isOpen={!!selectedCell}
        onClose={() => setSelectedCell(null)}
        title={selectedCell ? `${selectedMemberName} - ${selectedCell.date}` : ''}
        description={
          selectedCell
            ? selectedCell.record
              ? '記録あり'
              : '新規登録'
            : undefined
        }
        footer={
          selectedCell ? (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleSave}
                disabled={saving || (!edit.clock_in && !selectedCell.record)}
                className="bg-primary-600 text-white px-5 py-2 rounded-md text-sm hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition"
              >
                {saving ? '保存中...' : selectedCell.record ? '更新' : '登録'}
              </button>

              {selectedCell.record && (
                confirmDelete ? (
                  <span className="inline-flex items-center gap-2">
                    <Button
                      onClick={handleDelete}
                      disabled={saving}
                      variant="danger"
                    >
                      削除確認
                    </Button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="bg-neutral-200 dark:bg-neutral-600 text-neutral-700 dark:text-neutral-200 px-4 py-2 rounded-md text-sm hover:bg-neutral-300 dark:hover:bg-neutral-500 motion-safe:transition"
                    >
                      キャンセル
                    </button>
                  </span>
                ) : (
                  <Button
                    onClick={() => setConfirmDelete(true)}
                    variant="danger"
                  >
                    削除
                  </Button>
                )
              )}

              <button
                onClick={() => setSelectedCell(null)}
                className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 motion-safe:transition"
              >
                閉じる
              </button>
            </div>
          ) : undefined
        }
      >
        {selectedCell && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">出勤時刻</label>
                <input
                  type="datetime-local"
                  value={edit.clock_in}
                  onChange={(e) => setEdit((prev) => ({ ...prev, clock_in: e.target.value }))}
                  className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-neutral-700 dark:text-white dark:border-neutral-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">退勤時刻</label>
                <input
                  type="datetime-local"
                  value={edit.clock_out}
                  onChange={(e) => setEdit((prev) => ({ ...prev, clock_out: e.target.value }))}
                  className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-neutral-700 dark:text-white dark:border-neutral-600"
                />
              </div>
            </div>

            {selectedCell.record && selectedCell.record.breaks && selectedCell.record.breaks.length > 0 && (
              <div>
                <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">休憩</p>
                <div className="space-y-1">
                  {selectedCell.record.breaks.map((b, idx) => (
                    <div key={b.id} className="text-sm text-neutral-600 dark:text-neutral-400 flex gap-2 tabular-nums">
                      <span>#{idx + 1}</span>
                      <span>{b.start_time ? format(parseISO(b.start_time), 'HH:mm') : '—'}</span>
                      <span>〜</span>
                      <span>{b.end_time ? format(parseISO(b.end_time), 'HH:mm') : '打刻中'}</span>
                      {b.start_time && b.end_time && (
                        <span className="text-neutral-400">
                          ({fmtMinutes(differenceInMinutes(parseISO(b.end_time), parseISO(b.start_time)))})
                        </span>
                      )}
                    </div>
                  ))}
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 tabular-nums">
                    合計休憩: {fmtMinutes(calcBreakMinutes(selectedCell.record))}
                  </p>
                </div>
              </div>
            )}

            {edit.clock_in && edit.clock_out && (() => {
              const grossMin = differenceInMinutes(
                new Date(edit.clock_out),
                new Date(edit.clock_in)
              );
              const breakMin = selectedCell.record ? calcBreakMinutes(selectedCell.record) : 0;
              const workMin = Math.max(0, grossMin - breakMin);
              return (
                <p className="text-sm text-primary-600 dark:text-primary-400 tabular-nums">
                  労働時間（予算）: {fmtMinutes(workMin)}
                  {breakMin > 0 && ` (休憩 ${fmtMinutes(breakMin)} 除く)`}
                </p>
              );
            })()}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
