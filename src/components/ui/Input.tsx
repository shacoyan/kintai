import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
  size?: Size;
}

type Size = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-9 px-3 text-sm',
  lg: 'h-10 px-3.5 text-sm',
};

const FIELD_BASE =
  'w-full rounded-md border border-stone-300 bg-white text-stone-900 placeholder:text-stone-400 ' +
  'motion-safe:transition-colors duration-150 ease-out focus:outline-none ' +
  'disabled:bg-stone-50 disabled:text-stone-400 disabled:cursor-not-allowed ' +
  'dark:bg-stone-900 dark:border-stone-700 dark:text-stone-100 dark:placeholder:text-stone-500 dark:disabled:bg-stone-950';

const FIELD_NORMAL =
  'enabled:hover:border-stone-400 dark:enabled:hover:border-stone-600 ' +
  'focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 ' +
  'dark:focus-visible:border-blue-400 dark:focus-visible:ring-blue-400/30';

const FIELD_ERROR =
  'border-red-500 dark:border-red-500 focus-visible:border-red-500 focus-visible:ring-2 focus-visible:ring-red-500/20 ' +
  'dark:focus-visible:border-red-400 dark:focus-visible:ring-red-400/30';

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    leftIcon,
    rightSlot,
    size = 'md',
    required,
    id,
    className,
    disabled,
    'aria-describedby': ariaDescribedByProp,
    ...rest
  },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? `input-${reactId}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errId = error ? `${inputId}-error` : undefined;
  const describedBy =
    [ariaDescribedByProp, errId, hintId && !error ? hintId : undefined]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className="relative w-full">
      {label ? (
        <label htmlFor={inputId} className="block text-xs font-medium text-stone-700 mb-1.5 dark:text-stone-300">
          {label}
          {required ? (
            <span aria-hidden="true" className="text-red-500 dark:text-red-400 ml-0.5">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      <div className="relative">
        {leftIcon ? (
          <span
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500 inline-flex"
          >
            {leftIcon}
          </span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          className={cn(
            FIELD_BASE,
            SIZE_CLASSES[size],
            error ? FIELD_ERROR : FIELD_NORMAL,
            leftIcon ? 'pl-10' : null,
            rightSlot ? 'pr-10' : null,
            className,
          )}
          {...rest}
        />
        {rightSlot ? (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex">
            {rightSlot}
          </span>
        ) : null}
      </div>
      {error ? (
        <p
          id={errId}
          role="alert"
          className="mt-1.5 text-xs text-red-600 dark:text-red-400 flex items-start gap-1"
        >
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

Input.displayName = 'Input';
