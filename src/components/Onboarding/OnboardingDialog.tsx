import React, { useEffect, useId, useRef, useState } from 'react';
import { useTenant } from '../../hooks/useTenant';
import { useAuth } from '../../hooks/useAuth';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useDialogStack } from '../../hooks/useDialogStack';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { inertOutside } from '../../lib/inertOutside';
import { Heading } from '../ui/Heading';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { messages } from '../../lib/messages';
import { formatSupabaseError } from '../../lib/errors';

/**
 * 初回ワークスペースオンボーディング Dialog。
 *
 * - 表示条件: useTenant().needsOnboarding === true
 * - 入力: 氏名 (legal_name, max 50) / 表示名 (display_name, max 30)
 * - dismissible=false: escape / overlay click で閉じない、close ボタンなし
 * - 保存は complete_onboarding RPC（SECURITY DEFINER + バリデーション）
 * - focus trap は既存 useFocusTrap を使用（Loop 38 で isTop 依存配列問題は解決済）
 */
export const OnboardingDialog: React.FC = () => {
  const { needsOnboarding, completeOnboarding, currentTenant, members } = useTenant();
  const { user } = useAuth();

  const myMember = currentTenant && user
    ? members.find((m) => m.user_id === user.id && m.tenant_id === currentTenant.id) ?? null
    : null;

  const [legalName, setLegalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const titleId = `onboarding-title-${reactId}`;
  const descId = `onboarding-desc-${reactId}`;

  const { isTop } = useDialogStack(needsOnboarding);

  // initialFocus を legal_name input に固定
  useFocusTrap(dialogRef, {
    active: needsOnboarding,
    isTop,
    initialFocus: (root) => root.querySelector<HTMLInputElement>('input[name="legal_name"]'),
  });
  useBodyScrollLock(needsOnboarding);

  // 既存 display_name を初期値として注入（needsOnboarding が立った瞬間のみ）
  useEffect(() => {
    if (needsOnboarding) {
      setDisplayName(myMember?.display_name ?? '');
    }
  }, [needsOnboarding, myMember?.display_name]);

  useEffect(() => {
    if (!needsOnboarding || !dialogRef.current) return;
    return inertOutside(dialogRef.current);
  }, [needsOnboarding]);

  // Loop Reviewer Critical #3: dismissible=false 担保。
  // useFocusTrap や他のグローバルハンドラに escape を消費される前に capture phase で抑止する。
  useEffect(() => {
    if (!needsOnboarding) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [needsOnboarding]);

  if (!needsOnboarding) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedLegal = legalName.trim();
    const trimmedDisplay = displayName.trim();
    if (!trimmedLegal || !trimmedDisplay) return;

    setSubmitting(true);
    setErrorMsg(null);
    try {
      await completeOnboarding(trimmedLegal, trimmedDisplay);
      // 成功時は親 context が再 fetch して needsOnboarding=false → return null で消える
    } catch (err: unknown) {
      const f = formatSupabaseError(err);
      setErrorMsg(f.message || messages.onboarding.saveError);
    } finally {
      setSubmitting(false);
    }
  };

  const submitDisabled = submitting || !legalName.trim() || !displayName.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center">
      {/* Backdrop — onClick は明示的に no-op (dismissible=false) */}
      <div
        className="absolute inset-0 bg-black/60"
        aria-hidden="true"
      />
      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative w-full md:max-w-lg bg-white dark:bg-neutral-800 rounded-t-2xl md:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto"
      >
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <Heading level={3} id={titleId} className="text-neutral-900 dark:text-neutral-50">
            {messages.onboarding.welcome(currentTenant?.name ?? '')}
          </Heading>
          <p id={descId} className="text-sm text-neutral-600 dark:text-neutral-300">
            {messages.onboarding.description}
          </p>

          <div className="space-y-4 pt-2">
            <Input
              name="legal_name"
              label={messages.onboarding.legalNameLabel}
              placeholder={messages.onboarding.legalNamePlaceholder}
              required
              maxLength={50}
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              hint={messages.onboarding.legalNameHint}
              autoComplete="name"
            />
            <Input
              name="display_name"
              label={messages.onboarding.displayNameLabel}
              placeholder={messages.onboarding.displayNamePlaceholder}
              required
              maxLength={30}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              hint={messages.onboarding.displayNameHint}
              autoComplete="nickname"
            />
          </div>

          {errorMsg && (
            <p className="text-sm text-danger-600 dark:text-danger-400" role="alert">
              {errorMsg}
            </p>
          )}

          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              disabled={submitDisabled}
            >
              {messages.onboarding.submit}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
