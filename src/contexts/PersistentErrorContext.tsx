import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  type FC,
  type ReactNode,
} from 'react';

export type PersistentErrorSeverity = 'critical' | 'warning';

export interface PersistentError {
  id: string;
  key: string;
  severity: PersistentErrorSeverity;
  operation?: string;
  title?: string;
  message: string;
  detail?: string;
  errorCode?: string;
  occurredAt: string; // ISO string
  count: number;
  retry?: () => Promise<void>;
  retryAttempts: number;
  isRetrying?: boolean;
}

export interface PersistentErrorContextValue {
  errors: PersistentError[];
  push: (input: Omit<PersistentError, 'id' | 'occurredAt' | 'count' | 'retryAttempts' | 'isRetrying'>) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  retry: (id: string) => Promise<void>;
  // 指示書 API 名のエイリアス
  addError: PersistentErrorContextValue['push'];
  dismissError: PersistentErrorContextValue['dismiss'];
  retryError: PersistentErrorContextValue['retry'];
}

const PersistentErrorContext = createContext<PersistentErrorContextValue | null>(null);

let fallbackCounter = 0;
const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${++fallbackCounter}`;
};

const SUPPRESS_DURATION = 30_000;
const DEDUP_DURATION = 60_000;
// Loop E PoC: 最大 3 件を state に保持。4 件目以降は古いものから破棄。
const MAX_ERRORS = 3;

const SESSION_KEY_PREFIX = 'kintai_dismissed_error_';

export const PersistentErrorProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [errors, setErrors] = useState<PersistentError[]>([]);
  const errorsRef = useRef<PersistentError[]>(errors);
  errorsRef.current = errors;

  const push = useCallback<PersistentErrorContextValue['push']>((input) => {
    const now = Date.now();

    // sessionStorage 抑止チェック (Safari private mode 安全)
    try {
      const suppressedTimestamp = sessionStorage.getItem(`${SESSION_KEY_PREFIX}${input.key}`);
      if (suppressedTimestamp) {
        const parsedTimestamp = parseInt(suppressedTimestamp, 10);
        if (!isNaN(parsedTimestamp) && now - parsedTimestamp < SUPPRESS_DURATION) {
          return; // 直近 dismiss により抑止
        }
      }
    } catch {
      // storage アクセス不能は無視
    }

    setErrors((prevErrors) => {
      const existingIndex = prevErrors.findIndex(
        (e) => e.key === input.key && now - new Date(e.occurredAt).getTime() < DEDUP_DURATION
      );

      let updatedErrors: PersistentError[];

      if (existingIndex !== -1) {
        const existingError = prevErrors[existingIndex];
        const updatedError: PersistentError = {
          ...existingError,
          message: input.message,
          detail: input.detail ?? existingError.detail,
          retry: input.retry ?? existingError.retry,
          occurredAt: new Date(now).toISOString(),
          count: existingError.count + 1,
        };

        updatedErrors = [
          updatedError,
          ...prevErrors.slice(0, existingIndex),
          ...prevErrors.slice(existingIndex + 1),
        ];
      } else {
        const newError: PersistentError = {
          ...input,
          id: generateId(),
          occurredAt: new Date(now).toISOString(),
          count: 1,
          retryAttempts: 0,
          isRetrying: false,
        };
        updatedErrors = [newError, ...prevErrors];
      }

      // MAX_ERRORS 超過分は古いものから破棄
      return updatedErrors.slice(0, MAX_ERRORS);
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setErrors((prevErrors) => {
      const errorToDismiss = prevErrors.find((e) => e.id === id);
      if (errorToDismiss) {
        try {
          sessionStorage.setItem(
            `${SESSION_KEY_PREFIX}${errorToDismiss.key}`,
            String(Date.now())
          );
        } catch {
          // 無視 (Safari private mode 等)
        }
      }
      return prevErrors.filter((e) => e.id !== id);
    });
  }, []);

  const dismissAll = useCallback(() => {
    const now = Date.now();
    setErrors((prevErrors) => {
      prevErrors.forEach((error) => {
        try {
          sessionStorage.setItem(
            `${SESSION_KEY_PREFIX}${error.key}`,
            String(now)
          );
        } catch {
          // 無視
        }
      });
      return [];
    });
  }, []);

  const retry = useCallback(async (id: string) => {
    const error = errorsRef.current.find((e) => e.id === id);
    if (!error || !error.retry) {
      return;
    }

    setErrors((prev) =>
      prev.map((e) => (e.id === id ? { ...e, isRetrying: true } : e))
    );

    try {
      await error.retry();
      // 成功: sessionStorage 抑止には記録せず、即時 dismiss
      setErrors((prev) => prev.filter((e) => e.id !== id));
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setErrors((prev) =>
        prev.map((e) =>
          e.id === id
            ? {
                ...e,
                message: errorMessage,
                retryAttempts: e.retryAttempts + 1,
                isRetrying: false,
              }
            : e
        )
      );
    }
  }, []);

  const contextValue = useMemo<PersistentErrorContextValue>(
    () => ({
      errors,
      push,
      dismiss,
      dismissAll,
      retry,
      addError: push,
      dismissError: dismiss,
      retryError: retry,
    }),
    [errors, push, dismiss, dismissAll, retry],
  );

  return (
    <PersistentErrorContext.Provider value={contextValue}>
      {children}
    </PersistentErrorContext.Provider>
  );
};

export const usePersistentError = (): PersistentErrorContextValue => {
  const context = useContext(PersistentErrorContext);
  if (!context) {
    throw new Error('usePersistentError must be used within a PersistentErrorProvider');
  }
  return context;
};
