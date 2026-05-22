import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

export type IconButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  loading?: boolean;
  'aria-label': string;
}

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  primary: 'bg-blue-600 text-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-blue-700 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] motion-safe:hover:-translate-y-px active:scale-[0.98] dark:bg-blue-500 dark:hover:bg-blue-400',
  secondary: 'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700',
  ghost: 'bg-transparent text-stone-500 hover:text-blue-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:text-blue-400 dark:hover:bg-stone-800',
  danger: 'bg-transparent text-stone-500 hover:text-red-600 hover:bg-red-50 dark:text-stone-300 dark:hover:text-red-400 dark:hover:bg-red-900/20',
};

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-10 w-10',
};

const BASE_CLASSES =
  'inline-flex items-center justify-center rounded-md ' +
  'motion-safe:transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-stone-900 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:bg-transparent';

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, variant = 'ghost', size = 'md', loading = false, disabled, className, type = 'button', ...rest },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      aria-busy={loading || undefined}
      disabled={isDisabled}
      className={cn(BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size], className)}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" role="status" aria-label="読み込み中" /> : icon}
    </button>
  );
});
