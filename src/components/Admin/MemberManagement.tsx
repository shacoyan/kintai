import { useState, useEffect, useMemo } from 'react';
import { useTenantAdmin } from '../../hooks/useTenantAdmin';
import { useTenantRoles } from '../../hooks/useTenantRoles';
import { useTenant } from '../../hooks/useTenant';
import { useAuth } from '../../hooks/useAuth';
import type { TenantMember } from '../../types';
import { useToast } from '../../contexts/ToastContext';
import { useStoreContext } from '../../contexts/StoreContext';
import { BottomSheet } from '../ui/BottomSheet';
import { EmptyState } from '../ui/EmptyState';
import { ErrorBanner } from '../ui/ErrorBanner';
import { formatSupabaseError } from '../../lib/errors';
import { PageSkeleton } from '../ui/Skeleton';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Search, Trash2, Pencil, Users } from 'lucide-react';
import { messages } from '../../lib/messages';

interface MemberManagementProps {
  tenantId: string;
}

const roleBadge: Record<string, { label: string; className: string }> = {
  owner: { label: 'オーナー', className: 'bg-blue-100 text-blue-700 dark:bg-blue-700/30 dark:text-blue-300' },
  manager: { label: '店長', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-800/30 dark:text-emerald-200' },
  staff: { label: 'スタッフ', className: 'bg-stone-100 text-stone-800 dark:bg-stone-700 dark:text-stone-200' },
};

const AVATAR_PALETTE = [
  'bg-blue-100 text-blue-700 dark:bg-blue-700/30 dark:text-blue-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-700/30 dark:text-emerald-300',
  'bg-orange-100 text-orange-700 dark:bg-orange-700/30 dark:text-orange-300',
  'bg-purple-100 text-purple-700 dark:bg-purple-700/30 dark:text-purple-300',
  'bg-pink-100 text-pink-700 dark:bg-pink-700/30 dark:text-pink-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-700/30 dark:text-cyan-300',
];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

export function MemberManagement({ tenantId }: MemberManagementProps) {
  const { showToast } = useToast();
  const { myRole } = useTenant();
  const { user } = useAuth();
  const { currentStore } = useStoreContext();
  const { members, loading, error, fetchMembers, updateHourlyRate, updateNightShift, updateParttime, updatePayType, updateMonthlySalary, deleteMember, updateRole, updatePaidLeaveDays, updateRoleId } = useTenantAdmin(tenantId);
  const { roles, fetchRoles } = useTenantRoles(tenantId);
  const rolesMap = useMemo(() => {
    const m = new Map<string, typeof roles[number]>();
    for (const r of roles) m.set(r.id, r);
    return m;
  }, [roles]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingRoleId, setTogglingRoleId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState<string>('');
  const [editMonthlySalary, setEditMonthlySalary] = useState<string>('');
  const [editingMonthlySalaryId, setEditingMonthlySalaryId] = useState<string | null>(null);
  const [editingPaidLeaveDaysId, setEditingPaidLeaveDaysId] = useState<string | null>(null);
  const [editPaidLeaveDays, setEditPaidLeaveDays] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filterRoleId, setFilterRoleId] = useState<string>('all');

  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    fetchMembers(currentStore?.id ?? null);
  }, [fetchMembers, currentStore?.id]);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return members.filter(
      (m) =>
        (filterRoleId === 'all' || m.role_id === filterRoleId || (filterRoleId === 'none' && !m.role_id)) &&
        (q === '' || m.display_name.toLowerCase().includes(q))
    );
  }, [members, filterRoleId, search]);

  const handleRoleIdChange = async (member: TenantMember, roleId: string) => {
    try {
      await updateRoleId(member.id, roleId === '' ? null : roleId);
      showToast(messages.toast.updated('役職'), 'success');
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    }
  };

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
      showToast(messages.toast.saved('時給'), 'success');
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditRate('');
  };

  const handleKeyDown = (e: React.KeyboardEvent, memberId: string) => {
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return;
      handleSave(memberId);
    }
    if (e.key === 'Escape') handleCancel();
  };

  const handlePayTypeChange = async (member: TenantMember, payType: 'hourly' | 'monthly') => {
    try {
      await updatePayType(member.id, payType);
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
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
      showToast(messages.toast.saved('月給'), 'success');
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleMonthlySalaryKeyDown = (e: React.KeyboardEvent, memberId: string) => {
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return;
      handleSaveMonthlySalary(memberId);
    }
    if (e.key === 'Escape') setEditingMonthlySalaryId(null);
  };

  const handleStartEditPaidLeaveDays = (member: TenantMember) => {
    setEditingPaidLeaveDaysId(member.id);
    setEditPaidLeaveDays(String(member.paid_leave_days ?? 0));
  };

  const handleSavePaidLeaveDays = async (memberId: string) => {
    const days = parseFloat(editPaidLeaveDays);
    if (isNaN(days) || days < 0) {
      setEditingPaidLeaveDaysId(null);
      return;
    }
    setSaving(true);
    try {
      await updatePaidLeaveDays(memberId, days);
      setEditingPaidLeaveDaysId(null);
      showToast(messages.toast.saved('有給日数'), 'success');
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePaidLeaveDaysKeyDown = (e: React.KeyboardEvent, memberId: string) => {
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return;
      handleSavePaidLeaveDays(memberId);
    }
    if (e.key === 'Escape') setEditingPaidLeaveDaysId(null);
  };

  const handleRoleToggle = async (member: TenantMember) => {
    const newRole = member.role === 'manager' ? 'staff' : 'manager';
    setTogglingRoleId(member.id);
    try {
      await updateRole(member.id, newRole);
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setTogglingRoleId(null);
    }
  };

  const handleNightShiftToggle = async (member: TenantMember) => {
    try {
      await updateNightShift(member.id, !(member.night_shift_enabled ?? true));
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    }
  };

  const handleParttimeToggle = async (member: TenantMember) => {
    try {
      await updateParttime(member.id, !(member.is_parttime ?? false));
      showToast(messages.toast.updated('バイト判定'), 'success');
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    }
  };

  const handleDelete = async (memberId: string) => {
    try {
      await deleteMember(memberId);
      showToast(messages.toast.memberRemoved, 'success');
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    }
    setDeletingId(null);
  };

  if (myRole !== 'owner' && myRole !== 'manager') {
    return (
      <div className="bg-orange-50 border border-orange-100 rounded-lg p-4 text-center dark:bg-orange-800/20 dark:border-orange-700">
        <p className="text-orange-700 dark:text-orange-200">この機能を使用する権限がありません</p>
      </div>
    );
  }

  if (loading && members.length === 0) {
    return <PageSkeleton />;
  }

  if (error) {
    return <ErrorBanner message={error?.message ?? ''} onRetry={fetchMembers} />;
  }

  return (
    <Card padding="none" className="overflow-hidden bg-white dark:bg-stone-800">
      <div className="flex flex-col md:flex-row md:items-center gap-3 px-4 md:px-5 py-3 border-b border-stone-200 dark:border-stone-700 bg-stone-50/60 dark:bg-stone-900/40">
        <div className="relative md:w-[260px]">
          <Search className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-stone-400 dark:text-stone-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="名前で検索…"
            aria-label="メンバーを検索"
            className="pl-9 h-9"
          />
        </div>
        <select
          value={filterRoleId}
          onChange={(e) => setFilterRoleId(e.target.value)}
          className="text-sm border border-stone-200 dark:border-stone-600 rounded-md px-2.5 py-1.5 bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-100 h-9 md:w-[160px]"
          aria-label="役職で絞り込み"
        >
          <option value="all">全て</option>
          <option value="none">未設定</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <div className="hidden md:block flex-1" />
        <p className="text-xs text-stone-500 dark:text-stone-400 md:text-right whitespace-nowrap">
          対象: {currentStore ? currentStore.name : '全店舗'} ・ <span className="tabular-nums">{filtered.length}</span> 名
        </p>
      </div>

      {members.length === 0 ? (
        <EmptyState icon={<Users className="w-12 h-12 text-stone-400 dark:text-stone-500" />} title={messages.empty.member.title} description={messages.empty.member.description} />
      ) : (
        <>
            <div className="hidden md:block overflow-x-auto">
              <div className="min-w-[960px]">
                <div className="grid grid-cols-[36px,minmax(0,1fr),80px,160px,170px,110px,80px,60px,40px] gap-3 px-4 md:px-5 py-2.5 items-center bg-stone-50 dark:bg-stone-900/50 border-b border-stone-200 dark:border-stone-700 text-[10px] font-semibold text-stone-500 uppercase tracking-[0.04em]">
                  <div />
                  <div>名前</div>
                  <div>バイト</div>
                  <div>役職</div>
                  <div>時給/月給</div>
                  <div>有給</div>
                  <div>深夜</div>
                  <div>在職</div>
                  <div />
                </div>
                {filtered.map((member) => {
                    const badge = roleBadge[member.role] || roleBadge.staff;
                    const isEditing = editingId === member.id;
                    const rate = member.hourly_rate ?? 0;

                    return (
                      <div key={member.id} className="grid grid-cols-[36px,minmax(0,1fr),80px,160px,170px,110px,80px,60px,40px] gap-3 px-4 md:px-5 py-2.5 items-center border-t border-stone-100 dark:border-stone-700/60 hover:bg-stone-50 dark:hover:bg-stone-800/40 motion-safe:transition-colors">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center font-semibold text-xs shrink-0 ${avatarColor(member.display_name)}`}>
                          {member.display_name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium truncate text-stone-900 dark:text-stone-100">{member.display_name}</div>
                          <div className="text-[10px] text-stone-400 dark:text-stone-500 truncate">display: {member.display_name.slice(0, 6)}</div>
                        </div>
                        <div>
                          {(() => {
                            const isSelf = member.user_id === user?.id;
                            const isOwner = member.role === 'owner';
                            const isStaffViewer = (myRole as string) === 'staff';
                            const disabled = isStaffViewer || isSelf || isOwner;
                            const title = isOwner
                              ? 'オーナーはバイト判定の対象外です'
                              : isSelf
                                ? '自分自身のバイト判定は変更できません'
                                : isStaffViewer
                                  ? '権限がありません'
                                  : undefined;
                            return (
                              <label className={`inline-flex items-center gap-1.5 select-none ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`} title={title}>
                                <input
                                  type="checkbox"
                                  checked={member.is_parttime ?? false}
                                  disabled={disabled}
                                  onChange={() => {
                                    if (disabled) return;
                                    handleParttimeToggle(member);
                                  }}
                                  aria-label={`${member.display_name} のバイト判定`}
                                  className="h-4 w-4 text-blue-600 dark:text-blue-400 border-stone-300 dark:border-stone-600 rounded-md focus:ring-blue-500 dark:focus:ring-blue-400 cursor-pointer disabled:cursor-not-allowed"
                                />
                                <span className="text-xs text-stone-600 dark:text-stone-300">バイト</span>
                              </label>
                            );
                          })()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${badge.className}`}>{badge.label}</span>
                              {member.role !== 'owner' && myRole === 'owner' && (
                                <button
                                  role="switch"
                                  aria-checked={member.role === 'manager'}
                                  aria-label={`${member.display_name} の店長権限`}
                                  onClick={() => handleRoleToggle(member)}
                                  disabled={togglingRoleId === member.id}
                                  className={`px-2 py-1 text-xs font-medium rounded-md motion-safe:transition-colors ${
                                    member.role === 'manager'
                                      ? 'text-stone-600 dark:text-stone-300 bg-stone-100 dark:bg-stone-700 hover:bg-stone-200 dark:hover:bg-stone-600'
                                      : 'text-emerald-700 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-800/30 hover:bg-emerald-50 dark:hover:bg-emerald-800/50'
                                  } disabled:opacity-50`}
                                  title={member.role === 'manager' ? 'スタッフに変更' : '店長に変更'}
                                >
                                  {togglingRoleId === member.id ? '...' : member.role === 'manager' ? '→スタッフ' : '→店長'}
                                </button>
                              )}
                            </div>
                            <select
                              value={member.role_id ?? ''}
                              onChange={(e) => handleRoleIdChange(member, e.target.value)}
                              className="w-full text-xs border border-stone-200 dark:border-stone-600 rounded-md px-2 py-1 bg-white dark:bg-stone-700 dark:text-stone-100"
                              aria-label={`${member.display_name} の役職`}
                            >
                              <option value="">未設定</option>
                              {roles.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div>
                          <div className="space-y-2">
                            <div className="inline-flex rounded-md overflow-hidden border border-stone-200 dark:border-stone-600">
                              <button
                                onClick={() => handlePayTypeChange(member, 'hourly')}
                                className={`px-2.5 py-1 text-xs font-medium motion-safe:transition-colors ${
                                  (member.pay_type ?? 'hourly') === 'hourly'
                                    ? 'bg-blue-600 dark:bg-blue-500 text-white'
                                    : 'bg-white dark:bg-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-600'
                                }`}
                              >
                                時給
                              </button>
                              <button
                                onClick={() => handlePayTypeChange(member, 'monthly')}
                                className={`px-2.5 py-1 text-xs font-medium motion-safe:transition-colors ${
                                  member.pay_type === 'monthly'
                                    ? 'bg-blue-600 dark:bg-blue-500 text-white'
                                    : 'bg-white dark:bg-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-600'
                                }`}
                              >
                                月給
                              </button>
                            </div>
                            {(member.pay_type ?? 'hourly') === 'hourly' ? (
                              isEditing && !isMobile ? (
                                <div className="hidden md:flex items-center gap-2">
                                  <span className="text-sm text-stone-500 dark:text-stone-300">¥</span>
                                  <input
                                    type="number"
                                    value={editRate}
                                    onChange={(e) => setEditRate(e.target.value)}
                                    onKeyDown={(e) => handleKeyDown(e, member.id)}
                                    className="w-24 px-2 py-2 text-sm border border-blue-400 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 bg-blue-50 dark:bg-stone-700 dark:text-white dark:border-stone-600"
                                    autoFocus
                                    disabled={saving}
                                    min="0"
                                    step="50"
                                  />
                                  <Button variant="primary" size="sm" onClick={() => handleSave(member.id)} disabled={saving}>
                                    {saving ? '...' : '保存'}
                                  </Button>
                                  <Button variant="secondary" size="sm" onClick={handleCancel}>
                                    取消
                                  </Button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleStartEdit(member)}
                                  className={`inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border tabular-nums motion-safe:transition-colors ${
                                    rate > 0
                                      ? 'text-stone-800 dark:text-stone-100 border-stone-200 dark:border-stone-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-700/30'
                                      : 'text-orange-600 dark:text-orange-400 border-orange-100 dark:border-orange-700 bg-orange-50 dark:bg-orange-800 hover:bg-orange-50 dark:hover:bg-orange-700'
                                  }`}
                                >
                                  {rate > 0 ? (
                                    <>¥{rate.toLocaleString()}/h</>
                                  ) : (() => {
                                    const inheritedRate = member.role_id ? (rolesMap.get(member.role_id)?.default_hourly_rate ?? null) : null;
                                    if (inheritedRate != null && inheritedRate > 0) {
                                      return <span className="text-[11px] text-stone-500 dark:text-stone-300">役職時給 ¥{inheritedRate.toLocaleString()} (継承)</span>;
                                    }
                                    return <>未設定</>;
                                  })()}
                                  <Pencil className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                                </button>
                              )
                            ) : editingMonthlySalaryId === member.id && !isMobile ? (
                              <div className="hidden md:flex items-center gap-2">
                                <span className="text-sm text-stone-500 dark:text-stone-300">¥</span>
                                <input
                                  type="number"
                                  value={editMonthlySalary}
                                  onChange={(e) => setEditMonthlySalary(e.target.value)}
                                  onKeyDown={(e) => handleMonthlySalaryKeyDown(e, member.id)}
                                  className="w-28 px-2 py-2 text-sm border border-blue-400 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 bg-blue-50 dark:bg-stone-700 dark:text-white dark:border-stone-600"
                                  autoFocus
                                  disabled={saving}
                                  min="0"
                                  step="10000"
                                />
                                <Button variant="primary" size="sm" onClick={() => handleSaveMonthlySalary(member.id)} disabled={saving}>
                                  {saving ? '...' : '保存'}
                                </Button>
                                <Button variant="secondary" size="sm" onClick={() => setEditingMonthlySalaryId(null)}>
                                  取消
                                </Button>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleStartEditMonthlySalary(member)}
                                className={`inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border tabular-nums motion-safe:transition-colors ${
                                  (member.monthly_salary ?? 0) > 0
                                    ? 'text-stone-800 dark:text-stone-100 border-stone-200 dark:border-stone-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-700/30'
                                    : 'text-orange-600 dark:text-orange-400 border-orange-100 dark:border-orange-700 bg-orange-50 dark:bg-orange-800 hover:bg-orange-50 dark:hover:bg-orange-700'
                                }`}
                              >
                                {(member.monthly_salary ?? 0) > 0 ? <>¥{(member.monthly_salary ?? 0).toLocaleString()}/月</> : <>未設定</>}
                                <Pencil className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                              </button>
                            )}
                          </div>
                        </div>
                        <div>
                          {editingPaidLeaveDaysId === member.id && !isMobile ? (
                            <div className="hidden md:flex items-center gap-2">
                              <input
                                type="number"
                                value={editPaidLeaveDays}
                                onChange={(e) => setEditPaidLeaveDays(e.target.value)}
                                onKeyDown={(e) => handlePaidLeaveDaysKeyDown(e, member.id)}
                                className="w-20 px-2 py-2 text-sm border border-blue-400 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 bg-blue-50 dark:bg-stone-700 dark:text-white dark:border-stone-600"
                                autoFocus
                                disabled={saving}
                                min="0"
                                step="0.5"
                              />
                              <Button variant="primary" size="sm" onClick={() => handleSavePaidLeaveDays(member.id)} disabled={saving}>
                                {saving ? '...' : '保存'}
                              </Button>
                              <Button variant="secondary" size="sm" onClick={() => setEditingPaidLeaveDaysId(null)}>
                                取消
                              </Button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleStartEditPaidLeaveDays(member)}
                              className={`inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border tabular-nums motion-safe:transition-colors ${
                                (member.paid_leave_days ?? 0) > 0
                                  ? 'text-stone-800 dark:text-stone-100 border-stone-200 dark:border-stone-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-700/30'
                                  : 'text-orange-600 dark:text-orange-400 border-orange-100 dark:border-orange-700 bg-orange-50 dark:bg-orange-800 hover:bg-orange-50 dark:hover:bg-orange-700'
                              }`}
                            >
                              {(member.paid_leave_days ?? 0) > 0 ? <>{member.paid_leave_days ?? 0}日</> : <>未設定</>}
                              <Pencil className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                            </button>
                          )}
                        </div>
                        <div className="text-center">
                          <button
                            role="switch"
                            aria-checked={member.night_shift_enabled ?? true}
                            aria-label={`${member.display_name} の深夜給`}
                            onClick={() => handleNightShiftToggle(member)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full motion-safe:transition-colors ${(member.night_shift_enabled ?? true) ? 'bg-blue-600' : 'bg-stone-300 dark:bg-stone-600'}`}
                          >
                            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow motion-safe:transition-transform ${(member.night_shift_enabled ?? true) ? 'translate-x-4' : 'translate-x-0.5'}`} />
                          </button>
                        </div>
                        <div>
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            在職
                          </span>
                        </div>
                        <div className="text-right">
                          {member.role !== 'owner' && (
                            <button
                              onClick={() => setDeletingId(member.id)}
                              className="p-1.5 rounded-md text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700 hover:text-red-600 dark:hover:text-red-400 motion-safe:transition-colors"
                              title="メンバーを削除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="md:hidden">
              {filtered.map((member) => {
                const badge = roleBadge[member.role] || roleBadge.staff;
                const rate = member.hourly_rate ?? 0;

                return (
                  <div key={member.id} className="px-4 py-3 border-t border-stone-100 dark:border-stone-700/60 first:border-t-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm shrink-0 ${avatarColor(member.display_name)}`}>
                          {member.display_name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 truncate">{member.display_name}</p>
                          <p className="text-xs text-stone-400 dark:text-stone-500">{new Date(member.created_at).toLocaleDateString('ja-JP')} 参加</p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                          {(member.pay_type ?? 'hourly') === 'hourly'
                            ? rate > 0 ? `¥${rate.toLocaleString()}/h` : '未設定'
                            : (member.monthly_salary ?? 0) > 0 ? `¥${(member.monthly_salary ?? 0).toLocaleString()}/月` : '未設定'}
                        </div>
                        <div className="mt-0.5 text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
                          有給 {(member.paid_leave_days ?? 0) > 0 ? `${member.paid_leave_days ?? 0}日` : '未設定'}
                        </div>
                        {member.role !== 'owner' && (
                          <button
                            onClick={() => setDeletingId(member.id)}
                            className="mt-1 inline-flex p-1.5 rounded-md text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700 hover:text-red-600 dark:hover:text-red-400 motion-safe:transition-colors"
                            title="メンバーを削除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 ml-12 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${badge.className}`}>{badge.label}</span>
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${(member.is_parttime ?? false) ? 'bg-orange-100 text-orange-700 dark:bg-orange-700/30 dark:text-orange-300' : 'bg-stone-100 text-stone-700 dark:bg-stone-700 dark:text-stone-300'}`}>
                          {(member.is_parttime ?? false) ? 'バイト' : 'バイト外'}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          在職
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={member.role_id ?? ''}
                          onChange={(e) => handleRoleIdChange(member, e.target.value)}
                          className="text-sm border border-stone-200 dark:border-stone-600 rounded-md px-2 py-1 bg-white dark:bg-stone-700 dark:text-stone-100 min-h-[36px]"
                          aria-label={`${member.display_name} の役職`}
                        >
                          <option value="">未設定</option>
                          {roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                        {member.role !== 'owner' && myRole === 'owner' && (
                          <button
                            role="switch"
                            aria-checked={member.role === 'manager'}
                            aria-label={`${member.display_name} の店長権限`}
                            onClick={() => handleRoleToggle(member)}
                            disabled={togglingRoleId === member.id}
                            className={`px-2 py-1 text-xs font-medium rounded-md min-h-[36px] motion-safe:transition-colors ${
                              member.role === 'manager'
                                ? 'text-stone-600 dark:text-stone-300 bg-stone-100 dark:bg-stone-700 hover:bg-stone-200 dark:hover:bg-stone-600'
                                : 'text-emerald-700 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-800/30 hover:bg-emerald-50 dark:hover:bg-emerald-800/50'
                            } disabled:opacity-50`}
                            title={member.role === 'manager' ? 'スタッフに変更' : '店長に変更'}
                          >
                            {togglingRoleId === member.id ? '...' : member.role === 'manager' ? '→スタッフ' : '→店長'}
                          </button>
                        )}
                      </div>

                      <div className="inline-flex rounded-md overflow-hidden border border-stone-200 dark:border-stone-600">
                        <button
                          onClick={() => handlePayTypeChange(member, 'hourly')}
                          className={`px-3 py-1.5 text-xs font-medium motion-safe:transition-colors ${
                            (member.pay_type ?? 'hourly') === 'hourly'
                              ? 'bg-blue-600 dark:bg-blue-500 text-white'
                              : 'bg-white dark:bg-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-600'
                          }`}
                        >
                          時給
                        </button>
                        <button
                          onClick={() => handlePayTypeChange(member, 'monthly')}
                          className={`px-3 py-1.5 text-xs font-medium motion-safe:transition-colors ${
                            member.pay_type === 'monthly'
                              ? 'bg-blue-600 dark:bg-blue-500 text-white'
                              : 'bg-white dark:bg-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-600'
                          }`}
                        >
                          月給
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {(member.pay_type ?? 'hourly') === 'hourly' ? (
                          <button
                            onClick={() => handleStartEdit(member)}
                            className={`inline-flex items-center gap-2 px-3 py-2 min-h-[44px] text-sm rounded-md border tabular-nums motion-safe:transition-colors ${
                              rate > 0
                                ? 'text-stone-800 dark:text-stone-100 border-stone-200 dark:border-stone-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-700/30'
                                : 'text-orange-600 dark:text-orange-400 border-orange-100 dark:border-orange-700 bg-orange-50 dark:bg-orange-800 hover:bg-orange-50 dark:hover:bg-orange-700'
                            }`}
                          >
                            {rate > 0 ? (
                              <>¥{rate.toLocaleString()}/h</>
                            ) : (() => {
                              const inheritedRate = member.role_id ? (rolesMap.get(member.role_id)?.default_hourly_rate ?? null) : null;
                              if (inheritedRate != null && inheritedRate > 0) {
                                return <span className="text-[11px] text-stone-500 dark:text-stone-300">役職時給 ¥{inheritedRate.toLocaleString()} (継承)</span>;
                              }
                              return <>未設定</>;
                            })()}
                            <Pencil className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStartEditMonthlySalary(member)}
                            className={`inline-flex items-center gap-2 px-3 py-2 min-h-[44px] text-sm rounded-md border tabular-nums motion-safe:transition-colors ${
                              (member.monthly_salary ?? 0) > 0
                                ? 'text-stone-800 dark:text-stone-100 border-stone-200 dark:border-stone-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-700/30'
                                : 'text-orange-600 dark:text-orange-400 border-orange-100 dark:border-orange-700 bg-orange-50 dark:bg-orange-800 hover:bg-orange-50 dark:hover:bg-orange-700'
                            }`}
                          >
                            {(member.monthly_salary ?? 0) > 0 ? <>¥{(member.monthly_salary ?? 0).toLocaleString()}/月</> : <>未設定</>}
                            <Pencil className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                          </button>
                        )}
                        <button
                          onClick={() => handleStartEditPaidLeaveDays(member)}
                          className={`inline-flex items-center gap-2 px-3 py-2 min-h-[44px] text-sm rounded-md border tabular-nums motion-safe:transition-colors ${
                            (member.paid_leave_days ?? 0) > 0
                              ? 'text-stone-800 dark:text-stone-100 border-stone-200 dark:border-stone-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-700/30'
                              : 'text-orange-600 dark:text-orange-400 border-orange-100 dark:border-orange-700 bg-orange-50 dark:bg-orange-800 hover:bg-orange-50 dark:hover:bg-orange-700'
                          }`}
                        >
                          有給 {(member.paid_leave_days ?? 0) > 0 ? <>{member.paid_leave_days ?? 0}日</> : <>未設定</>}
                          <Pencil className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-4">
                        <label className="inline-flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300">
                          <span>深夜給</span>
                          <button
                            role="switch"
                            aria-checked={member.night_shift_enabled ?? true}
                            aria-label={`${member.display_name} の深夜給`}
                            onClick={() => handleNightShiftToggle(member)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full motion-safe:transition-colors ${(member.night_shift_enabled ?? true) ? 'bg-blue-600' : 'bg-stone-300 dark:bg-stone-600'}`}
                          >
                            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow motion-safe:transition-transform ${(member.night_shift_enabled ?? true) ? 'translate-x-4' : 'translate-x-0.5'}`} />
                          </button>
                        </label>

                        {(() => {
                          const isSelf = member.user_id === user?.id;
                          const isOwner = member.role === 'owner';
                          const isStaffViewer = (myRole as string) === 'staff';
                          const disabled = isStaffViewer || isSelf || isOwner;
                          const title = isOwner
                            ? 'オーナーはバイト判定の対象外です'
                            : isSelf
                              ? '自分自身のバイト判定は変更できません'
                              : isStaffViewer
                                ? '権限がありません'
                                : undefined;
                          return (
                            <label className={`inline-flex items-center gap-2 select-none ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`} title={title}>
                              <input
                                type="checkbox"
                                checked={member.is_parttime ?? false}
                                disabled={disabled}
                                onChange={() => {
                                  if (disabled) return;
                                  handleParttimeToggle(member);
                                }}
                                aria-label={`${member.display_name} のバイト判定`}
                                className="h-4 w-4 text-blue-600 dark:text-blue-400 border-stone-300 dark:border-stone-600 rounded-md focus:ring-blue-500 dark:focus:ring-blue-400 cursor-pointer disabled:cursor-not-allowed"
                              />
                              <span className="text-xs text-stone-600 dark:text-stone-300">バイト</span>
                            </label>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {filtered.length === 0 && (
              <div className="border-t border-stone-100 dark:border-stone-700/60 px-6 py-10 text-center text-sm text-stone-500 dark:text-stone-300">
                条件に一致するメンバーはいません
              </div>
            )}

            {filtered.map((member) => (
              <div key={`${member.id}-sheets`}>
                <BottomSheet
                  isOpen={deletingId === member.id}
                  onClose={() => setDeletingId(null)}
                  title="メンバーを削除しますか？"
                  description={`「${member.display_name}」さんの所属情報が完全に削除されます。この操作は元に戻せません。`}
                  footer={
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setDeletingId(null)}>
                        キャンセル
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => handleDelete(member.id)}>
                        削除する
                      </Button>
                    </div>
                  }
                >
                  <div />
                </BottomSheet>

                <BottomSheet
                  isOpen={isMobile && editingId === member.id}
                  onClose={handleCancel}
                  title={`時給を編集 — ${member.display_name}`}
                  footer={
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" size="md" onClick={handleCancel} className="min-h-[44px]">
                        キャンセル
                      </Button>
                      <Button variant="primary" size="md" onClick={() => handleSave(member.id)} disabled={saving} className="min-h-[44px]">
                        {saving ? '保存中...' : '保存'}
                      </Button>
                    </div>
                  }
                >
                  <div className="px-4 py-2">
                    <label className="block text-xs text-stone-500 dark:text-stone-300 mb-2">時給（円/時）</label>
                    <Input type="number" aria-label="時給 (円)" value={editRate} onChange={(e) => setEditRate(e.target.value)} autoFocus min="0" step="50" disabled={saving} />
                  </div>
                </BottomSheet>

                <BottomSheet
                  isOpen={isMobile && editingMonthlySalaryId === member.id}
                  onClose={() => setEditingMonthlySalaryId(null)}
                  title={`月給を編集 — ${member.display_name}`}
                  footer={
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" size="md" onClick={() => setEditingMonthlySalaryId(null)} className="min-h-[44px]">
                        キャンセル
                      </Button>
                      <Button variant="primary" size="md" onClick={() => handleSaveMonthlySalary(member.id)} disabled={saving} className="min-h-[44px]">
                        {saving ? '保存中...' : '保存'}
                      </Button>
                    </div>
                  }
                >
                  <div className="px-4 py-2">
                    <label className="block text-xs text-stone-500 dark:text-stone-300 mb-2">月給（円/月）</label>
                    <Input type="number" aria-label="月給 (円)" value={editMonthlySalary} onChange={(e) => setEditMonthlySalary(e.target.value)} autoFocus min="0" step="10000" disabled={saving} />
                  </div>
                </BottomSheet>

                <BottomSheet
                  isOpen={isMobile && editingPaidLeaveDaysId === member.id}
                  onClose={() => setEditingPaidLeaveDaysId(null)}
                  title={`有給日数を編集 — ${member.display_name}`}
                  footer={
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" size="md" onClick={() => setEditingPaidLeaveDaysId(null)} className="min-h-[44px]">
                        キャンセル
                      </Button>
                      <Button variant="primary" size="md" onClick={() => handleSavePaidLeaveDays(member.id)} disabled={saving} className="min-h-[44px]">
                        {saving ? '保存中...' : '保存'}
                      </Button>
                    </div>
                  }
                >
                  <div className="px-4 py-2">
                    <label className="block text-xs text-stone-500 dark:text-stone-300 mb-2">有給日数（日）</label>
                    <Input type="number" aria-label="有給日数" value={editPaidLeaveDays} onChange={(e) => setEditPaidLeaveDays(e.target.value)} autoFocus min="0" step="0.5" disabled={saving} />
                  </div>
                </BottomSheet>
              </div>
            ))}
          </>
        )}

        <div className="px-6 py-3 bg-stone-50 dark:bg-stone-900/50 border-t border-stone-200 dark:border-stone-700">
          <p className="text-xs text-stone-500 dark:text-stone-300">深夜給: 22:00〜翌5:00 の勤務時間に対して時給1.25倍で計算されます</p>
        </div>
    </Card>
  );
}
