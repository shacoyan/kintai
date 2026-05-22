import React, { useEffect, useState } from 'react';
import { useTenant } from '../../contexts/TenantContext';
import { useTenantAdmin } from '../../hooks/useTenantAdmin';
import { useToast } from '../../contexts/ToastContext';
import { BottomSheet } from '../ui/BottomSheet';
import { Heading } from '../ui/Heading';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { formatSupabaseError } from '../../lib/errors';
import { messages } from '../../lib/messages';

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
      <div className="bg-white dark:bg-stone-900 rounded-lg shadow p-4">
        <Heading level={2} as="h3" className="mb-4">オーナー権限の移譲</Heading>
        <p className="text-stone-500 dark:text-stone-300 text-sm">オーナーのみ実行可能です</p>
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
      showToast(messages.toast.ownershipTransferred, 'success');
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
        className="px-4 py-2 text-sm font-medium text-stone-700 dark:text-stone-200 bg-stone-100 dark:bg-stone-800 rounded-md hover:bg-stone-200 dark:hover:bg-stone-700 disabled:opacity-50"
      >
        キャンセル
      </button>
      <Button variant="danger" onClick={handleTransfer} loading={submitting}>移譲を実行</Button>
    </div>
  );

  return (
    <>
      <div className="bg-white dark:bg-stone-900 rounded-lg shadow p-4">
        <Heading level={2} as="h3" className="mb-4">オーナー権限の移譲</Heading>
        
        {loading ? (
          <div className="text-sm text-stone-500 dark:text-stone-300"><Spinner size="sm" inline showLabel label="読み込み中" /></div>
        ) : managerCandidates.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-stone-500 dark:text-stone-300 text-sm">先にスタッフを店長 (manager) に昇格させてください</p>
          </div>
        ) : (
          <form onSubmit={handleOpenConfirm} className="space-y-4">
            <div>
              <label htmlFor="transfer-target" className="block text-sm font-medium text-stone-700 dark:text-stone-200 mb-1">
                譲渡先のユーザー
              </label>
              <select
                id="transfer-target"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                required
                className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-stone-300 dark:border-stone-700 focus:outline-none focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 sm:text-sm rounded-md border"
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
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 dark:bg-blue-500 rounded-md hover:bg-blue-700 dark:hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-blue-400 disabled:bg-stone-300 dark:disabled:bg-stone-600 disabled:cursor-not-allowed"
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
        <div className="p-4 text-sm bg-orange-50 dark:bg-orange-800/30 border-l-4 border-orange-400 dark:border-orange-600 text-stone-700 dark:text-stone-200">
          <p>
            権限を移譲すると、あなたは店長 (manager) に降格します。元に戻すには新オーナーの操作が必要です。本当に移譲しますか？
          </p>
        </div>
      </BottomSheet>
    </>
  );
};
