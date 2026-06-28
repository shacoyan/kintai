import React, { useMemo, useState } from 'react';
import { Link2 } from 'lucide-react';
import { useTenant } from '../../contexts/TenantContext';
import { useCan } from '../../lib/permissions/useCan';
import { useToast } from '../../contexts/ToastContext';
import { formatSupabaseError } from '../../lib/errors';
import { Heading } from '../ui/Heading';
import { messages } from '../../lib/messages';
import { InviteUrlIssueModal } from './InviteUrlIssueModal';

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
  const { currentTenant, regenerateInviteCode } = useTenant();
  const can = useCan();
  const { showToast } = useToast();

  const [expiresInDays, setExpiresInDays] = useState<ExpiresOption>(7);
  const [maxUses, setMaxUses] = useState<MaxUsesOption>(3);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [urlModalOpen, setUrlModalOpen] = useState<boolean>(false);

  // C8 manageTenantSettings（書込 RPC 認可は TenantContext 内 throw + RLS で別途強制）。挙動不変。
  const canManageInvite = can('manageTenantSettings');

  const inviteCode = currentTenant?.invite_code ?? '';
  const expiresAt = currentTenant?.invite_code_expires_at ?? null;
  const codeMax = currentTenant?.invite_code_max_uses ?? null;
  const codeUsed = currentTenant?.invite_code_used_count ?? 0;
  const remainingUses = useMemo(() => {
    if (codeMax == null) return null;
    return Math.max(0, codeMax - codeUsed);
  }, [codeMax, codeUsed]);

  if (!canManageInvite) {
    return (
      <div className="bg-white dark:bg-stone-800 rounded-lg shadow p-4 border border-stone-100 dark:border-stone-700">
        <Heading level={2} as="h3" className="mb-2">
          招待コード設定
        </Heading>
        <p className="text-sm text-stone-500 dark:text-stone-300">
          {messages.invite.permissionDenied}
        </p>
      </div>
    );
  }

  const handleRegenerate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await regenerateInviteCode(tenantId, { expiresInDays, maxUses });
      showToast(messages.toast.inviteCodeReissued, 'success');
    } catch (err) {
      const msg = formatSupabaseError(err).message || '再発行に失敗しました';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-stone-800 rounded-lg shadow p-4 border border-stone-100 dark:border-stone-700">
      <Heading level={2} as="h3" className="mb-4">
        招待コード設定
      </Heading>

      {/* 現在の状態 */}
      <div className="mb-5 p-3 rounded-md bg-stone-50 dark:bg-stone-900/40 border border-stone-200 dark:border-stone-700 space-y-1">
        <div className="text-sm text-stone-700 dark:text-stone-300">
          現在の招待コード:
          <span className="ml-2 font-mono text-base font-semibold tracking-widest text-stone-900 dark:text-stone-100">
            {inviteCode || '—'}
          </span>
        </div>
        <div className="text-sm text-stone-700 dark:text-stone-300">
          残り使用回数:
          <span className="ml-2 font-medium text-stone-900 dark:text-stone-100">
            {remainingUses == null ? '無制限' : `${remainingUses} 回`}
            {codeMax != null && (
              <span className="ml-1 text-xs text-stone-500 dark:text-stone-300">
                ({codeUsed} / {codeMax})
              </span>
            )}
          </span>
        </div>
        <div className="text-sm text-stone-700 dark:text-stone-300">
          有効期限:
          <span className="ml-2 font-medium text-stone-900 dark:text-stone-100">
            {formatExpiresAt(expiresAt)}
          </span>
        </div>
      </div>

      {/* 期限選択 */}
      <fieldset className="mb-4">
        <legend className="text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">
          有効期限
        </legend>
        <div className="flex flex-wrap gap-3">
          {EXPIRES_LABELS.map((opt) => (
            <label
              key={String(opt.value)}
              className="inline-flex items-center text-sm text-stone-700 dark:text-stone-300 cursor-pointer"
            >
              <input
                type="radio"
                name="invite-expires"
                value={String(opt.value)}
                checked={expiresInDays === opt.value}
                onChange={() => setExpiresInDays(opt.value)}
                disabled={submitting}
                className="mr-1.5 text-blue-600 dark:text-blue-400 focus:ring-blue-500 dark:focus:ring-blue-400"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </fieldset>

      {/* 回数選択 */}
      <fieldset className="mb-5">
        <legend className="text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">
          使用回数上限
        </legend>
        <div className="flex flex-wrap gap-3">
          {MAX_USES_LABELS.map((opt) => (
            <label
              key={String(opt.value)}
              className="inline-flex items-center text-sm text-stone-700 dark:text-stone-300 cursor-pointer"
            >
              <input
                type="radio"
                name="invite-max-uses"
                value={String(opt.value)}
                checked={maxUses === opt.value}
                onChange={() => setMaxUses(opt.value)}
                disabled={submitting}
                className="mr-1.5 text-blue-600 dark:text-blue-400 focus:ring-blue-500 dark:focus:ring-blue-400"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <div className="mb-3 text-sm text-red-700 dark:text-red-200 bg-red-50 dark:bg-red-800/30 border border-red-100 dark:border-red-700 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:items-center">
        <button
          type="button"
          onClick={() => setUrlModalOpen(true)}
          disabled={submitting}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 bg-white dark:bg-stone-800 border border-blue-300 dark:border-blue-700 rounded-md hover:bg-blue-50 dark:hover:bg-blue-700/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={messages.invite.urlIssueTitle}
        >
          <Link2 className="h-4 w-4" aria-hidden="true" />
          {messages.invite.issueButton}
        </button>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={submitting}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 dark:bg-blue-500 rounded-md hover:bg-blue-700 dark:hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-blue-400 disabled:bg-stone-300 dark:disabled:bg-stone-600 disabled:cursor-not-allowed"
        >
          {submitting ? '再発行中...' : '招待コードを再発行'}
        </button>
      </div>

      <p className="mt-3 text-xs text-stone-500 dark:text-stone-300 leading-relaxed">
        再発行すると以前のコードは無効になります。設定した期限・回数は新コードに適用され、使用回数カウントは 0 にリセットされます。
      </p>

      <InviteUrlIssueModal
        tenantId={tenantId}
        isOpen={urlModalOpen}
        onClose={() => setUrlModalOpen(false)}
      />
    </div>
  );
};
