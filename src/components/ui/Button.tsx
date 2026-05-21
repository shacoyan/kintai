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
  primary:   'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-400',
  secondary: 'bg-white border border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:bg-neutral-800 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-700',
  tertiary:  'bg-transparent text-primary-600 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/30',
  danger:    'bg-danger-500 text-white hover:bg-[#A53124] dark:bg-danger-500 dark:hover:bg-[#A53124]',
  warning:   'bg-warning-100 text-warning-800 border border-warning-500 hover:bg-warning-200 dark:bg-warning-900/30 dark:text-warning-200 dark:border-warning-400 dark:hover:bg-warning-900/50',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-body-sm',
  md: 'h-10 px-4 text-body',
  lg: 'h-12 px-5 text-body',
};

const BASE_CLASSES =
  'rounded-md font-semibold inline-flex items-center justify-center gap-2 ' +
  'motion-safe:transition-colors duration-120 ease-out-expo focus-ring ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

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
