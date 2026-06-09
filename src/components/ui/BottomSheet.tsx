import React, { useEffect, useRef, useId, memo } from 'react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useDialogStack } from '../../hooks/useDialogStack';
import { inertOutside } from '../../lib/inertOutside';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Sheet 本体の最大幅クラス。未指定なら従来の 'md:max-w-lg'（512px）。後方互換のため必ず任意。 */
  widthClassName?: string;
  /** title 無しダイアログの aria-label。未指定なら従来の 'ダイアログ'。後方互換のため任意。 */
  ariaLabel?: string;
}

// Perf: 親 (ShiftPage) の頻繁な再 render に追従させないため React.memo でラップ。
// children は通常 children element も親側で安定化されていれば skip 効果あり。
const BottomSheetInner: React.FC<BottomSheetProps> = ({ isOpen, onClose, title, description, footer, children, widthClassName, ariaLabel }) => {
  const sheetRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const titleId = title ? `bottomsheet-title-${reactId}` : undefined;
  const descId = description ? `bottomsheet-desc-${reactId}` : undefined;

  const { isTop } = useDialogStack(isOpen);

  useEscapeKey(onClose, { active: isOpen, isTop });
  useFocusTrap(sheetRef, { active: isOpen, isTop });
  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen || !sheetRef.current) return;
    return inertOutside(sheetRef.current);
  }, [isOpen]);

  if (!isOpen) return null;

  const ariaProps: {
    'aria-label'?: string;
    'aria-labelledby'?: string;
    'aria-describedby'?: string;
  } = {};

  if (title) {
    ariaProps['aria-labelledby'] = titleId;
    if (description) {
      ariaProps['aria-describedby'] = descId;
    }
  } else {
    ariaProps['aria-label'] = ariaLabel ?? 'ダイアログ';
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm motion-safe:transition-opacity duration-150 ease-out"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        {...ariaProps}
        className={`relative w-full ${widthClassName ?? 'md:max-w-lg'} bg-white dark:bg-stone-900 rounded-t-2xl md:rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] max-h-[90vh] flex flex-col overflow-hidden motion-safe:animate-slide-up md:animate-none motion-safe:transition-transform duration-200 ease-out`}
      >
        {/* Handle bar (mobile only) */}
        <div className="md:hidden flex justify-center flex-shrink-0">
          <div className="mx-auto w-12 h-1 rounded-full bg-stone-300 dark:bg-stone-600 my-2" />
        </div>
        {title && (
          <div className="border-b border-stone-200 dark:border-stone-700 flex-shrink-0">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 id={titleId} className="text-base font-semibold text-stone-900 dark:text-stone-50">{title}</h2>
              <button
                onClick={onClose}
                className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 rounded-md transition-colors duration-150 ease-out"
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>
            {description && (
              <p id={descId} className="text-sm text-stone-500 dark:text-stone-400 mt-1 px-4 pb-3">
                {description}
              </p>
            )}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto p-4">{children}</div>
        {footer && (
          <div className="px-4 py-3 border-t border-stone-200 dark:border-stone-700 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export const BottomSheet = memo(BottomSheetInner);
