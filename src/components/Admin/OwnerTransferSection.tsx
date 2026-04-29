import React, { useEffect, useState } from 'react';
import { useTenant } from '../../contexts/TenantContext';
import { useTenantAdmin } from '../../hooks/useTenantAdmin';
import { useToast } from '../../contexts/ToastContext';
import { BottomSheet } from '../ui/BottomSheet';
import { formatSupabaseError } from '../../lib/errors';

interface OwnerTransferSectionProps {
  tenantId: string;
}

export const OwnerTransferSection: React.FC<OwnerTransferSectionProps> = ({ tenantId }) => {
  const { transferOwnership, isOwner } = useTenant();
  const { members, loading, fetchMembers } = useTenantAdmin(tenantId);
  const { showToast } = useToast();

  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [isConfirmOpen, setIsConfirmOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  if (!isOwner) {
    return (
      <div className="bg-white dark:bg-neutral-900 rounded-lg shadow p-4">
        <h3 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100 mb-4">オーナー権限の移譲</h3>
        <p className="text-neutral-500 dark:text-neutral-300 text-sm">オーナーのみ実行可能です</p>
      </div>
    );
  }

  const managerCandidates = members.filter((m) => m.role === 'manager');

  const handleOpenConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) return;
    setIsConfirmOpen(true);
  };

  const handleTransfer = async () => {
    setSubmitting(true);
    try {
      await transferOwnership(selectedUserId);
      showToast('権限を移譲しました', 'success');
      setIsConfirmOpen(false);
      setSelectedUserId('');
    } catch (e: unknown) {
      showToast(formatSupabaseError(e).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseSheet = () => {
    if (!submitting) {
      setIsConfirmOpen(false);
    }
  };

  const confirmFooter = (
    <div className="flex justify-end space-x-3">
      <button
        type="button"
        onClick={handleCloseSheet}
        disabled={submitting}
        className="px-4 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-700 disabled:opacity-50"
      >
        キャンセル
      </button>
      <button
        type="button"
        onClick={handleTransfer}
        disabled={submitting}
        className="px-4 py-2 text-sm font-medium text-white bg-red-600 dark:bg-red-500 rounded-md hover:bg-red-700 dark:hover:bg-red-500 disabled:opacity-50"
      >
        {submitting ? '処理中...' : '移譲を実行'}
      </button>
    </div>
  );

  return (
    <>
      <div className="bg-white dark:bg-neutral-900 rounded-lg shadow p-4">
        <h3 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100 mb-4">オーナー権限の移譲</h3>
        
        {loading ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-300 motion-safe:animate-pulse">読み込み中...</div>
        ) : managerCandidates.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-neutral-500 dark:text-neutral-300 text-sm">先にスタッフを店長 (manager) に昇格させてください</p>
          </div>
        ) : (
          <form onSubmit={handleOpenConfirm} className="space-y-4">
            <div>
              <label htmlFor="transfer-target" className="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
                譲渡先のユーザー
              </label>
              <select
                id="transfer-target"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                required
                className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-neutral-300 dark:border-neutral-700 focus:outline-none focus:ring-primary-500 dark:focus:ring-primary-400 focus:border-primary-500 dark:focus:border-primary-400 sm:text-sm rounded-md border"
              >
                <option value="" disabled>
                  店長を選択してください
                </option>
                {managerCandidates.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!selectedUserId}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 dark:bg-primary-500 rounded-md hover:bg-primary-700 dark:hover:bg-primary-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 dark:focus:ring-primary-400 disabled:bg-neutral-300 dark:disabled:bg-neutral-600 disabled:cursor-not-allowed"
              >
                権限を移譲する
              </button>
            </div>
          </form>
        )}
      </div>

      <BottomSheet
        isOpen={isConfirmOpen}
        onClose={handleCloseSheet}
        title="オーナー権限の移譲確認"
        footer={confirmFooter}
      >
        <div className="p-4 text-sm bg-amber-50 dark:bg-amber-900/30 border-l-4 border-amber-400 dark:border-amber-600 text-neutral-700 dark:text-neutral-200">
          <p>
            権限を移譲すると、あなたは店長 (manager) に降格します。元に戻すには新オーナーの操作が必要です。本当に移譲しますか？
          </p>
        </div>
      </BottomSheet>
    </>
  );
};
