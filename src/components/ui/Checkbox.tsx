import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label: ReactNode;
  description?: string;
  hint?: string;
  error?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, hint, error, id, className, disabled, ...rest },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? `checkbox-${reactId}`;
  const errId = error ? `checkbox-err-${reactId}` : undefined;
  const hintId = hint && !error ? `checkbox-hint-${reactId}` : undefined;

  const { 'aria-describedby': ariaDescribedByProp, ...restProps } = rest;
  const ariaDescribedBy = [ariaDescribedByProp, errId, hintId].filter(Boolean).join(' ') || undefined;

  const fieldset = (
    <label
      htmlFor={inputId}
      className={cn(
        'inline-flex items-start gap-2 min-h-[44px] py-2 cursor-pointer select-none',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={ariaDescribedBy}
        className={cn(
          'h-4 w-4 mt-1 rounded-[4px] border border-stone-300 bg-white text-blue-600 ' +
            'motion-safe:transition-colors duration-150 ease-out checked:bg-blue-600 checked:border-blue-600 ' +
            'hover:border-stone-400 focus-visible:ring-2 focus-visible:ring-blue-500 ' +
            'focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 ' +
            'dark:bg-stone-900 dark:border-stone-600 dark:checked:bg-blue-500 dark:checked:border-blue-500 ' +
            'dark:focus-visible:ring-blue-400 dark:focus-visible:ring-offset-stone-900',
          error && 'border-red-500 dark:border-red-500',
          className,
        )}
        {...restProps}
      />
      <span className="block">
        <span className="block text-sm text-stone-900 dark:text-stone-100">{label}</span>
        {description && !hint ? (
          <span className="block text-xs text-stone-500 dark:text-stone-400 mt-0.5">{description}</span>
        ) : null}
      </span>
    </label>
  );

  const message = error ? (
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
  ) : null;

  return <div className="flex flex-col w-full">{fieldset}{message}</div>;
});

Checkbox.displayName = 'Checkbox';
