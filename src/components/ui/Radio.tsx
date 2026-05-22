import { createContext, forwardRef, useContext, useId } from 'react';
import type { InputHTMLAttributes, ReactNode, ChangeEvent } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

interface RadioGroupContextValue {
  name?: string;
  value?: string;
  onChange?: (value: string) => void;
  groupId?: string;
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
  const ctx = useContext(RadioGroupContext);

  let inputId = id ?? `radio-${reactId}`;
  if (ctx?.groupId && value !== undefined) {
    inputId = id ?? `${ctx.groupId}-${value}`;
  }

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
          'h-4 w-4 mt-1 rounded-full border border-stone-300 bg-white text-blue-600 ' +
            'motion-safe:transition-colors duration-150 ease-out checked:bg-blue-600 checked:border-blue-600 ' +
            'hover:border-stone-400 focus-visible:ring-2 focus-visible:ring-blue-500 ' +
            'focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 ' +
            'dark:bg-stone-900 dark:border-stone-600 dark:checked:bg-blue-500 dark:checked:border-blue-500 ' +
            'dark:focus-visible:ring-blue-400 dark:focus-visible:ring-offset-stone-900',
          className,
        )}
        {...rest}
      />
      <span className="block">
        <span className="block text-sm text-stone-900 dark:text-stone-100">{label}</span>
        {description ? (
          <span className="block text-xs text-stone-500 dark:text-stone-400 mt-0.5">{description}</span>
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
  const groupId = `radiogroup-${reactId}`;
  const labelId = label ? `${groupId}-label` : undefined;
  const hintId = hint ? `${groupId}-hint` : undefined;
  const errId = error ? `${groupId}-error` : undefined;
  const describedBy =
    [errId, hintId && !error ? hintId : undefined].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('w-full', className)}>
      {label ? (
        <span id={labelId} className="block text-xs font-medium text-stone-700 mb-1.5 dark:text-stone-300">
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
        <RadioGroupContext.Provider value={{ name, value, onChange, groupId }}>
          {children}
        </RadioGroupContext.Provider>
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
}

Radio.displayName = 'Radio';
