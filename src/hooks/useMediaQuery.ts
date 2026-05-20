import { useState, useEffect } from 'react';

export function useMediaQuery(query: string): boolean {
  // P2 修正 (Reviewer 指摘): lazy 初期化で初回 useEffect 完了前の flicker を防ぐ。
  // 以前は `useState<boolean>(false)` 固定で、PC でも初回 paint 時に isDesktop=false となり
  // Sidebar が一瞬非表示になっていた。同期的に matchMedia を評価して初期値を確定させる。
  // SSR では window が無いため false にフォールバック (hydration mismatch は client-only 用途のため許容)。
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    const handler = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
    } else {
      // Fallback for older browsers
      mql.addListener(handler);
    }

    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener('change', handler);
      } else {
        mql.removeListener(handler);
      }
    };
  }, [query]);

  return matches;
}
