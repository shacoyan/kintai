import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger' | 'warning';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:   'bg-blue-600 text-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-blue-700 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] motion-safe:hover:-translate-y-px active:scale-[0.98] dark:bg-blue-500 dark:hover:bg-blue-400',
  secondary: 'bg-stone-100 text-stone-900 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700',
  tertiary:  'bg-transparent text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
  danger:    'bg-red-600 text-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-red-700 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] motion-safe:hover:-translate-y-px active:scale-[0.98]',
  warning:   'bg-transparent border border-stone-300 text-stone-700 hover:bg-stone-50 hover:border-stone-400 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-10 px-5 text-sm',
};

const BASE_CLASSES =
  'rounded-lg font-medium inline-flex items-center justify-center gap-2 ' +
  'motion-safe:transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-stone-900 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)]';

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    iconLeft,
    iconRight,
    fullWidth = false,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      aria-busy={loading || undefined}
      disabled={isDisabled}
      className={cn(
        BASE_CLASSES,
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <>
          <Loader2
            className="w-4 h-4 motion-safe:animate-spin"
            role="status"
            aria-label="読み込み中"
          />
          <span aria-hidden="true">{children}</span>
        </>
      ) : (
        <>
          {iconLeft ? <span aria-hidden="true" className="inline-flex shrink-0">{iconLeft}</span> : null}
          <span>{children}</span>
          {iconRight ? <span aria-hidden="true" className="inline-flex shrink-0">{iconRight}</span> : null}
        </>
      )}
    </button>
  );
});
