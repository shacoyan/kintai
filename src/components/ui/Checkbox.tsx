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
          'h-4 w-4 mt-1 rounded border-neutral-300 text-primary-600',
          error && 'border-danger-500',
          'focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-900',
          className,
        )}
        {...restProps}
      />
      <span className="block">
        <span className="block text-body text-neutral-900 dark:text-neutral-100">{label}</span>
        {description && !hint ? (
          <span className="block text-body-sm text-neutral-500 dark:text-neutral-300 mt-0.5">{description}</span>
        ) : null}
      </span>
    </label>
  );

  const message = error ? (
    <p
      id={errId}
      role="alert"
      className="mt-1.5 text-body-sm text-danger-500 dark:text-danger-400 flex items-start gap-1"
    >
      <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
      <span>{error}</span>
    </p>
  ) : hint ? (
    <p id={hintId} className="mt-1.5 text-body-sm text-neutral-500 dark:text-neutral-300">
      {hint}
    </p>
  ) : null;

  return <div className="flex flex-col w-full">{fieldset}{message}</div>;
});
