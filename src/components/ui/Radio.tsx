import { createContext, forwardRef, useContext, useId } from 'react';
import type { InputHTMLAttributes, ReactNode, ChangeEvent } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

interface RadioGroupContextValue {
  name?: string;
  value?: string;
  onChange?: (value: string) => void;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label: ReactNode;
  description?: string;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { label, description, id, className, disabled, name, value, checked, onChange, ...rest },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? `radio-${reactId}`;
  const ctx = useContext(RadioGroupContext);

  const resolvedName = ctx?.name ?? name;
  const resolvedChecked =
    ctx && value !== undefined ? ctx.value === String(value) : checked;
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (ctx?.onChange && value !== undefined) {
      ctx.onChange(String(value));
    }
    if (onChange) onChange(e);
  };

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
        type="radio"
        name={resolvedName}
        value={value}
        checked={resolvedChecked}
        onChange={handleChange}
        disabled={disabled}
        className={cn(
          'h-4 w-4 mt-1 border-neutral-300 text-primary-600',
          'focus:ring-primary-500 focus:ring-offset-0',
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

export interface RadioGroupProps {
  name: string;
  value?: string;
  onChange?: (value: string) => void;
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  orientation?: 'vertical' | 'horizontal';
  className?: string;
}

export function RadioGroup({
  name,
  value,
  onChange,
  label,
  hint,
  error,
  children,
  orientation = 'vertical',
  className,
}: RadioGroupProps): JSX.Element {
  const reactId = useId();
  const labelId = label ? `radiogroup-${reactId}-label` : undefined;
  const hintId = hint ? `radiogroup-${reactId}-hint` : undefined;
  const errId = error ? `radiogroup-${reactId}-error` : undefined;
  const describedBy =
    [errId, hintId && !error ? hintId : undefined].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('w-full', className)}>
      {label ? (
        <span id={labelId} className="block text-label text-neutral-700 mb-2">
          {label}
        </span>
      ) : null}
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        className={cn(
          'flex',
          orientation === 'vertical' ? 'flex-col gap-1' : 'flex-row flex-wrap gap-4',
        )}
      >
        <RadioGroupContext.Provider value={{ name, value, onChange }}>
          {children}
        </RadioGroupContext.Provider>
      </div>
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
}
