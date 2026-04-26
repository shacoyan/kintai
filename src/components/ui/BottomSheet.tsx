import React, { useEffect, useRef, useId } from 'react';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({ isOpen, onClose, title, description, footer, children }) => {
  const sheetRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const titleId = title ? `bottomsheet-title-${reactId}` : undefined;
  const descId = description ? `bottomsheet-desc-${reactId}` : undefined;

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Trap focus inside the sheet
  useEffect(() => {
    if (!isOpen || !sheetRef.current) return;
    const focusable = sheetRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) focusable[0].focus();
  }, [isOpen]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
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
    ariaProps['aria-label'] = 'ダイアログ';
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        {...ariaProps}
        className="relative w-full md:max-w-lg bg-white dark:bg-neutral-800 rounded-t-2xl md:rounded-2xl shadow-xl max-h-[85vh] overflow-y-auto animate-slide-up md:animate-none"
      >
        {/* Handle bar (mobile only) */}
        <div className="md:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-neutral-300 dark:bg-neutral-600 rounded-full" />
        </div>
        {title && (
          <div className="border-b border-neutral-200 dark:border-neutral-700">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 id={titleId} className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
              <button
                onClick={onClose}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1"
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>
            {description && (
              <p id={descId} className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 px-4 pb-3">
                {description}
              </p>
            )}
          </div>
        )}
        <div className="p-4">{children}</div>
        {footer && (
          <div className="px-4 py-3 border-t border-neutral-200 dark:border-neutral-700">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
