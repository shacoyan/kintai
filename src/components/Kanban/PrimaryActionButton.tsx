/**
 * @file PrimaryActionButton.tsx
 * @description Kanban スコープ内で使う primary CTA ボタン。
 * Iter 4 (2026-05-24): 正典 screen-tasks.jsx の `Button variant="primary" size="md"` と完全 1:1 にするため
 * 内部実装を共通 Button.tsx に委譲する。
 *
 * Kanban 外で import しないこと (将来 Button.tsx 改修時の境界を保つため)。
 */
import type { ReactNode, MouseEventHandler } from 'react';
import { Button } from '../ui/Button';

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
  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      variant="primary"
      size={size}
      iconLeft={icon}
    >
      {children}
    </Button>
  );
}
