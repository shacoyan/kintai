import React, { useEffect, useMemo, useState } from 'react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { ErrorBanner } from '../ui/ErrorBanner';
import { useTenant } from '../../contexts/TenantContext';
import { formatSupabaseError } from '../../lib/errors';
import { messages } from '../../lib/messages';
import { logger } from '../../lib/logger';
import type { InviteCode, Store } from '../../types';

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

export type IssueDialogMode =
  | { type: 'issue' }
  | { type: 'edit'; code: InviteCode };

interface InviteCodeIssueDialogProps {
  tenantId: string;
  isOpen: boolean;
  mode: IssueDialogMode;
  onClose: () => void;
  onIssued?: (invite: InviteCode) => void;
  onUpdated?: () => void;
  selectableStores: Store[];
}

const LABEL_MAX = 40;

/**
 * 既存 InviteCode.expires_at (ISO 文字列 or null) から最近接の ExpiresOption に逆算する。
 * 該当する選択肢が無い場合は null (無期限) を返す（カスタム期限 UI は本 Loop 未対応）。
 */
function inferExpiresOptionFromCode(code: InviteCode): ExpiresOption {
  if (!code.expires_at) return null;
  const expiresMs = new Date(code.expires_at).getTime();
  const createdMs = new Date(code.created_at).getTime();
  if (!Number.isFinite(expiresMs) || !Number.isFinite(createdMs)) return null;
  const diffDays = (expiresMs - createdMs) / 86400000;
  const candidates: { value: Exclude<ExpiresOption, null>; diff: number }[] = [
    { value: 1, diff: Math.abs(diffDays - 1) },
    { value: 7, diff: Math.abs(diffDays - 7) },
    { value: 30, diff: Math.abs(diffDays - 30) },
  ];
  candidates.sort((a, b) => a.diff - b.diff);
  return candidates[0].value;
}

function inferMaxUsesOption(code: InviteCode): MaxUsesOption {
  if (code.max_uses == null) return null;
  if (code.max_uses === 1 || code.max_uses === 3 || code.max_uses === 10) {
    return code.max_uses;
  }
  // 想定外の値（旧データ等）→ 最近接にマップ
  const candidates: { value: Exclude<MaxUsesOption, null>; diff: number }[] = [
    { value: 1, diff: Math.abs(code.max_uses - 1) },
    { value: 3, diff: Math.abs(code.max_uses - 3) },
    { value: 10, diff: Math.abs(code.max_uses - 10) },
  ];
  candidates.sort((a, b) => a.diff - b.diff);
  return candidates[0].value;
}

