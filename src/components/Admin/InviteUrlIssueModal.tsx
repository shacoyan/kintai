/**
 * 招待URL発行モーダル（admin 画面用）。
 *
 * - owner / manager のみ起動可能（呼び出し側でガード前提だが本コンポーネント内でも防衛的にチェック）
 * - 店舗複数選択（チェックボックス）+ 期限プリセット + 上限プリセット
 * - 「招待URLを発行」→ regenerateInviteCode(tenantId, { expiresInDays, maxUses, storeIds })
 * - 成功で URL 表示 + コピー（buildInviteUrl(code)）
 *
 * 設計書: .company/engineering/docs/2026-05-10-kintai-invite-url-techdesign.md §5.2
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { useTenant } from '../../contexts/TenantContext';
import { useToast } from '../../contexts/ToastContext';
import { useStore } from '../../hooks/useStore';
import { formatSupabaseError } from '../../lib/errors';
import { buildInviteUrl } from '../../lib/inviteUrl';
import { messages } from '../../lib/messages';
import type { Store } from '../../types';

interface InviteUrlIssueModalProps {
  tenantId: string;
  isOpen: boolean;
  onClose: () => void;
}

type ExpiresOption = 1 | 7 | 30 | null;
type MaxUsesOption = 1 | 3 | 10 | null;

const EXPIRES_OPTIONS: { value: ExpiresOption; label: string }[] = [
  { value: 1, label: '1日' },
  { value: 7, label: '7日' },
  { value: 30, label: '30日' },
  { value: null, label: '無期限' },
];

const MAX_USES_OPTIONS: { value: MaxUsesOption; label: string }[] = [
  { value: 1, label: '1回' },
  { value: 3, label: '3回' },
  { value: 10, label: '10回' },
  { value: null, label: '無制限' },
];

function formatExpiresAt(iso: string | null | undefined): string {
  if (!iso) return messages.invite.urlValidIndefinitely;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return messages.invite.urlValidIndefinitely;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return messages.invite.urlValidUntil(`${yyyy}/${mm}/${dd} ${hh}:${mi}`);
}

export const InviteUrlIssueModal: React.FC<InviteUrlIssueModalProps> = ({
  tenantId,
  isOpen,
  onClose,
}) => {
  const { currentTenant, isOwner, isManager, regenerateInviteCode } = useTenant();
  const { showToast } = useToast();
  const { stores, fetchStores } = useStore(tenantId);

  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState<ExpiresOption>(7);
  const [maxUses, setMaxUses] = useState<MaxUsesOption>(3);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [issuedExpiresAt, setIssuedExpiresAt] = useState<string | null>(null);
  const [issuedMaxUses, setIssuedMaxUses] = useState<number | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const canIssue = isOwner || isManager;

  // モーダル開時に stores fetch + state リセット
  useEffect(() => {
    if (!isOpen) return;
    void fetchStores().catch(() => {
      // エラーは下部 ErrorBanner で表示
    });
    setSelectedStoreIds([]);
    setExpiresInDays(7);
    setMaxUses(3);
    setError(null);
    setIssuedCode(null);
    setIssuedExpiresAt(null);
    setIssuedMaxUses(null);
    setCopied(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const inviteUrl = useMemo(
    () => (issuedCode ? buildInviteUrl(issuedCode) : ''),
    [issuedCode]
  );

  if (!canIssue) {
    return (
      <BottomSheet
        isOpen={isOpen}
        onClose={onClose}
        title={messages.invite.urlIssueTitle}
      >
        <p className="text-sm text-neutral-500 dark:text-neutral-300">
          {messages.invite.permissionDenied}
        </p>
      </BottomSheet>
    );
  }

  const toggleStore = (storeId: string) => {
    setSelectedStoreIds((prev) =>
      prev.includes(storeId)
        ? prev.filter((id) => id !== storeId)
        : [...prev, storeId]
    );
  };

  const handleIssue = async () => {
    setSubmitting(true);
    setError(null);
    setCopied(false);
    try {
      const newCode = await regenerateInviteCode(tenantId, {
        expiresInDays,
        maxUses,
        storeIds: selectedStoreIds,
      });
      setIssuedCode(newCode);
      const expiresAt =
        expiresInDays != null && expiresInDays > 0
          ? new Date(Date.now() + expiresInDays * 86400000).toISOString()
          : null;
      setIssuedExpiresAt(expiresAt);
      setIssuedMaxUses(maxUses);
      showToast(messages.invite.urlIssued, 'success');
    } catch (err) {
      const msg = formatSupabaseError(err).message || messages.invite.joinFailed;
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!inviteUrl) return;
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(inviteUrl);
      } else {
        // legacy fallback
        const ta = document.createElement('textarea');
        ta.value = inviteUrl;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      showToast(messages.invite.copied, 'success');
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      showToast(messages.invite.copyFailed, 'error');
    }
  };

  const tenantName = currentTenant?.name ?? '';

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={messages.invite.urlIssueTitle}
      description={messages.invite.urlIssueDescription}
    >
      <div className="flex flex-col gap-5">
        {tenantName && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            ワークスペース: <span className="font-medium text-neutral-700 dark:text-neutral-200">{tenantName}</span>
          </p>
        )}

        {/* 店舗選択 */}
        <fieldset>
          <legend className="text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-2">
            {messages.invite.storesLabel}
          </legend>
          {stores.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-300">
              {messages.invite.storesNone}
            </p>
          ) : (
            <ul className="max-h-48 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-200 dark:divide-neutral-700">
              {stores.map((s: Store) => {
                const checked = selectedStoreIds.includes(s.id);
                const isPrimary = checked && selectedStoreIds[0] === s.id;
                return (
                  <li key={s.id}>
                    <label
                      htmlFor={`invite-store-${s.id}`}
                      className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-700/40"
                    >
                      <input
                        id={`invite-store-${s.id}`}
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleStore(s.id)}
                        disabled={submitting}
                        className="h-4 w-4 rounded text-primary-600 dark:text-primary-400 focus:ring-primary-500 dark:focus:ring-primary-400"
                      />
                      <span className="text-sm text-neutral-700 dark:text-neutral-200 flex-1">
                        {s.name}
                      </span>
                      {isPrimary && (
                        <span className="text-xs text-neutral-500 dark:text-neutral-300">
                          {messages.invite.primaryStoreSuffix}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-300">
            {messages.invite.storesEmpty}
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-300">
            {messages.invite.storesPrimaryHint}
          </p>
        </fieldset>

        {/* 有効期限 */}
        <fieldset>
          <legend className="text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-2">
            {messages.invite.expiresLabel}
          </legend>
          <div className="flex flex-wrap gap-3">
            {EXPIRES_OPTIONS.map((opt) => (
              <label
                key={String(opt.value)}
                className="inline-flex items-center text-sm text-neutral-700 dark:text-neutral-200 cursor-pointer"
              >
                <input
                  type="radio"
                  name="invite-url-expires"
                  value={String(opt.value)}
                  checked={expiresInDays === opt.value}
                  onChange={() => setExpiresInDays(opt.value)}
                  disabled={submitting}
                  className="mr-1.5 text-primary-600 dark:text-primary-400 focus:ring-primary-500 dark:focus:ring-primary-400"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </fieldset>

        {/* 使用回数 */}
        <fieldset>
          <legend className="text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-2">
            {messages.invite.maxUsesLabel}
          </legend>
          <div className="flex flex-wrap gap-3">
            {MAX_USES_OPTIONS.map((opt) => (
              <label
                key={String(opt.value)}
                className="inline-flex items-center text-sm text-neutral-700 dark:text-neutral-200 cursor-pointer"
              >
                <input
                  type="radio"
                  name="invite-url-max-uses"
                  value={String(opt.value)}
                  checked={maxUses === opt.value}
                  onChange={() => setMaxUses(opt.value)}
                  disabled={submitting}
                  className="mr-1.5 text-primary-600 dark:text-primary-400 focus:ring-primary-500 dark:focus:ring-primary-400"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </fieldset>

        {error && <ErrorBanner message={error} />}

        {/* 発行結果 */}
        {issuedCode && (
          <section
            className="rounded-md border border-success-200 dark:border-success-800 bg-success-50 dark:bg-success-900/30 p-3"
            aria-live="polite"
          >
            <div className="text-xs text-neutral-700 dark:text-neutral-200 font-medium mb-1">
              {messages.invite.urlLabel}
            </div>
            <div className="flex items-stretch gap-2">
              <input
                type="text"
                readOnly
                value={inviteUrl}
                aria-label={messages.invite.urlLabel}
                className="flex-1 min-w-0 rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-2 py-1.5 text-xs font-mono text-neutral-800 dark:text-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                onClick={handleCopy}
                aria-label={messages.invite.copyButton}
                className="inline-flex items-center gap-1 rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {copied ? 'コピー済' : messages.invite.copyButton}
              </button>
            </div>
            <dl className="mt-2 text-xs text-neutral-700 dark:text-neutral-200 space-y-0.5">
              <div className="flex gap-1">
                <dt className="text-neutral-500 dark:text-neutral-400">招待コード:</dt>
                <dd className="font-mono tracking-widest">{issuedCode}</dd>
              </div>
              <div>
                <span>{formatExpiresAt(issuedExpiresAt)}</span>
              </div>
              <div>
                <span>
                  {issuedMaxUses == null
                    ? messages.invite.usageStatusUnlimited(0)
                    : messages.invite.usageStatus(0, issuedMaxUses)}
                </span>
              </div>
            </dl>
          </section>
        )}

        <p className="text-xs text-neutral-500 dark:text-neutral-300 leading-relaxed">
          {messages.invite.reissueWarning}
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="tertiary"
            onClick={onClose}
            disabled={submitting}
          >
            {messages.invite.cancelButton}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleIssue}
            loading={submitting}
          >
            {issuedCode ? messages.invite.reissueButton : messages.invite.issueButton}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
};

export default InviteUrlIssueModal;
