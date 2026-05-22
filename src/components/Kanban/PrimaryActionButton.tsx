/**
 * @file PrimaryActionButton.tsx
 * @description Kanban スコープ内で使う primary CTA ボタン。
 * Brief v2 (2026-05-22) Q-A6: Button.tsx を触らず、Kanban local 共通化する。
 *
 * 設計書: .company/creative/briefs/2026-05-22-kintai-kanban-modern-brief.md
 *
 * - bg-blue-600 + hover -translate-y-px + shadow lift
 * - focus-visible ring (blue-500)
 * - active scale-[0.98]
 * - disabled state 対応
 * - size: 'sm' | 'md'
 *
 * Kanban 外で import しないこと (将来 Button.tsx 改修時の境界を保つため)。
 */
import type { ReactNode, MouseEventHandler } from 'react';

export interface PrimaryActionButtonProps {
  onClick?: MouseEventHandler<HTMLButtonElement>;
  children: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  size?: 'sm' | 'md';
  type?: 'button' | 'submit' | 'reset';
  'aria-label'?: string;
}

export function PrimaryActionButton({
  onClick,
  children,
  icon,
  disabled = false,
  size = 'md',
  type = 'button',
  'aria-label': ariaLabel,
}: PrimaryActionButtonProps): JSX.Element {
  const sizing = size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`
        inline-flex items-center gap-1.5
        ${sizing}
        bg-blue-600 hover:bg-blue-700 text-white font-medium
        rounded-lg shadow-sm hover:shadow-md
        motion-safe:hover:-translate-y-px
        motion-safe:transition-all duration-150 ease-out
        focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
        active:scale-[0.98]
        disabled:bg-stone-300 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:shadow-none
      `}
    >
      {icon}
      {children}
    </button>
  );
}
