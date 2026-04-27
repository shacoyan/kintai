import React, { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ToastViewport, type ToastTone, type ToastItem } from '../components/ui';

type LegacyToastType = 'success' | 'error' | 'info';

export interface ShowToastOptions {
  tone?: ToastTone;
  title?: string;
  duration?: number;
}

type ShowToastSecondArg = LegacyToastType | ShowToastOptions | undefined;

interface ToastContextValue {
  showToast: (message: string, optionsOrType?: ShowToastSecondArg) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TYPE_TO_TONE: Record<LegacyToastType, ToastTone> = {
  success: 'success',
  info: 'info',
  error: 'danger',
};

function isLegacyType(value: unknown): value is LegacyToastType {
  return value === 'success' || value === 'error' || value === 'info';
}

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, optionsOrType?: ShowToastSecondArg) => {
    const id = `toast-${Date.now()}-${++counterRef.current}`;

    let tone: ToastTone = 'info';
    let title: string | undefined;
    let duration: number | undefined;

    if (typeof optionsOrType === 'string') {
      // 後方互換: 'success' | 'error' | 'info'
      if (isLegacyType(optionsOrType)) {
        tone = TYPE_TO_TONE[optionsOrType];
      }
    } else if (optionsOrType && typeof optionsOrType === 'object') {
      if (optionsOrType.tone) tone = optionsOrType.tone;
      if (optionsOrType.title) title = optionsOrType.title;
      if (typeof optionsOrType.duration === 'number') duration = optionsOrType.duration;
    }

    const item: ToastItem = { id, tone, message };
    if (title !== undefined) item.title = title;
    if (duration !== undefined) item.duration = duration;

    setToasts((prev) => [...prev, item]);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastViewport items={toasts} onDismiss={dismiss} position="bottom-right" />
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
};
