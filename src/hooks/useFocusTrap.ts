import React, { useEffect, useRef } from 'react';
import { getFocusable } from '../lib/focusable';

export interface UseFocusTrapOptions {
  active: boolean;
  returnFocusTo?: HTMLElement | null;
  initialFocus?: (root: HTMLElement) => HTMLElement | null;
  disableTabLoop?: boolean;
  isTop?: () => boolean;
}

export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  ref: React.RefObject<T>,
  options: UseFocusTrapOptions,
): void {
  const { active, returnFocusTo, initialFocus, disableTabLoop, isTop } = options;

  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const isTopRef = useRef(isTop ?? (() => true));

  isTopRef.current = isTop ?? (() => true);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (active) {
      previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

      const focusInitial = () => {
        const target = initialFocus
          ? initialFocus(element)
          : getFocusable(element)[0];

        if (target) {
          target.focus();
        }
      };

      if (!disableTabLoop) {
        focusInitial();
      }

      const handleKeyDown = (e: KeyboardEvent) => {
        if (!isTopRef.current()) return;

        if (e.key === 'Tab' && !disableTabLoop) {
          const focusables = getFocusable(element);
          if (focusables.length === 0) {
            e.preventDefault();
            return;
          }

          const first = focusables[0];
          const last = focusables[focusables.length - 1];

          if (e.shiftKey) {
            if (document.activeElement === first) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }
      };

      document.addEventListener('keydown', handleKeyDown, true);

      return () => {
        document.removeEventListener('keydown', handleKeyDown, true);
        const elementToRestore = returnFocusTo ?? previouslyFocusedRef.current;
        if (elementToRestore && document.body.contains(elementToRestore)) {
          elementToRestore.focus();
        } else {
          document.body.focus();
        }
      };
    } else {
      const elementToRestore = returnFocusTo ?? previouslyFocusedRef.current;
      if (elementToRestore && document.body.contains(elementToRestore)) {
        elementToRestore.focus();
      } else {
        document.body.focus();
      }
    }
  }, [active, ref, returnFocusTo, initialFocus, disableTabLoop, isTop]);
}
