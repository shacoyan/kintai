import React, { useEffect, useId, useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useDialogStack } from '../../hooks/useDialogStack';
import { inertOutside } from '../../lib/inertOutside';
import { Heading } from './Heading';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** 本文（複数行・子件数警告などの動的 ReactNode に対応） */
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = 確定ボタンを赤系（破壊操作） */
  variant?: 'danger' | 'normal';
  /** 処理中: 確定ボタン loading + backdrop/Escape による dismiss を無効化（二重押下防止） */
  loading?: boolean;
  /** loading 以外に確定を無効化したい条件（例: 子件数取得中） */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 破壊操作の確認用 alertdialog。
 *
 * - role="alertdialog" / aria-modal / aria-labelledby / aria-describedby
 * - useFocusTrap + useEscapeKey + useBodyScrollLock + useDialogStack(isTop)
 *   を組み合わせるだけ（新規フォーカスロジックは書かない）。canonical = OnboardingDialog.tsx
 * - 初期フォーカス = キャンセルボタン（破壊操作の誤確定防止）
 * - loading 中は Escape / backdrop dismiss を無効化（処理中の取消・二重押下防止）
 * - モーダル内モーダルでも useDialogStack の isTop で最前面のみ Escape/トラップ
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel = 'OK',
  cancelLabel = 'キャンセル',
  variant = 'normal',
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const reactId = useId();
  const titleId = `confirm-title-${reactId}`;
  const descId = `confirm-desc-${reactId}`;

  const { isTop } = useDialogStack(open);

  useFocusTrap(dialogRef, {
    active: open,
    isTop,
    initialFocus: () => cancelRef.current,
  });
  useEscapeKey(
    () => {
      if (!loading) onCancel();
    },
    { active: open, isTop },
  );
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open || !dialogRef.current) return;
    return inertOutside(dialogRef.current);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center md:justify-center">
      {/* Backdrop — loading 中は dismiss 無効 */}
      <div
        className="absolute inset-0 bg-black/60"
        aria-hidden="true"
        onClick={() => {
          if (!loading) onCancel();
        }}
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description != null ? descId : undefined}
        className="relative w-full md:max-w-md bg-white dark:bg-stone-800 rounded-t-2xl md:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto"
      >
        <div className="p-6 space-y-4">
          <Heading level={3} id={titleId} className="text-stone-900 dark:text-stone-50">
            {title}
          </Heading>
          {description != null && (
            <div
              id={descId}
              className="text-sm text-stone-600 dark:text-stone-300 whitespace-pre-line"
            >
              {description}
            </div>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <Button
              ref={cancelRef}
              variant="secondary"
              onClick={onCancel}
              disabled={loading}
            >
              {cancelLabel}
            </Button>
            <Button
              variant={variant === 'danger' ? 'danger' : 'primary'}
              onClick={onConfirm}
              loading={loading}
              disabled={confirmDisabled}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
