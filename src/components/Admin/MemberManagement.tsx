import { useState, useEffect } from 'react';
import { useAdmin } from '../../hooks/useAdmin';
import { useTenant } from '../../hooks/useTenant';
import type { TenantMember } from '../../types';

interface MemberManagementProps {
  tenantId: string;
}

const roleBadge: Record<string, { label: string; className: string }> = {
  owner: { label: 'オーナー', className: 'bg-blue-100 text-blue-800' },
  admin: { label: '管理者', className: 'bg-green-100 text-green-800' },
  staff: { label: 'スタッフ', className: 'bg-gray-100 text-gray-800' },
};

export function MemberManagement({ tenantId }: MemberManagementProps) {
  const { myRole } = useTenant();
  const { members, loading, error, fetchMembers, updateHourlyRate, updateNightShift } = useAdmin(tenantId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // エラーは3秒後に自動消去
  useEffect(() => {
    if (saveError) {
      const timer = setTimeout(() => setSaveError(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [saveError]);

  const handleStartEdit = (member: TenantMember) => {
    setEditingId(member.id);
    setEditRate(String(member.hourly_rate ?? 0));
    setSaveError(null);
  };

  const handleSave = async (memberId: string) => {
    const rate = parseInt(editRate, 10);
    if (isNaN(rate) || rate < 0) {
      setEditingId(null);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await updateHourlyRate(memberId, rate);
      setEditingId(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '時給の保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditRate('');
    setSaveError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, memberId: string) => {
    if (e.key === 'Enter') handleSave(memberId);
    if (e.key === 'Escape') handleCancel();
  };

  const handleNightShiftToggle = async (member: TenantMember) => {
    setSaveError(null);
    try {
      await updateNightShift(member.id, !member.night_shift_enabled);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '深夜給設定の更新に失敗しました');
    }
  };

  if (myRole !== 'owner' && myRole !== 'admin') {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
        <p className="text-yellow-700">この機能を使用する権限がありません</p>
      </div>
    );
  }

  if (loading && members.length === 0) {
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
        <button onClick={fetchMembers} className="mt-2 text-sm text-blue-600 hover:underline">再読み込み</button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">メンバー管理</h2>
        <p className="mt-1 text-sm text-gray-500">各メンバーの時給・深夜給を設定できます</p>
      </div>

      {saveError && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-600">{saveError}</p>
        </div>
      )}

      {/* カード型レイアウト（モバイル対応） */}
      <div className="divide-y divide-gray-200">
        {members.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">メンバーがいません</div>
        ) : (
          members.map((member) => {
            const badge = roleBadge[member.role] || roleBadge.staff;
            const isEditing = editingId === member.id;
            const rate = member.hourly_rate ?? 0;

            return (
              <div key={member.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                {/* 上段: 名前・ロール・参加日 */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm shrink-0">
                      {member.display_name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{member.display_name}</p>
                      <p className="text-xs text-gray-400">{new Date(member.created_at).toLocaleDateString('ja-JP')} 参加</p>
                    </div>
                  </div>
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                    {badge.label}
                  </span>
                </div>

                {/* 下段: 時給・深夜給 */}
                <div className="flex items-center gap-4 ml-12">
                  {/* 時給 */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-8">時給</span>
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm text-gray-500">¥</span>
                        <input
                          type="number"
                          value={editRate}
                          onChange={(e) => setEditRate(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, member.id)}
                          className="w-24 px-2 py-1.5 text-sm border border-blue-400 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-blue-50"
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
                          className="px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleStartEdit(member)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors ${
                          rate > 0
                            ? 'text-gray-900 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                            : 'text-orange-600 border-orange-200 bg-orange-50 hover:bg-orange-100'
                        }`}
                      >
                        {rate > 0 ? (
                          <>¥{rate.toLocaleString()}</>
                        ) : (
                          <>未設定</>
                        )}
                        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* 深夜給 */}
                  <div className="flex items-center gap-1.5 ml-auto">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={member.night_shift_enabled ?? false}
                        onChange={() => handleNightShiftToggle(member)}
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                      />
                      <span className="text-xs text-gray-600">深夜給 <span className="font-medium">1.25x</span></span>
                    </label>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
        <p className="text-xs text-gray-500">深夜給: 22:00〜翌5:00 の勤務時間に対して時給1.25倍で計算されます</p>
      </div>
    </div>
  );
}
