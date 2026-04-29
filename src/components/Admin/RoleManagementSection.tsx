import { useState, useEffect } from 'react';
import { useTenantRoles } from '../../hooks/useTenantRoles';
import { Card, Button, Input, Heading } from '../ui';
import { BottomSheet } from '../ui/BottomSheet';
import { EmptyState } from '../ui/EmptyState';
import { ErrorBanner } from '../ui/ErrorBanner';
import { PageSkeleton } from '../ui/Skeleton';
import { useToast } from '../../contexts/ToastContext';
import { formatSupabaseError } from '../../lib/errors';
import { Trash2, Pencil, Plus } from 'lucide-react';
import type { TenantRole } from '../../types';

export function RoleManagementSection({ tenantId }: { tenantId: string }) {
  const { roles, loading, error, fetchRoles, createRole, updateRole, deleteRole } = useTenantRoles(tenantId);
  const { showToast } = useToast();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<TenantRole | null>(null);
  
  const [name, setName] = useState('');
  const [defaultHourlyRate, setDefaultHourlyRate] = useState('');
  const [defaultMonthlySalary, setDefaultMonthlySalary] = useState('');
  const [color, setColor] = useState('');
  const [sortOrder, setSortOrder] = useState(0);

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletingRole, setDeletingRole] = useState<TenantRole | null>(null);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  const openCreateForm = () => {
    setEditingRole(null);
    setName('');
    setDefaultHourlyRate('');
    setDefaultMonthlySalary('');
    setColor('');
    setSortOrder(0);
    setIsFormOpen(true);
  };

  const openEditForm = (role: TenantRole) => {
    setEditingRole(role);
    setName(role.name);
    setDefaultHourlyRate(role.default_hourly_rate != null ? String(role.default_hourly_rate) : '');
    setDefaultMonthlySalary(role.default_monthly_salary != null ? String(role.default_monthly_salary) : '');
    setColor(role.color ?? '');
    setSortOrder(role.sort_order ?? 0);
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      showToast('役職名を入力してください', 'error');
      return;
    }

    const parsedHourly = defaultHourlyRate.trim() === '' ? null : Number(defaultHourlyRate);
    const parsedMonthly = defaultMonthlySalary.trim() === '' ? null : Number(defaultMonthlySalary);
    const payload: {
      name: string;
      default_hourly_rate: number | null;
      default_monthly_salary: number | null;
      color: string | null;
      sort_order: number;
    } = {
      name: name.trim(),
      default_hourly_rate: parsedHourly == null || isNaN(parsedHourly) ? null : parsedHourly,
      default_monthly_salary: parsedMonthly == null || isNaN(parsedMonthly) ? null : parsedMonthly,
      color: color.trim() === '' ? null : color.trim(),
      sort_order: sortOrder,
    };

    try {
      if (editingRole) {
        await updateRole(editingRole.id, payload);
        showToast('役職を更新しました', 'success');
      } else {
        await createRole(payload);
        showToast('役職を追加しました', 'success');
      }
      setIsFormOpen(false);
    } catch (e: unknown) {
      const f = formatSupabaseError(e);
      showToast(f.message, 'error');
    }
  };

  const openDeleteConfirm = (role: TenantRole) => {
    setDeletingRole(role);
    setIsDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingRole) return;
    try {
      await deleteRole(deletingRole.id);
      showToast('役職を削除しました', 'success');
      setIsDeleteOpen(false);
    } catch (e: unknown) {
      const f = formatSupabaseError(e);
      showToast(f.message, 'error');
    }
  };

  const formatCurrency = (value: number | null | undefined) => {
    return value != null ? `¥${value.toLocaleString()}` : '-';
  };

  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-4">
        <Heading level={2} as="h3">役職管理</Heading>
        <Button variant="primary" size="sm" onClick={openCreateForm} className="flex items-center gap-1">
          <Plus className="w-4 h-4" />
          役職を追加
        </Button>
      </div>

      {error && <ErrorBanner message={error.message} />}
      
      {roles.length === 0 && loading ? (
        <PageSkeleton />
      ) : roles.length === 0 ? (
        <EmptyState title="役職がまだありません" description="「役職を追加」から最初の役職を登録してください" />
      ) : (
        <>
          {/* PC Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-neutral-500 dark:text-neutral-300 uppercase border-b">
                <tr>
                  <th className="px-4 py-3">名前</th>
                  <th className="px-4 py-3">デフォ時給</th>
                  <th className="px-4 py-3">デフォ月給</th>
                  <th className="px-4 py-3">色</th>
                  <th className="px-4 py-3">並び順</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id} className="border-b hover:bg-neutral-50 dark:hover:bg-neutral-800">
                    <td className="px-4 py-3 font-medium text-neutral-900 dark:text-neutral-100">{role.name}</td>
                    <td className="px-4 py-3">{formatCurrency(role.default_hourly_rate)}</td>
                    <td className="px-4 py-3">{formatCurrency(role.default_monthly_salary)}</td>
                    <td className="px-4 py-3">
                      {role.color ? (
                        <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: role.color }} />
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3">{role.sort_order ?? 0}</td>
                    <td className="px-4 py-3 flex gap-2">
                      <button onClick={() => openEditForm(role)} className="text-neutral-500 dark:text-neutral-300 hover:text-blue-600 dark:hover:text-blue-400" aria-label={`役職『${role.name}』を編集`}>
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => openDeleteConfirm(role)} className="text-neutral-500 dark:text-neutral-300 hover:text-red-600 dark:hover:text-red-400" aria-label={`役職『${role.name}』を削除`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* SP Card List */}
          <div className="md:hidden space-y-4">
            {roles.map((role) => (
              <div key={role.id} className="p-4 bg-white dark:bg-neutral-900 border rounded-lg shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    {role.color && <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: role.color }} />}
                    <Heading level={3} as="h4">{role.name}</Heading>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openEditForm(role)} className="p-1 text-neutral-400 dark:text-neutral-500 hover:text-blue-600 dark:hover:text-blue-400" aria-label={`役職『${role.name}』を編集`}>
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => openDeleteConfirm(role)} className="p-1 text-neutral-400 dark:text-neutral-500 hover:text-red-600 dark:hover:text-red-400" aria-label={`役職『${role.name}』を削除`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-neutral-500 dark:text-neutral-300">デフォ時給</dt>
                  <dd className="text-neutral-900 dark:text-neutral-100">{formatCurrency(role.default_hourly_rate)}</dd>
                  <dt className="text-neutral-500 dark:text-neutral-300">デフォ月給</dt>
                  <dd className="text-neutral-900 dark:text-neutral-100">{formatCurrency(role.default_monthly_salary)}</dd>
                  <dt className="text-neutral-500 dark:text-neutral-300">並び順</dt>
                  <dd className="text-neutral-900 dark:text-neutral-100">{role.sort_order ?? 0}</dd>
                </dl>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Form BottomSheet */}
      <BottomSheet
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={editingRole ? '役職を編集' : '役職を追加'}
        footer={
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="tertiary" onClick={() => setIsFormOpen(false)}>キャンセル</Button>
            <Button variant="primary" onClick={handleSave}>保存</Button>
          </div>
        }
      >
        <div className="space-y-4 p-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">役職名 <span className="text-red-500 dark:text-red-400">*</span></label>
            <Input placeholder="例: マネージャー" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">デフォルト時給</label>
            <Input type="number" placeholder="例: 1500" value={defaultHourlyRate} onChange={(e) => setDefaultHourlyRate(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">デフォルト月給</label>
            <Input type="number" placeholder="例: 250000" value={defaultMonthlySalary} onChange={(e) => setDefaultMonthlySalary(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">カラー</label>
            <div className="flex gap-2 items-center">
              <input type="color" value={color || '#000000'} onChange={(e) => setColor(e.target.value)} className="w-10 h-10 rounded cursor-pointer border p-1" />
              <Input placeholder="#3b82f6" value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">並び順</label>
            <Input type="number" placeholder="0" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
          </div>
        </div>
      </BottomSheet>

      {/* Delete Confirmation BottomSheet */}
      <BottomSheet
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        title="役職の削除"
        footer={
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="tertiary" onClick={() => setIsDeleteOpen(false)}>キャンセル</Button>
            <Button variant="danger" onClick={handleDelete}>削除</Button>
          </div>
        }
      >
        <div className="p-4 text-sm text-neutral-700 dark:text-neutral-200">
          役職『{deletingRole?.name}』を削除します。割り当てられているメンバーの役職は未設定になります。
        </div>
      </BottomSheet>
    </Card>
  );
}
