import React, { useMemo, useState } from 'react';
import { useTenant } from '../../contexts/TenantContext';
import { useToast } from '../../contexts/ToastContext';
import { formatSupabaseError } from '../../lib/errors';

interface InviteCodeSettingsSectionProps {
  tenantId: string;
}

type ExpiresOption = 1 | 7 | 30 | null;
type MaxUsesOption = 1 | 3 | 10 | null;

const EXPIRES_LABELS: { value: ExpiresOption; label: string }[] = [
  { value: 1, label: '1日' },
  { value: 7, label: '7日' },
  { value: 30, label: '30日' },
  { value: null, label: '無期限' },
];

const MAX_USES_LABELS: { value: MaxUsesOption; label: string }[] = [
  { value: 1, label: '1回' },
  { value: 3, label: '3回' },
  { value: 10, label: '10回' },
  { value: null, label: '無制限' },
];

function formatExpiresAt(iso: string | null | undefined): string {
  if (!iso) return '無期限';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '不明';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

export const InviteCodeSettingsSection: React.FC<InviteCodeSettingsSectionProps> = ({
  tenantId,
}) => {
  const { currentTenant, isOwner, regenerateInviteCode } = useTenant();
  const { showToast } = useToast();

  const [expiresInDays, setExpiresInDays] = useState<ExpiresOption>(7);
  const [maxUses, setMaxUses] = useState<MaxUsesOption>(3);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const inviteCode = currentTenant?.invite_code ?? '';
  const expiresAt = currentTenant?.invite_code_expires_at ?? null;
  const codeMax = currentTenant?.invite_code_max_uses ?? null;
  const codeUsed = currentTenant?.invite_code_used_count ?? 0;
  const remainingUses = useMemo(() => {
    if (codeMax == null) return null;
    return Math.max(0, codeMax - codeUsed);
  }, [codeMax, codeUsed]);

  if (!isOwner) {
    return (
      <div className="bg-white dark:bg-neutral-800 rounded-lg shadow p-4 border border-neutral-100 dark:border-neutral-700">
        <h3 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100 mb-2">
          招待コード設定
        </h3>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          オーナーのみ実行可能です
        </p>
      </div>
    );
  }

  const handleRegenerate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await regenerateInviteCode(tenantId, { expiresInDays, maxUses });
      showToast('招待コードを再発行しました', 'success');
    } catch (err) {
      const msg = formatSupabaseError(err).message || '再発行に失敗しました';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-lg shadow p-4 border border-neutral-100 dark:border-neutral-700">
      <h3 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100 mb-4">
        招待コード設定
      </h3>

      {/* 現在の状態 */}
      <div className="mb-5 p-3 rounded-md bg-neutral-50 dark:bg-neutral-900/40 border border-neutral-200 dark:border-neutral-700 space-y-1">
        <div className="text-sm text-neutral-700 dark:text-neutral-300">
          現在の招待コード:
          <span className="ml-2 font-mono text-base font-semibold tracking-widest text-neutral-900 dark:text-neutral-100">
            {inviteCode || '—'}
          </span>
        </div>
        <div className="text-sm text-neutral-700 dark:text-neutral-300">
          残り使用回数:
          <span className="ml-2 font-medium text-neutral-900 dark:text-neutral-100">
            {remainingUses == null ? '無制限' : `${remainingUses} 回`}
            {codeMax != null && (
              <span className="ml-1 text-xs text-neutral-500 dark:text-neutral-400">
                ({codeUsed} / {codeMax})
              </span>
            )}
          </span>
        </div>
        <div className="text-sm text-neutral-700 dark:text-neutral-300">
          有効期限:
          <span className="ml-2 font-medium text-neutral-900 dark:text-neutral-100">
            {formatExpiresAt(expiresAt)}
          </span>
        </div>
      </div>

      {/* 期限選択 */}
      <fieldset className="mb-4">
        <legend className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
          有効期限
        </legend>
        <div className="flex flex-wrap gap-3">
          {EXPIRES_LABELS.map((opt) => (
            <label
              key={String(opt.value)}
              className="inline-flex items-center text-sm text-neutral-700 dark:text-neutral-300 cursor-pointer"
            >
              <input
                type="radio"
                name="invite-expires"
                value={String(opt.value)}
                checked={expiresInDays === opt.value}
                onChange={() => setExpiresInDays(opt.value)}
                disabled={submitting}
                className="mr-1.5 text-primary-600 focus:ring-primary-500"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </fieldset>

      {/* 回数選択 */}
      <fieldset className="mb-5">
        <legend className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
          使用回数上限
        </legend>
        <div className="flex flex-wrap gap-3">
          {MAX_USES_LABELS.map((opt) => (
            <label
              key={String(opt.value)}
              className="inline-flex items-center text-sm text-neutral-700 dark:text-neutral-300 cursor-pointer"
            >
              <input
                type="radio"
                name="invite-max-uses"
                value={String(opt.value)}
                checked={maxUses === opt.value}
                onChange={() => setMaxUses(opt.value)}
                disabled={submitting}
                className="mr-1.5 text-primary-600 focus:ring-primary-500"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <div className="mb-3 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={submitting}
          className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:bg-neutral-300 dark:disabled:bg-neutral-600 disabled:cursor-not-allowed"
        >
          {submitting ? '再発行中...' : '招待コードを再発行'}
        </button>
      </div>

      <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
        再発行すると以前のコードは無効になります。設定した期限・回数は新コードに適用され、使用回数カウントは 0 にリセットされます。
      </p>
    </div>
  );
};
