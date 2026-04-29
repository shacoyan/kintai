import React, { useState, useRef, useEffect, useId } from 'react';
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

  const popoverAlignClass = align === 'start' ? 'left-0' : 'right-0';

  const renderedItems = items.map((item) => {
    const tone = item.tone || 'default';
    const baseClasses = 'w-full text-left px-3 py-2 text-sm min-h-[44px] flex items-center gap-2 motion-safe:transition-colors';
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

        {open && isDesktop && (
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-orientation="vertical"
            className={`absolute ${popoverAlignClass} mt-1 z-20 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-md shadow-lg min-w-[160px] py-1`}
          >
            {renderedItems}
          </div>
        )}
      </div>

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
