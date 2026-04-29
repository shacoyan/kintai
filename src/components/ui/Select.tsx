import { forwardRef, useId } from 'react';
import type { SelectHTMLAttributes, ReactNode } from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  placeholder?: string;
  options?: SelectOption[];
  children?: ReactNode;
}

const FIELD_BASE =
  'w-full h-12 md:h-10 appearance-none border rounded-md bg-white pl-3.5 pr-10 [dir=rtl]:pl-10 [dir=rtl]:pr-3.5 text-body ' +
  'motion-safe:transition-colors duration-120 ease-out-expo ' +
  'focus:outline-none focus-visible:ring-2 ' +
  'disabled:bg-neutral-50 disabled:cursor-not-allowed ' +
  'dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:disabled:bg-neutral-900';

const FIELD_NORMAL =
  'border-neutral-300 focus-visible:border-primary-500 dark:focus-visible:border-primary-400 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 ' +
  'dark:border-neutral-600 dark:focus-visible:ring-offset-neutral-900';

const FIELD_ERROR =
  'border-danger-500 focus-visible:border-danger-500 dark:focus-visible:border-danger-400 focus-visible:ring-danger-500 dark:focus-visible:ring-danger-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 ' +
  'dark:focus-visible:ring-offset-neutral-900';

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    hint,
    error,
    placeholder,
    options,
    children,
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
  const inputId = id ?? `select-${reactId}`;
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
            <span aria-hidden="true" className="text-danger-500 dark:text-danger-400 ml-0.5">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      <div className="relative">
        <select
          ref={ref}
          id={inputId}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          className={cn(FIELD_BASE, error ? FIELD_ERROR : FIELD_NORMAL, className)}
          {...rest}
        >
          {placeholder ? (
            <option value="" disabled hidden>
              {placeholder}
            </option>
          ) : null}
          {children
            ? children
            : options?.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </option>
              ))}
        </select>
        <ChevronDown
          className="w-4 h-4 absolute right-3 [dir=rtl]:right-auto [dir=rtl]:left-3 top-1/2 -translate-y-1/2 text-neutral-500 dark:text-neutral-300 pointer-events-none"
          aria-hidden="true"
        />
      </div>
      {error ? (
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
      ) : null}
    </div>
  );
});
