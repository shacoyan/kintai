import React, { useState, useMemo } from 'react';
import { useTenant } from '../../contexts/TenantContext';
import { useToast } from '../../contexts/ToastContext';
import { formatSupabaseError } from '../../lib/errors';
import { Heading } from '../ui/Heading';
import { messages } from '../../lib/messages';

interface TenantNameEditSectionProps {
  tenantId: string;
}

export const TenantNameEditSection: React.FC<TenantNameEditSectionProps> = ({
  tenantId,
}) => {
  const { currentTenant, isOwner, updateTenantName } = useTenant();
  const { showToast } = useToast();

  const [nameInput, setNameInput] = useState<string>(currentTenant?.name ?? '');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = useMemo(() => nameInput.trim(), [nameInput]);
  const isSame = trimmed === (currentTenant?.name ?? '').trim();
  const isInvalid = trimmed.length < 1 || trimmed.length > 50 || nameInput.trim().length === 0;
  const canSubmit = !submitting && !isSame && !isInvalid;

  if (!isOwner) {
    return (
      <div className="bg-white dark:bg-stone-800 rounded-lg shadow p-4 border border-stone-100 dark:border-stone-700">
        <Heading level={2} as="h3" className="mb-2">
          テナント表示名編集
        </Heading>
        <p className="text-sm text-stone-500 dark:text-stone-300">
          オーナーのみ実行可能です
        </p>
      </div>
    );
  }

  const handleSave = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await updateTenantName(tenantId, trimmed);
      showToast(messages.toast.saved(), 'success');
    } catch (err) {
      const msg = formatSupabaseError(err).message || '保存に失敗しました';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-stone-800 rounded-lg shadow p-4 border border-stone-100 dark:border-stone-700">
      <Heading level={2} as="h3" className="mb-4">
        テナント表示名編集
      </Heading>

      <div className="space-y-3">
        <div>
          <label htmlFor="tenant-name-input" className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
            テナント名
          </label>
          <input
            id="tenant-name-input"
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            maxLength={50}
            className="w-full px-3 py-2 border border-stone-300 dark:border-stone-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 dark:bg-stone-700 dark:text-stone-100 text-sm"
            placeholder="テナント名を入力"
          />
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-300">
            {trimmed.length} / 50 文字
          </p>
        </div>

        {error && (
          <p className="text-sm text-danger-600 dark:text-danger-400">{error}</p>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={!canSubmit}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          {submitting ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
};
