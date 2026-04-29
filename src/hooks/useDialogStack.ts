import { useEffect, useRef } from 'react';

const stack: symbol[] = [];

export interface DialogStackHandle {
  isTop: () => boolean;
}

export function useDialogStack(active: boolean): DialogStackHandle {
  const id = useRef<symbol | null>(null);

  useEffect(() => {
    if (active) {
      const symbol = Symbol();
      id.current = symbol;
      stack.push(symbol);

      return () => {
        const index = stack.indexOf(symbol);
        if (index > -1) {
          stack.splice(index, 1);
        }
        if (id.current === symbol) {
          id.current = null;
        }
      };
    }
  }, [active]);

  const isTop = (): boolean => {
    if (id.current === null) {
      return false;
    }
    return stack.length > 0 && stack[stack.length - 1] === id.current;
  };

  return { isTop };
}
