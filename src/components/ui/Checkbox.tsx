import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label: ReactNode;
  description?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, id, className, disabled, ...rest },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? `checkbox-${reactId}`;
  return (
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
        className={cn(
          'h-4 w-4 mt-1 rounded border-neutral-300 text-primary-600',
          'focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-900',
          className,
        )}
        {...rest}
      />
      <span className="block">
        <span className="block text-body text-neutral-900">{label}</span>
        {description ? (
          <span className="block text-body-sm text-neutral-500 mt-0.5">{description}</span>
        ) : null}
      </span>
    </label>
  );
});
