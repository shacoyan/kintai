import { useState, useEffect } from 'react';
import { useAdmin } from '../../hooks/useAdmin';
import { useTenant } from '../../hooks/useTenant';
import type { TenantMember } from '../../types';
import { useToast } from '../../contexts/ToastContext';
import { BottomSheet } from '../ui/BottomSheet';
import { EmptyState } from '../ui/EmptyState';
import { ErrorBanner } from '../ui/ErrorBanner';
import { PageSkeleton } from '../ui/Skeleton';
import { Trash2, Pencil, Users } from 'lucide-react';

interface MemberManagementProps {
  tenantId: string;
}

const roleBadge: Record<string, { label: string; className: string }> = {
  owner: { label: 'オーナー', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  manager: { label: '店長', className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  staff: { label: 'スタッフ', className: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200' },
};

export function MemberManagement({ tenantId }: MemberManagementProps) {
  const { showToast } = useToast();
  const { myRole } = useTenant();
  const { members, loading, error, fetchMembers, updateHourlyRate, updateNightShift, updatePayType, updateMonthlySalary, deleteMember, updateRole } = useAdmin(tenantId);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingRoleId, setTogglingRoleId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState<string>('');
  const [editMonthlySalary, setEditMonthlySalary] = useState<string>('');
  const [editingMonthlySalaryId, setEditingMonthlySalaryId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleStartEdit = (member: TenantMember) => {
    setEditingId(member.id);
    setEditRate(String(member.hourly_rate ?? 0));
  };

  const handleSave = async (memberId: string) => {
    const rate = parseInt(editRate, 10);
    if (isNaN(rate) || rate < 0) {
      setEditingId(null);
      return;
    }
    setSaving(true);
    try {
      await updateHourlyRate(memberId, rate);
      setEditingId(null);
      showToast('時給を保存しました', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '時給の保存に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditRate('');
  };

  const handleKeyDown = (e: React.KeyboardEvent, memberId: string) => {
    if (e.key === 'Enter') handleSave(memberId);
    if (e.key === 'Escape') handleCancel();
  };

  const handlePayTypeChange = async (member: TenantMember, payType: 'hourly' | 'monthly') => {
    try {
      await updatePayType(member.id, payType);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '給与タイプの更新に失敗しました', 'error');
    }
  };

  const handleStartEditMonthlySalary = (member: TenantMember) => {
    setEditingMonthlySalaryId(member.id);
    setEditMonthlySalary(String(member.monthly_salary ?? 0));
  };

  const handleSaveMonthlySalary = async (memberId: string) => {
    const salary = parseInt(editMonthlySalary, 10);
    if (isNaN(salary) || salary < 0) {
      setEditingMonthlySalaryId(null);
      return;
    }
    setSaving(true);
    try {
      await updateMonthlySalary(memberId, salary);
      setEditingMonthlySalaryId(null);
      showToast('月給を保存しました', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '月給の保存に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleMonthlySalaryKeyDown = (e: React.KeyboardEvent, memberId: string) => {
    if (e.key === 'Enter') handleSaveMonthlySalary(memberId);
    if (e.key === 'Escape') setEditingMonthlySalaryId(null);
  };

  const handleRoleToggle = async (member: TenantMember) => {
    const newRole = member.role === 'manager' ? 'staff' : 'manager';
    setTogglingRoleId(member.id);
    try {
      await updateRole(member.id, newRole);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '権限の更新に失敗しました', 'error');
    } finally {
      setTogglingRoleId(null);
    }
  };

  const handleNightShiftToggle = async (member: TenantMember) => {
    try {
      await updateNightShift(member.id, !member.night_shift_enabled);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '深夜給設定の更新に失敗しました', 'error');
    }
  };

  const handleDelete = async (memberId: string) => {
    try {
      await deleteMember(memberId);
      showToast('メンバーを削除しました', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'メンバーの削除に失敗しました', 'error');
    }
    setDeletingId(null);
  };

  if (myRole !== 'owner' && myRole !== 'manager') {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center dark:bg-yellow-900/20 dark:border-yellow-800">
        <p className="text-yellow-700">この機能を使用する権限がありません</p>
      </div>
    );
  }

  if (loading && members.length === 0) {
    return <PageSkeleton />;
  }

  if (error) {
    return <ErrorBanner message={error} onRetry={fetchMembers} />;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">メンバー管理</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">各メンバーの時給・深夜給を設定できます</p>
      </div>

      {/* カード型レイアウト（モバイル対応） */}
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {members.length === 0 ? (
          <EmptyState icon={<Users className="w-12 h-12 text-slate-400" />} title="メンバーがいません" description="招待コードをメンバーに共有してください" />
        ) : (
          members.map((member) => {
            const badge = roleBadge[member.role] || roleBadge.staff;
            const isEditing = editingId === member.id;
            const rate = member.hourly_rate ?? 0;

            return (
              <div key={member.id} className="px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                {/* 上段: 名前・ロール・参加日 */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-700 dark:text-blue-300 font-bold text-sm shrink-0">
                      {member.display_name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{member.display_name}</p>
                      <p className="text-xs text-gray-400">{new Date(member.created_at).toLocaleDateString('ja-JP')} 参加</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                    {member.role !== 'owner' && myRole === 'owner' && (
                      <button
                        role="switch"
                        aria-checked={member.role === 'manager'}
                        aria-label={`${member.display_name} の店長権限`}
                        onClick={() => handleRoleToggle(member)}
                        disabled={togglingRoleId === member.id}
                        className={`px-2 py-0.5 text-xs font-medium rounded transition ${
                          member.role === 'manager'
                            ? 'text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
                            : 'text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30 hover:bg-green-100 dark:hover:bg-green-900/50'
                        } disabled:opacity-50`}
                        title={member.role === 'manager' ? 'スタッフに変更' : '店長に変更'}
                      >
                        {togglingRoleId === member.id ? '...' : member.role === 'manager' ? '→スタッフ' : '→店長'}
                      </button>
                    )}
                    {member.role !== 'owner' && (
                      <button
                        onClick={() => setDeletingId(member.id)}
                        className="p-1 text-gray-400 hover:text-red-500 transition"
                        title="メンバーを削除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    <BottomSheet
                      isOpen={deletingId === member.id}
                      onClose={() => setDeletingId(null)}
                      title="メンバーを削除しますか？"
                      description={`「${member.display_name}」さんの所属情報が完全に削除されます。この操作は元に戻せません。`}
                      footer={
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setDeletingId(null)}
                            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                          >
                            キャンセル
                          </button>
                          <button
                            onClick={() => handleDelete(member.id)}
                            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                          >
                            削除する
                          </button>
                        </div>
                      }
                    >
                      <div />
                    </BottomSheet>
                  </div>
                </div>

                {/* 下段: 給与タイプ・時給/月給・深夜給 */}
                <div className="space-y-2 ml-12">
                  {/* 給与タイプ切替 */}
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 dark:text-gray-400 w-14">給与形態</span>
                    <div className="flex rounded-md overflow-hidden border border-gray-300 dark:border-gray-600">
                      <button
                        onClick={() => handlePayTypeChange(member, 'hourly')}
                        className={`px-3 py-1 text-xs font-medium transition-colors ${
                          (member.pay_type ?? 'hourly') === 'hourly'
                            ? 'bg-blue-600 text-white'
                            : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                        }`}
                      >
                        時給
                      </button>
                      <button
                        onClick={() => handlePayTypeChange(member, 'monthly')}
                        className={`px-3 py-1 text-xs font-medium transition-colors ${
                          member.pay_type === 'monthly'
                            ? 'bg-blue-600 text-white'
                            : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                        }`}
                      >
                        月給
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {/* 時給/月給入力 */}
                    {(member.pay_type ?? 'hourly') === 'hourly' ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400 w-14">時給</span>
                        {isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm text-gray-500 dark:text-gray-400">¥</span>
                            <input
                              type="number"
                              value={editRate}
                              onChange={(e) => setEditRate(e.target.value)}
                              onKeyDown={(e) => handleKeyDown(e, member.id)}
                              className="w-24 px-2 py-1.5 text-sm border border-blue-400 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-blue-50 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                              autoFocus
                              disabled={saving}
                              min="0"
                              step="50"
                            />
                            <button
                              onClick={() => handleSave(member.id)}
                              disabled={saving}
                              className="px-2.5 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
                            >
                              {saving ? '...' : '保存'}
                            </button>
                            <button
                              onClick={handleCancel}
                              className="px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleStartEdit(member)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors ${
                              rate > 0
                                ? 'text-gray-900 dark:text-gray-100 border-gray-200 dark:border-gray-700 hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                                : 'text-orange-600 border-orange-200 bg-orange-50 hover:bg-orange-100'
                            }`}
                          >
                            {rate > 0 ? (
                              <>¥{rate.toLocaleString()}</>
                            ) : (
                              <>未設定</>
                            )}
                            <Pencil className="w-3.5 h-3.5 text-gray-400" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400 w-14">月給</span>
                        {editingMonthlySalaryId === member.id ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm text-gray-500 dark:text-gray-400">¥</span>
                            <input
                              type="number"
                              value={editMonthlySalary}
                              onChange={(e) => setEditMonthlySalary(e.target.value)}
                              onKeyDown={(e) => handleMonthlySalaryKeyDown(e, member.id)}
                              className="w-28 px-2 py-1.5 text-sm border border-blue-400 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-blue-50 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                              autoFocus
                              disabled={saving}
                              min="0"
                              step="10000"
                            />
                            <button
                              onClick={() => handleSaveMonthlySalary(member.id)}
                              disabled={saving}
                              className="px-2.5 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
                            >
                              {saving ? '...' : '保存'}
                            </button>
                            <button
                              onClick={() => setEditingMonthlySalaryId(null)}
                              className="px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleStartEditMonthlySalary(member)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors ${
                              (member.monthly_salary ?? 0) > 0
                                ? 'text-gray-900 dark:text-gray-100 border-gray-200 dark:border-gray-700 hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                                : 'text-orange-600 border-orange-200 bg-orange-50 hover:bg-orange-100'
                            }`}
                          >
                            {(member.monthly_salary ?? 0) > 0 ? (
                              <>¥{(member.monthly_salary ?? 0).toLocaleString()}</>
                            ) : (
                              <>未設定</>
                            )}
                            <Pencil className="w-3.5 h-3.5 text-gray-400" />
                          </button>
                        )}
                      </div>
                    )}

                    {/* 深夜給 */}
                    <div className="flex items-center gap-1.5 ml-auto">
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={member.night_shift_enabled ?? false}
                          onChange={() => handleNightShiftToggle(member)}
                          className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 cursor-pointer"
                        />
                        <span className="text-xs text-gray-600 dark:text-gray-400">深夜給 <span className="font-medium">1.25x</span></span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="px-6 py-3 bg-gray-50 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-700">
        <p className="text-xs text-gray-500 dark:text-gray-400">深夜給: 22:00〜翌5:00 の勤務時間に対して時給1.25倍で計算されます</p>
      </div>
    </div>
  );
}
