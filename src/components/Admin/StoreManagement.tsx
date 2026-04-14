import { useState, useEffect } from 'react';
import { useStore } from '../../hooks/useStore';
import { useAdmin } from '../../hooks/useAdmin';
import { useToast } from '../../contexts/ToastContext';
import type { Store } from '../../types';

interface StoreManagementProps {
  tenantId: string;
}

export function StoreManagement({ tenantId }: StoreManagementProps) {
  const { showToast } = useToast();
  const {
    stores, storeMembers, loading,
    fetchStores, createStore, updateStore, deleteStore,
    fetchStoreMembers, addStoreMember, removeStoreMember,
  } = useStore(tenantId);
  const { members: allMembers, fetchMembers } = useAdmin(tenantId);

  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [newStoreName, setNewStoreName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [togglingMember, setTogglingMember] = useState<string | null>(null);

  useEffect(() => {
    fetchStores();
    fetchMembers();
  }, [fetchStores, fetchMembers]);

  useEffect(() => {
    if (selectedStore) {
      fetchStoreMembers(selectedStore.id);
    }
  }, [selectedStore, fetchStoreMembers]);

  const handleCreateStore = async () => {
    if (!newStoreName.trim()) return;
    setCreating(true);
    try {
      await createStore(newStoreName.trim());
      setNewStoreName('');
      showToast('店舗を作成しました', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '店舗の作成に失敗しました', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteStore = async (store: Store) => {
    if (!window.confirm(`「${store.name}」を削除しますか？`)) return;
    try {
      await deleteStore(store.id);
      if (selectedStore?.id === store.id) {
        setSelectedStore(null);
      }
      showToast('店舗を削除しました', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '店舗の削除に失敗しました', 'error');
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
      showToast(err instanceof Error ? err.message : '店舗名の更新に失敗しました', 'error');
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
      showToast(err instanceof Error ? err.message : 'メンバーの変更に失敗しました', 'error');
    } finally {
      setTogglingMember(null);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 左側: 店舗一覧 + 作成フォーム */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">店舗一覧</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">店舗を選択するとメンバー管理ができます</p>
        </div>

        {/* 作成フォーム */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
          <div className="flex gap-2">
            <input
              type="text"
              value={newStoreName}
              onChange={(e) => setNewStoreName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateStore()}
              className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-gray-600"
              placeholder="店舗名を入力"
            />
            <button
              onClick={handleCreateStore}
              disabled={creating || !newStoreName.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {creating ? '作成中...' : '追加'}
            </button>
          </div>
        </div>

        {/* 店舗リスト */}
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {loading && stores.length === 0 ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            </div>
          ) : stores.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">店舗が未登録です</div>
          ) : (
            stores.map((store) => (
              <div
                key={store.id}
                className={`px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                  selectedStore?.id === store.id ? 'bg-blue-50 dark:bg-blue-900/30 border-l-4 border-blue-500' : ''
                }`}
                onClick={() => setSelectedStore(store)}
              >
                {editingStoreId === store.id ? (
                  <div className="flex-1 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(store.id);
                        if (e.key === 'Escape') setEditingStoreId(null);
                      }}
                      autoFocus
                      className="flex-1 px-2 py-1 text-sm border border-blue-400 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                    />
                    <button
                      onClick={() => handleSaveEdit(store.id)}
                      disabled={savingEdit || !editingName.trim()}
                      className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition"
                    >
                      {savingEdit ? '保存中' : '保存'}
                    </button>
                    <button
                      onClick={() => setEditingStoreId(null)}
                      className="px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition"
                    >
                      キャンセル
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="flex-1 text-sm font-medium text-gray-900 dark:text-gray-100">{store.name}</span>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleStartEdit(store)}
                        className="px-3 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/50 transition"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => handleDeleteStore(store)}
                        className="px-3 py-1 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition"
                      >
                        削除
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 右側: メンバー管理 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {selectedStore ? `${selectedStore.name} のメンバー` : 'メンバー管理'}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {selectedStore
              ? 'チェックを入れるとこの店舗に所属します'
              : '左の一覧から店舗を選択してください'}
          </p>
        </div>

        {!selectedStore ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <p className="text-sm">店舗を選択してください</p>
          </div>
        ) : allMembers.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">テナントにメンバーがいません</div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {allMembers.map((member) => {
              const assigned = isMemberAssigned(member.id);
              const toggling = togglingMember === member.id;
              return (
                <label
                  key={member.id}
                  className="flex items-center gap-3 px-6 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={assigned}
                    disabled={toggling}
                    onChange={() => handleToggleMember(member.id)}
                    className="h-4 w-4 text-blue-600 rounded border-gray-300 dark:border-gray-600 focus:ring-blue-500 cursor-pointer disabled:opacity-50"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{member.display_name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {member.role === 'owner' ? 'オーナー' : member.role === 'admin' ? '管理者' : 'スタッフ'}
                    </p>
                  </div>
                  {toggling && (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 flex-shrink-0"></div>
                  )}
                  {!toggling && assigned && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 flex-shrink-0">
                      所属中
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
