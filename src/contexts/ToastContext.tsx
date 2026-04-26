import React, { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ToastViewport, type ToastTone, type ToastItem } from '../components/ui';

type LegacyToastType = 'success' | 'error' | 'info';

interface ToastContextValue {
  showToast: (message: string, type?: LegacyToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TYPE_TO_TONE: Record<LegacyToastType, ToastTone> = {
  success: 'success',
  info: 'info',
  error: 'danger',
};

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: LegacyToastType = 'info') => {
    const id = `toast-${Date.now()}-${++counterRef.current}`;
    const tone = TYPE_TO_TONE[type] ?? 'info';
    setToasts((prev) => [...prev, { id, tone, message }]);
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
