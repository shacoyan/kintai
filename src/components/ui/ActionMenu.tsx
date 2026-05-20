import React, { useState, useRef, useEffect, useLayoutEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { BottomSheet } from './BottomSheet';

export type ActionMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  tone?: 'default' | 'danger' | 'primary' | 'success';
  disabled?: boolean;
  icon?: React.ReactNode;
};

export interface ActionMenuProps {
  items: ActionMenuItem[];
  triggerLabel?: string;
  triggerSize?: 'sm' | 'md';
  align?: 'start' | 'end';
  bottomSheetTitle?: string;
  disabled?: boolean;
}

const toneStyles: Record<string, string> = {
  default: 'text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700',
  danger: 'text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/20',
  primary: 'text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20',
  success: 'text-success-600 dark:text-success-400 hover:bg-success-50 dark:hover:bg-success-900/20',
};

export const ActionMenu: React.FC<ActionMenuProps> = ({
  items,
  triggerLabel = '操作メニュー',
  triggerSize = 'md',
  align = 'end',
  bottomSheetTitle,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 640px)');
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const handleToggle = () => {
    if (disabled) return;
    setOpen((prev) => !prev);
  };

  const handleClose = React.useCallback(() => {
    setOpen(false);
    if (isDesktop && triggerRef.current) {
      triggerRef.current.focus();
    }
  }, [isDesktop]);

  const handleSelect = (item: ActionMenuItem) => {
    if (item.disabled) return;
    item.onSelect();
    handleClose();
  };

  const recalc = React.useCallback(() => {
    if (!triggerRef.current || !menuRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const menuWidth = menuRef.current.offsetWidth;
    const menuHeight = menuRef.current.offsetHeight;

    let top = rect.bottom + 4;
    let left = align === 'end'
      ? rect.right - menuWidth
      : rect.left;

    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));

    if (top + menuHeight > window.innerHeight - 8) {
      top = rect.top - menuHeight - 4;
      top = Math.max(8, top);
    }

    setPosition({ top, left });
  }, [align]);

  useLayoutEffect(() => {
    if (open && isDesktop) {
      recalc();

      const scrollOptions = { passive: true, capture: true } as const;
      window.addEventListener('scroll', recalc, scrollOptions);
      window.addEventListener('resize', recalc);

      return () => {
        window.removeEventListener('scroll', recalc, scrollOptions);
        window.removeEventListener('resize', recalc);
      };
    } else {
      setPosition(null);
    }
  }, [open, isDesktop, recalc]);

  useEffect(() => {
    if (!open || !isDesktop) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        handleClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, isDesktop, handleClose]);

  const iconSize = triggerSize === 'sm' ? 16 : 20;

  const renderedItems = items.map((item) => {
    const tone = item.tone || 'default';
    const baseClasses = 'w-full text-left px-3 py-2 text-sm min-h-[44px] flex items-center gap-2 motion-safe:transition-colors duration-120 ease-out-expo';
    const toneClass = item.disabled
      ? 'text-neutral-700 dark:text-neutral-200 opacity-50 cursor-not-allowed'
      : toneStyles[tone];
    const hoverClass = item.disabled ? 'pointer-events-none' : '';

    return (
      <button
        key={item.key}
        role="menuitem"
        disabled={item.disabled}
        onClick={() => handleSelect(item)}
        className={`${baseClasses} ${toneClass} ${hoverClass}`}
      >
        {item.icon && <span className="flex-shrink-0">{item.icon}</span>}
        <span>{item.label}</span>
      </button>
    );
  });

  return (
    <>
      <div className="relative inline-block">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label={triggerLabel}
          disabled={disabled}
          onClick={handleToggle}
          className={`flex items-center justify-center rounded-md min-h-[44px] min-w-[44px] text-neutral-600 dark:text-neutral-300 ${
            disabled
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-neutral-100 dark:hover:bg-neutral-700'
          }`}
        >
          <MoreVertical aria-hidden="true" size={iconSize} />
        </button>
      </div>

      {open && isDesktop && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-orientation="vertical"
          className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-md shadow-lg min-w-[160px] py-1"
          style={{
            position: 'fixed',
            top: position?.top,
            left: position?.left,
            zIndex: 50,
            visibility: position ? 'visible' : 'hidden',
            maxWidth: 'calc(100vw - 16px)',
          }}
        >
          {renderedItems}
        </div>,
        document.body
      )}

      {!isDesktop && (
        <BottomSheet
          isOpen={open}
          onClose={handleClose}
          title={bottomSheetTitle}
        >
          <div role="menu" aria-orientation="vertical" className="flex flex-col">
            {renderedItems}
          </div>
        </BottomSheet>
      )}
    </>
  );
};
