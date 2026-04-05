import { useState, useEffect } from 'react';
import { useAdmin } from '../../hooks/useAdmin';
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
  const { members, loading, error, fetchMembers, updateHourlyRate } = useAdmin(tenantId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleStartEdit = (member: TenantMember) => {
    setEditingId(member.id);
    setEditRate(String(member.hourly_rate));
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
    } catch {
      // error handled in useAdmin
    }
    setEditingId(null);
    setSaving(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent, memberId: string) => {
    if (e.key === 'Enter') handleSave(memberId);
    if (e.key === 'Escape') setEditingId(null);
  };

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
        <p className="mt-1 text-sm text-gray-500">時給をダブルクリックで編集できます</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">名前</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ロール</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">時給（円）</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">参加日</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {members.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-500">メンバーがいません</td>
              </tr>
            ) : (
              members.map((member) => {
                const badge = roleBadge[member.role] || roleBadge.staff;
                return (
                  <tr key={member.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {member.display_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {editingId === member.id ? (
                        <div className="flex items-center space-x-2">
                          <span className="text-gray-500">¥</span>
                          <input
                            type="number"
                            value={editRate}
                            onChange={(e) => setEditRate(e.target.value)}
                            onBlur={() => handleSave(member.id)}
                            onKeyDown={(e) => handleKeyDown(e, member.id)}
                            className="w-24 px-2 py-1 text-sm border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            autoFocus
                            disabled={saving}
                            min="0"
                            step="1"
                          />
                        </div>
                      ) : (
                        <span
                          className="cursor-pointer hover:text-blue-600 hover:underline"
                          onDoubleClick={() => handleStartEdit(member)}
                          title="ダブルクリックで編集"
                        >
                          ¥{(member.hourly_rate ?? 0).toLocaleString()}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(member.created_at).toLocaleDateString('ja-JP')}
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
