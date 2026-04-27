import { useEffect, useRef, useCallback } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Info,
  X,
} from 'lucide-react';
import { cn } from '../../lib/cn';

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface ToastItem {
  id: string;
  tone?: ToastTone;
  title?: string;
  message: string;
  duration?: number;
}

export interface ToastProps extends ToastItem {
  onDismiss: (id: string) => void;
}

export interface ToastViewportProps {
  items: ToastItem[];
  onDismiss: (id: string) => void;
  position?: 'top-center' | 'bottom-right';
}

const TONE_BORDER: Record<ToastTone, string> = {
  neutral: '',
  success: 'border-l-4 border-success-500',
  warning: 'border-l-4 border-warning-500',
  danger: 'border-l-4 border-danger-500',
  info: 'border-l-4 border-info-500',
};

const TONE_ICON_COLOR: Record<ToastTone, string> = {
  neutral: 'text-white',
  success: 'text-success-500',
  warning: 'text-warning-500',
  danger: 'text-danger-500',
  info: 'text-info-500',
};

function ToneIcon({ tone }: { tone: ToastTone }): JSX.Element | null {
  const props = { size: 18, 'aria-hidden': true } as const;
  if (tone === 'success') return <CheckCircle {...props} />;
  if (tone === 'warning') return <AlertTriangle {...props} />;
  if (tone === 'danger') return <AlertCircle {...props} />;
  if (tone === 'info') return <Info {...props} />;
  return null;
}

export function Toast(props: ToastProps): JSX.Element {
  const {
    id,
    tone = 'neutral',
    title,
    message,
    duration = 4000,
    onDismiss,
  } = props;

  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const remainingRef = useRef<number>(0);
  const isPausedRef = useRef<boolean>(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(
    (ms: number) => {
      if (duration <= 0) return;
      clearTimer();
      startedAtRef.current = Date.now();
      remainingRef.current = ms;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        onDismiss(id);
      }, ms);
    },
    [clearTimer, duration, id, onDismiss],
  );

  useEffect(() => {
    if (duration <= 0) return;
    if (!isPausedRef.current) {
      startTimer(duration);
    }
    return () => {
      clearTimer();
    };
  }, [startTimer, clearTimer, duration]);

  const handleMouseEnter = useCallback(() => {
    if (duration <= 0 || isPausedRef.current) return;
    isPausedRef.current = true;
    const elapsed = Date.now() - startedAtRef.current;
    remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    clearTimer();
  }, [clearTimer, duration]);

  const handleMouseLeave = useCallback(() => {
    if (duration <= 0 || !isPausedRef.current) return;
    isPausedRef.current = false;
    startTimer(remainingRef.current);
  }, [startTimer, duration]);

  const handleFocus = useCallback(() => {
    if (duration <= 0 || isPausedRef.current) return;
    isPausedRef.current = true;
    const elapsed = Date.now() - startedAtRef.current;
    remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    clearTimer();
  }, [clearTimer, duration]);

  const handleBlur = useCallback(() => {
    if (duration <= 0 || !isPausedRef.current) return;
    isPausedRef.current = false;
    startTimer(remainingRef.current);
  }, [startTimer, duration]);

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className={cn(
        'pointer-events-auto flex max-w-sm items-start gap-3 rounded-md bg-neutral-900 px-4 py-3 text-body-sm text-white shadow-lg motion-safe:animate-fade-in',
        TONE_BORDER[tone],
      )}
    >
      {tone !== 'neutral' ? (
        <span className={cn('mt-0.5 shrink-0', TONE_ICON_COLOR[tone])}>
          <ToneIcon tone={tone} />
        </span>
      ) : null}

      <div className="min-w-0 flex-1">
        {title ? (
          <p className="font-semibold leading-snug">{title}</p>
        ) : null}
        <p className={cn('leading-snug', title ? 'mt-0.5 opacity-90' : '')}>
          {message}
        </p>
      </div>

      <button
        type="button"
        aria-label="閉じる"
        onClick={() => onDismiss(id)}
        className="-mr-1 -mt-1 shrink-0 rounded p-1 text-white/70 motion-safe:transition-colors duration-120 hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastViewport(props: ToastViewportProps): JSX.Element {
  const { items, onDismiss, position = 'bottom-right' } = props;

  const positionClass =
    position === 'top-center'
      ? 'top-4 left-1/2 -translate-x-1/2 items-center'
      : 'bottom-4 right-4 items-end';

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        'pointer-events-none fixed z-50 flex flex-col gap-2',
        positionClass,
      )}
    >
      {items.map((item) => (
        <Toast key={item.id} {...item} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
