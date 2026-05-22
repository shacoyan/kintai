import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Pencil, Trash2, Plus } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { useTenant } from '../../contexts/TenantContext';
import { useToast } from '../../contexts/ToastContext';
import { useStore } from '../../hooks/useStore';
import { formatSupabaseError } from '../../lib/errors';
import { buildInviteUrl } from '../../lib/inviteUrl';
import { messages } from '../../lib/messages';
import { logger } from '../../lib/logger';
import type { InviteCode } from '../../types';
import { InviteCodeIssueDialog, type IssueDialogMode } from './InviteCodeIssueDialog';

interface InviteUrlIssueModalProps {
  tenantId: string;
  isOpen: boolean;
  onClose: () => void;
}

/** ISO 文字列を `YYYY/MM/DD HH:mm` に整形。null は「無期限」。 */
function formatExpiresAt(iso: string | null): string {
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

function formatUsage(code: InviteCode): string {
  return code.max_uses == null
    ? messages.invite.usageStatusUnlimited(code.used_count)
    : messages.invite.usageStatus(code.used_count, code.max_uses);
}

export const InviteUrlIssueModal: React.FC<InviteUrlIssueModalProps> = ({
  tenantId,
  isOpen,
  onClose,
}) => {
  const {
    currentTenant,
    isOwner,
    isManager,
    listInviteCodes,
    revokeInviteCode,
  } = useTenant();
  const { showToast } = useToast();
  const { stores: selectableStores, fetchStores } = useStore(tenantId);

  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [issueDialogOpen, setIssueDialogOpen] = useState<boolean>(false);
  const [editTarget, setEditTarget] = useState<InviteCode | null>(null);
  const [lastCopiedCodeId, setLastCopiedCodeId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const canIssue = isOwner || isManager;
  const tenantName = currentTenant?.name ?? '';

  const fetchCodes = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listInviteCodes(tenantId);
      setCodes(rows);
    } catch (err) {
      logger.error('[InviteUrlIssueModal] listInviteCodes failed', err);
      setError(formatSupabaseError(err).message || messages.invite.previewUnavailable);
    } finally {
      setLoading(false);
    }
  }, [tenantId, listInviteCodes]);

  // Modal open のたびに fetch + state リセット
  useEffect(() => {
    if (!isOpen) return;
    setLastCopiedCodeId(null);
    setIssueDialogOpen(false);
    setEditTarget(null);
    void fetchCodes();
    void fetchStores().catch(() => {
      // store fetch error は ErrorBanner では出さず、サブモーダル open 時の空表示に任せる
    });
  }, [isOpen, fetchCodes, fetchStores]);

  if (!canIssue) {
    return (
      <BottomSheet isOpen={isOpen} onClose={onClose} title={messages.invite.listTitle}>
        <p className="text-sm text-stone-500 dark:text-stone-300">
          {messages.invite.permissionDenied}
        </p>
      </BottomSheet>
    );
  }

  /** clipboard コピー（fallback 込み） + Toast。 */
  const copyToClipboard = async (text: string, successMessage: string): Promise<boolean> => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // legacy fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      showToast(successMessage, 'success');
      return true;
    } catch (err) {
      logger.warn('[InviteUrlIssueModal] clipboard failed', { err });
      showToast(messages.invite.copyFailed, 'error');
      return false;
    }
  };

  const handleCopy = async (code: InviteCode) => {
    const url = buildInviteUrl(code.code);
    const ok = await copyToClipboard(url, messages.invite.copied);
    if (ok) {
      setLastCopiedCodeId(code.id);
      window.setTimeout(() => {
        setLastCopiedCodeId((prev) => (prev === code.id ? null : prev));
      }, 2000);
    }
  };

  const handleOpenIssueDialog = () => {
    setEditTarget(null);
    setIssueDialogOpen(true);
  };

  const handleOpenEditDialog = (code: InviteCode) => {
    setEditTarget(code);
    setIssueDialogOpen(true);
  };

  const handleRevoke = async (code: InviteCode) => {
    // eslint-disable-next-line no-alert
    const ok = window.confirm(messages.invite.revokeConfirm);
    if (!ok) return;
    setRevokingId(code.id);
    try {
      await revokeInviteCode(code.id);
      logger.info('[InviteUrlIssueModal] revoke success', {
        codeId: code.id,
      });
      showToast(messages.invite.revokeSuccess, 'success');
      await fetchCodes();
    } catch (err) {
      logger.error('[InviteUrlIssueModal] revoke failed', err);
      const msg = formatSupabaseError(err).message || messages.invite.joinFailed;
      showToast(msg, 'error');
    } finally {
      setRevokingId(null);
    }
  };

  // サブモーダル callback
  const handleIssued = async (invite: InviteCode) => {
    const url = buildInviteUrl(invite.code);
    await copyToClipboard(url, messages.invite.issueSuccess);
    setLastCopiedCodeId(invite.id);
    window.setTimeout(() => {
      setLastCopiedCodeId((prev) => (prev === invite.id ? null : prev));
    }, 2000);
    await fetchCodes();
  };

  const handleUpdated = async () => {
    showToast(messages.invite.updateSuccess, 'success');
    await fetchCodes();
  };

  const dialogMode: IssueDialogMode = editTarget
    ? { type: 'edit', code: editTarget }
    : { type: 'issue' };

  return (
    <>
      <BottomSheet
        isOpen={isOpen && !issueDialogOpen}
        onClose={onClose}
        title={messages.invite.listTitle}
      >
        <div className="flex flex-col gap-4">
          {tenantName && (
            <p className="text-xs text-stone-500 dark:text-stone-400">
              ワークスペース:{' '}
              <span className="font-medium text-stone-700 dark:text-stone-200">
                {tenantName}
              </span>
            </p>
          )}

          <div className="flex justify-end">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleOpenIssueDialog}
              disabled={loading}
            >
              <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
              {messages.invite.newCodeButton}
            </Button>
          </div>

          {error && <ErrorBanner message={error} onRetry={() => void fetchCodes()} />}

          {/* リスト本体 */}
          <section
            className="max-h-[60vh] overflow-y-auto rounded-md border border-stone-200 dark:border-stone-700"
            aria-live="polite"
          >
            {loading && codes.length === 0 ? (
              <p className="px-3 py-6 text-sm text-stone-500 dark:text-stone-300 text-center">
                読み込み中...
              </p>
            ) : codes.length === 0 ? (
              <p className="px-3 py-6 text-sm text-stone-500 dark:text-stone-300 text-center">
                {messages.invite.listEmpty}
              </p>
            ) : (
              <ul className="divide-y divide-stone-200 dark:divide-stone-700">
                {codes.map((code) => {
                  const url = buildInviteUrl(code.code);
                  const isJustCopied = lastCopiedCodeId === code.id;
                  const sortedStores = [...code.stores].sort(
                    (a, b) => a.sort_order - b.sort_order,
                  );
                  return (
                    <li
                      key={code.id}
                      className="px-3 py-3 flex flex-col gap-2 bg-white dark:bg-stone-800"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-stone-800 dark:text-stone-100 truncate">
                            {code.label && code.label.length > 0
                              ? code.label
                              : messages.invite.rowLabelFallback}
                          </p>
                          <p
                            className="mt-0.5 text-xs font-mono tracking-widest text-stone-600 dark:text-stone-300 select-all break-all"
                            aria-label="招待コード"
                            title={url}
                          >
                            {code.code}
                          </p>
                        </div>
                      </div>

                      {/* 配属店舗 chip */}
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-xs text-stone-500 dark:text-stone-400 self-center">
                          {messages.invite.rowStoresLabel}:
                        </span>
                        {sortedStores.length === 0 ? (
                          <span className="text-xs text-stone-500 dark:text-stone-400">
                            {messages.invite.assignedStoresNone}
                          </span>
                        ) : (
                          sortedStores.map((s, idx) => (
                            <span
                              key={s.store_id}
                              className="inline-flex items-center rounded-full bg-stone-100 dark:bg-stone-700 px-2 py-0.5 text-xs text-stone-700 dark:text-stone-200"
                            >
                              {s.store_name}
                              {idx === 0 && (
                                <span className="ml-1 text-stone-500 dark:text-stone-400">
                                  {messages.invite.primaryStoreSuffix}
                                </span>
                              )}
                            </span>
                          ))
                        )}
                      </div>

                      {/* 期限 / 使用回数 */}
                      <dl className="text-xs text-stone-600 dark:text-stone-300 space-y-0.5">
                        <div className="flex gap-1">
                          <dt className="text-stone-500 dark:text-stone-400">
                            {messages.invite.rowExpiresLabel}:
                          </dt>
                          <dd>{formatExpiresAt(code.expires_at)}</dd>
                        </div>
                        <div className="flex gap-1">
                          <dt className="text-stone-500 dark:text-stone-400">
                            {messages.invite.rowUsageLabel}:
                          </dt>
                          <dd>{formatUsage(code)}</dd>
                        </div>
                      </dl>

                      {/* アクション */}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => void handleCopy(code)}
                          className="inline-flex items-center gap-1 rounded border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 px-2.5 py-1.5 text-xs font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400"
                          disabled={revokingId === code.id}
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          {isJustCopied ? 'コピー済' : messages.invite.rowActionCopy}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenEditDialog(code)}
                          className="inline-flex items-center gap-1 rounded border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 px-2.5 py-1.5 text-xs font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400"
                          disabled={revokingId === code.id}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          {messages.invite.rowActionEdit}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRevoke(code)}
                          className="inline-flex items-center gap-1 rounded border border-danger-300 dark:border-danger-700 bg-white dark:bg-stone-800 px-2.5 py-1.5 text-xs font-medium text-danger-700 dark:text-danger-300 hover:bg-danger-50 dark:hover:bg-danger-900/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger-500 dark:focus-visible:ring-danger-400 disabled:opacity-50"
                          disabled={revokingId === code.id}
                          aria-busy={revokingId === code.id || undefined}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          {messages.invite.rowActionRevoke}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <p className="text-xs text-stone-500 dark:text-stone-300 leading-relaxed">
            {messages.invite.reissueWarning}
          </p>

          <div className="flex justify-end">
            <Button
              type="button"
              variant="tertiary"
              onClick={onClose}
              disabled={loading}
            >
              {messages.invite.cancelButton}
            </Button>
          </div>
        </div>
      </BottomSheet>

      {/* 発行 / 設定変更サブモーダル */}
      <InviteCodeIssueDialog
        tenantId={tenantId}
        isOpen={isOpen && issueDialogOpen}
        mode={dialogMode}
        onClose={() => {
          setIssueDialogOpen(false);
          setEditTarget(null);
        }}
        onIssued={handleIssued}
        onUpdated={handleUpdated}
        selectableStores={selectableStores}
      />
    </>
  );
};

export default InviteUrlIssueModal;
