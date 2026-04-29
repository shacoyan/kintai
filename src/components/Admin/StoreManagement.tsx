import { useState, useEffect } from 'react';
import { useStore } from '../../hooks/useStore';
import { useTenantAdmin } from '../../hooks/useTenantAdmin';
import { useToast } from '../../contexts/ToastContext';
import { formatSupabaseError } from '../../lib/errors';
import type { Store } from '../../types';
import { BottomSheet } from '../ui/BottomSheet';
import { Heading } from '../ui/Heading';
import { EmptyState } from '../ui/EmptyState';
import { PageSkeleton } from '../ui/Skeleton';
import { Store as StoreIcon } from 'lucide-react';
import { Spinner } from '../ui/Spinner';
import { useTenant } from '../../hooks/useTenant';
import { Card, Button, Badge } from '../ui';

interface StoreManagementProps {
  tenantId: string;
}

export function StoreManagement({ tenantId }: StoreManagementProps) {
  const { showToast } = useToast();
  const {
    stores, storeMembers, loading,
    fetchStores, createStore, updateStore, deleteStore,
    fetchStoreMembers, addStoreMember, removeStoreMember,
    setStoreMemberManager,
  } = useStore(tenantId);
  const { members: allMembers, fetchMembers } = useTenantAdmin(tenantId);
  const { myRole } = useTenant();
  const isOwner = myRole === 'owner';

  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [newStoreName, setNewStoreName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [togglingMember, setTogglingMember] = useState<string | null>(null);
  const [confirmDeleteStore, setConfirmDeleteStore] = useState<Store | null>(null);
  const [togglingManagerId, setTogglingManagerId] = useState<string | null>(null);
  const [isLargeScreen, setIsLargeScreen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true
  );

  useEffect(() => {
    fetchStores();
    fetchMembers();
  }, [fetchStores, fetchMembers]);

  useEffect(() => {
    if (selectedStore) {
      fetchStoreMembers(selectedStore.id);
    }
  }, [selectedStore, fetchStoreMembers]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsLargeScreen(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const handleCreateStore = async () => {
    if (!newStoreName.trim()) return;
    setCreating(true);
    try {
      await createStore(newStoreName.trim());
      setNewStoreName('');
      showToast('店舗を作成しました', 'success');
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const doDeleteStore = async () => {
    if (!confirmDeleteStore) return;
    try {
      await deleteStore(confirmDeleteStore.id);
      if (selectedStore?.id === confirmDeleteStore.id) {
        setSelectedStore(null);
      }
      showToast('店舗を削除しました', 'success');
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setConfirmDeleteStore(null);
    }
  };

  const handleStartEdit = (store: Store) => {
    setEditingStoreId(store.id);
    setEditingName(store.name);
  };

  const handleSaveEdit = async (storeId: string) => {
    if (!editingName.trim()) return;
    setSavingEdit(true);
    try {
      await updateStore(storeId, editingName.trim());
      if (selectedStore?.id === storeId) {
        setSelectedStore((prev) => prev ? { ...prev, name: editingName.trim() } : null);
      }
      setEditingStoreId(null);
      showToast('店舗名を更新しました', 'success');
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const isMemberAssigned = (memberId: string) =>
    storeMembers.some((sm) => sm.member_id === memberId);

  const handleToggleMember = async (memberId: string) => {
    if (!selectedStore) return;
    setTogglingMember(memberId);
    try {
      if (isMemberAssigned(memberId)) {
        await removeStoreMember(selectedStore.id, memberId);
        showToast('メンバーを外しました', 'success');
      } else {
        await addStoreMember(selectedStore.id, memberId);
        showToast('メンバーを追加しました', 'success');
      }
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setTogglingMember(null);
    }
  };

  const handleToggleStoreManager = async (memberId: string, nextValue: boolean) => {
    if (!selectedStore) return;
    setTogglingManagerId(memberId);
    try {
      await setStoreMemberManager(selectedStore.id, memberId, nextValue);
      showToast(nextValue ? '店長に任命しました' : '店長権限を外しました', 'success');
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setTogglingManagerId(null);
    }
  };

  let memberManagementContent: React.ReactNode = null;
  if (selectedStore) {
    if (allMembers.length === 0) {
      memberManagementContent = (
        <EmptyState title="テナントにメンバーがいません" description="先にメンバーをテナントに招待してください" />
      );
    } else {
      memberManagementContent = (
        <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
          {allMembers.map((member) => {
            const assigned = isMemberAssigned(member.id);
            const toggling = togglingMember === member.id;
            const is_manager = storeMembers.find(sm => sm.member_id === member.id)?.is_manager === true;
            return (
              <label
                key={member.id}
                className="flex items-center gap-3 px-6 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-700 cursor-pointer motion-safe:transition-colors"
              >
                <input
                  type="checkbox"
                  checked={assigned}
                  disabled={toggling}
                  onChange={() => handleToggleMember(member.id)}
                  className="h-4 w-4 text-primary-600 dark:text-primary-400 rounded border-neutral-300 dark:border-neutral-600 focus:ring-primary-500 dark:focus:ring-primary-400 cursor-pointer disabled:opacity-50"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">{member.display_name}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-300">
                    {member.role === 'owner' ? 'オーナー' : member.role === 'manager' ? '店長' : 'スタッフ'}
                  </p>
                </div>
                {toggling && (
                  <Spinner size="sm" inline className="text-primary-600 dark:text-primary-400 flex-shrink-0" />
                )}
                {!toggling && assigned && (
                  <Badge tone="primary">
                    所属中
                  </Badge>
                )}
                {assigned === true && (
                  <button
                    role="switch"
                    aria-checked={is_manager}
                    aria-label={`${member.display_name} の店長権限`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleToggleStoreManager(member.id, !is_manager);
                    }}
                    disabled={!isOwner || togglingManagerId === member.id}
                    className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium motion-safe:transition disabled:opacity-50 disabled:cursor-not-allowed ${
                      is_manager
                        ? 'bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-300'
                        : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300'
                    }`}
                    title={isOwner ? (is_manager ? '店長権限を外す' : '店長に任命') : 'オーナーのみ操作可能'}
                  >
                    {togglingManagerId === member.id ? '...' : (is_manager ? '店長' : '→店長')}
                  </button>
                )}
              </label>
            );
          })}
        </div>
      );
    }
  } else {
    memberManagementContent = (
      <EmptyState 
        icon={<StoreIcon className="w-12 h-12 text-neutral-400 dark:text-neutral-500" />} 
        title="店舗を選択してください" 
        description="左の一覧から店舗を選ぶとメンバー管理ができます" 
      />
    );
  }

  return (
    <>
      <div className="lg:grid lg:grid-cols-2 lg:gap-6">
        {/* 左側: 店舗一覧 + 作成フォーム */}
        <Card padding="none">
          <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-700">
            <Heading level={2}>店舗一覧</Heading>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-300">店舗を選択するとメンバー管理ができます</p>
          </div>

          {/* 作成フォーム */}
          <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-700">
            <div className="flex gap-2">
              <input
                type="text"
                value={newStoreName}
                onChange={(e) => setNewStoreName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateStore()}
                className="flex-1 px-3 py-2 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-400 dark:bg-neutral-700 dark:text-white dark:border-neutral-600"
                placeholder="店舗名を入力"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={handleCreateStore}
                loading={creating}
                disabled={!newStoreName.trim()}
              >
                追加
              </Button>
            </div>
          </div>

          {/* 店舗リスト */}
          <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
            {loading && stores.length === 0 ? (
              <PageSkeleton />
            ) : stores.length === 0 ? (
              <EmptyState title="店舗が未登録です" description="上のフォームから店舗を追加してください" />
            ) : (
              stores.map((store) => (
                <div
                  key={store.id}
                  className={`px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-700 motion-safe:transition-colors ${
                    selectedStore?.id === store.id ? 'bg-primary-50 dark:bg-primary-900/30 border-l-4 border-primary-500 dark:border-primary-400' : ''
                  }`}
                  onClick={() => setSelectedStore(store)}
                >
                  {editingStoreId === store.id ? (
                    <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit(store.id);
                          if (e.key === 'Escape') setEditingStoreId(null);
                        }}
                        autoFocus
                        className="flex-1 px-2 py-1 text-sm border border-primary-400 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-400 dark:bg-neutral-700 dark:text-white dark:border-neutral-600"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleSaveEdit(store.id)}
                          disabled={savingEdit || !editingName.trim()}
                        >
                          {savingEdit ? '保存中' : '保存'}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setEditingStoreId(null)}
                        >
                          キャンセル
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="flex-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">{store.name}</span>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="tertiary"
                          size="sm"
                          onClick={() => handleStartEdit(store)}
                        >
                          編集
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setConfirmDeleteStore(store)}
                        >
                          削除
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>

        {/* 右側: メンバー管理 */}
        <div className="hidden lg:block">
          <Card padding="none">
            <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-700">
              <Heading level={2}>
                {selectedStore ? `${selectedStore.name} のメンバー` : 'メンバー管理'}
              </Heading>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-300">
                {selectedStore
                  ? 'チェックを入れるとこの店舗に所属します'
                  : '左の一覧から店舗を選択してください'}
              </p>
            </div>
            {memberManagementContent}
          </Card>
        </div>
      </div>

      {/* SP: メンバー管理 BottomSheet */}
      <BottomSheet
        isOpen={!!selectedStore && !isLargeScreen}
        onClose={() => setSelectedStore(null)}
        title={selectedStore ? `${selectedStore.name} のメンバー` : ''}
      >
        {memberManagementContent}
      </BottomSheet>

      <BottomSheet
        isOpen={!!confirmDeleteStore}
        onClose={() => setConfirmDeleteStore(null)}
        title="店舗を削除しますか？"
        description={confirmDeleteStore ? `「${confirmDeleteStore.name}」を削除します。関連するシフト・店舗メンバー情報も失われます` : ''}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmDeleteStore(null)}
            >
              キャンセル
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={doDeleteStore}
            >
              削除
            </Button>
          </div>
        }
      >
        <p className="text-sm text-neutral-600 dark:text-neutral-300">この操作は取り消せません。</p>
      </BottomSheet>
    </>
  );
}