export const InviteCodeIssueDialog: React.FC<InviteCodeIssueDialogProps> = ({
  tenantId,
  isOpen,
  mode,
  onClose,
  onIssued,
  onUpdated,
  selectableStores,
}) => {
  const { issueInviteCode, updateInviteCode } = useTenant();

  const isEdit = mode.type === 'edit';
  const editingCode = mode.type === 'edit' ? mode.code : null;

  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState<ExpiresOption>(7);
  const [maxUses, setMaxUses] = useState<MaxUsesOption>(3);
  const [label, setLabel] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // mode / open 変化時の初期化
  useEffect(() => {
    if (!isOpen) return;
    if (editingCode) {
      setSelectedStoreIds(
        [...editingCode.stores]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((s) => s.store_id),
      );
      setExpiresInDays(inferExpiresOptionFromCode(editingCode));
      setMaxUses(inferMaxUsesOption(editingCode));
      setLabel(editingCode.label ?? '');
    } else {
      // issue モードのデフォルト
      setSelectedStoreIds([]);
      setExpiresInDays(7);
      setMaxUses(3);
      setLabel('');
    }
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingCode?.id]);

  const title = isEdit
    ? '招待URL の設定変更'
    : messages.invite.urlIssueTitle;

  const submitButtonLabel = isEdit ? '保存' : '発行する';

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (label.length > LABEL_MAX) return false;
    return true;
  }, [submitting, label]);

  const toggleStore = (storeId: string) => {
    setSelectedStoreIds((prev) =>
      prev.includes(storeId)
        ? prev.filter((id) => id !== storeId)
        : [...prev, storeId],
    );
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit && editingCode) {
        logger.info('[InviteCodeIssueDialog] update start', {
          codeId: editingCode.id,
        });
        await updateInviteCode(editingCode.id, {
          expiresInDays,
          maxUses,
          storeIds: selectedStoreIds,
          label: label.trim() === '' ? null : label.trim(),
        });
        logger.info('[InviteCodeIssueDialog] update success', {
          codeId: editingCode.id,
        });
        onUpdated?.();
        onClose();
      } else {
        logger.info('[InviteCodeIssueDialog] issue start');
        const invite = await issueInviteCode(tenantId, {
          expiresInDays,
          maxUses,
          storeIds: selectedStoreIds,
          label: label.trim() === '' ? null : label.trim(),
        });
        logger.info('[InviteCodeIssueDialog] issue success', {
          code: invite.code.slice(0, 2) + '****',
        });
        onIssued?.(invite);
        onClose();
      }
    } catch (err) {
      logger.error('[InviteCodeIssueDialog] submit failed', err);
      const msg = formatSupabaseError(err).message || messages.invite.joinFailed;
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={title}>
      <div className="flex flex-col gap-5">
        {/* 店舗選択 */}
        <fieldset>
          <legend className="text-sm font-medium text-stone-700 dark:text-stone-200 mb-2">
            {messages.invite.storesLabel}
          </legend>
          {selectableStores.length === 0 ? (
            <p className="text-sm text-stone-500 dark:text-stone-300">
              {messages.invite.storesNone}
            </p>
          ) : (
            <ul className="max-h-48 overflow-y-auto rounded-md border border-stone-200 dark:border-stone-700 divide-y divide-stone-200 dark:divide-stone-700">
              {selectableStores.map((s) => {
                const checked = selectedStoreIds.includes(s.id);
                const isPrimary = checked && selectedStoreIds[0] === s.id;
                return (
                  <li key={s.id}>
                    <label
                      htmlFor={`invite-dialog-store-${s.id}`}
                      className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-700/40"
                    >
                      <input
                        id={`invite-dialog-store-${s.id}`}
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleStore(s.id)}
                        disabled={submitting}
                        className="h-4 w-4 rounded text-blue-600 dark:text-blue-400 focus:ring-blue-500 dark:focus:ring-blue-400"
                      />
                      <span className="text-sm text-stone-700 dark:text-stone-200 flex-1">
                        {s.name}
                      </span>
                      {isPrimary && (
                        <span className="text-xs text-stone-500 dark:text-stone-300">
                          {messages.invite.primaryStoreSuffix}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-300">
            {messages.invite.storesPlaceholder}
          </p>
          <p className="text-xs text-text-muted">
            {messages.invite.storesHintOptional}
          </p>
          <p className="text-xs text-stone-500 dark:text-stone-300">
            {messages.invite.storesPrimaryHint}
          </p>
        </fieldset>

        {/* 有効期限 */}
        <fieldset>
          <legend className="text-sm font-medium text-stone-700 dark:text-stone-200 mb-2">
            {messages.invite.expiresLabel}
          </legend>
          <div className="flex flex-wrap gap-3">
            {EXPIRES_OPTIONS.map((opt) => (
              <label
                key={String(opt.value)}
                className="inline-flex items-center text-sm text-stone-700 dark:text-stone-200 cursor-pointer"
              >
                <input
                  type="radio"
                  name="invite-dialog-expires"
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

        {/* 使用回数 */}
        <fieldset>
          <legend className="text-sm font-medium text-stone-700 dark:text-stone-200 mb-2">
            {messages.invite.maxUsesLabel}
          </legend>
          <div className="flex flex-wrap gap-3">
            {MAX_USES_OPTIONS.map((opt) => (
              <label
                key={String(opt.value)}
                className="inline-flex items-center text-sm text-stone-700 dark:text-stone-200 cursor-pointer"
              >
                <input
                  type="radio"
                  name="invite-dialog-max-uses"
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

        {/* ラベル (メモ、任意) */}
        <div>
          <Input
            label="メモ（任意）"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={LABEL_MAX}
            disabled={submitting}
            placeholder={messages.invite.labelPlaceholder}
            hint={messages.invite.labelHint}
          />
        </div>

        {error && <ErrorBanner message={error} />}

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
            onClick={handleSubmit}
            loading={submitting}
            disabled={!canSubmit}
          >
            {submitButtonLabel}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
};

export default InviteCodeIssueDialog;
