import { forwardRef, useId } from 'react';
import type { TextareaHTMLAttributes } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

const FIELD_BASE =
  'w-full min-h-[96px] resize-y border rounded-md bg-white px-3.5 py-2.5 text-body ' +
  'placeholder:text-neutral-300 motion-safe:transition-colors duration-120 ease-out-expo ' +
  'focus:outline-none focus-visible:ring-2 ' +
  'disabled:bg-neutral-50 disabled:cursor-not-allowed ' +
  'dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:disabled:bg-neutral-900';

const FIELD_NORMAL =
  'border-neutral-300 focus-visible:border-primary-500 dark:focus-visible:border-primary-400 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400 ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 ' +
  'dark:border-neutral-600 dark:focus-visible:ring-offset-neutral-900';

const FIELD_ERROR =
  'border-danger-500 focus-visible:border-danger-500 dark:focus-visible:border-danger-400 focus-visible:ring-danger-500 dark:focus-visible:ring-danger-400 ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 ' +
  'dark:focus-visible:ring-offset-neutral-900';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    hint,
    error,
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
  const inputId = id ?? `textarea-${reactId}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errId = error ? `${inputId}-error` : undefined;
  const describedBy =
    [ariaDescribedByProp, errId, hintId && !error ? hintId : undefined]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className="w-full">
      {label ? (
        <label htmlFor={inputId} className="block text-label text-neutral-700 mb-2 dark:text-neutral-300">
          {label}
          {required ? (
            <span aria-hidden="true" className="text-danger-500 ml-0.5">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      <textarea
        ref={ref}
        id={inputId}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        className={cn(FIELD_BASE, error ? FIELD_ERROR : FIELD_NORMAL, className)}
        {...rest}
      />
      {error ? (
        <p
          id={errId}
          role="alert"
          className="mt-1.5 text-body-sm text-danger-500 flex items-start gap-1"
        >
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-body-sm text-neutral-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
