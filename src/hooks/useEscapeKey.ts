import { useEffect, useRef } from 'react';

export interface UseEscapeKeyOptions {
  active: boolean;
  stopPropagation?: boolean;
  isTop?: () => boolean;
}

export function useEscapeKey(
  handler: () => void,
  options: UseEscapeKeyOptions,
): void {
  const { active, stopPropagation = true, isTop } = options;

  const isTopRef = useRef<(() => boolean) | undefined>(isTop);

  useEffect(() => {
    isTopRef.current = isTop;
  }, [isTop]);

  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') {
        return;
      }

      if (isTopRef.current) {
        if (!isTopRef.current()) {
          return;
        }
      }

      e.preventDefault();

      if (stopPropagation) {
        e.stopPropagation();
      }

      handlerRef.current();
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [active, stopPropagation]);
}
