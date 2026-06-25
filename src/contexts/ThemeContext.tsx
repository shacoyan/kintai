import React, { createContext, useCallback, useContext, useMemo, useState, useEffect } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      if (typeof localStorage === 'undefined') return 'light';
      return (localStorage.getItem('kintai_theme') as Theme) || 'light';
    } catch {
      // localStorage 読取不可 (Safari プライベート / iframe sandbox 等) は既定 light
      return 'light';
    }
  });

  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    let dark = false;
    if (theme === 'dark') {
      dark = true;
    } else if (theme === 'system') {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    setIsDark(dark);
    root.classList.toggle('dark', dark);
  }, [theme]);

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setIsDark(e.matches);
      document.documentElement.classList.toggle('dark', e.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('kintai_theme', t);
    } catch {
      // 書込不可は無視 (UI 上の切替は state で維持される)
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme, isDark }), [theme, setTheme, isDark]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
};
