import type { ReactNode } from 'react';

export interface AppShellProps {
  children: ReactNode;
  sidebar?: ReactNode;
  topbar?: ReactNode;
  mobileHeader?: ReactNode;
  bottomNav?: ReactNode;
  /**
   * <main> 直上の sticky スロット。Loop E 持続エラーバナー (PersistentErrorStack) を配置する用途。
   */
  errorSlot?: ReactNode;
}

export function AppShell({ children, sidebar, topbar, mobileHeader, bottomNav, errorSlot }: AppShellProps) {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100 flex">
      {sidebar && (
        <aside
          aria-label="グローバルナビゲーション"
          className="hidden md:flex md:flex-col md:w-[240px] md:shrink-0 md:bg-white md:dark:bg-stone-900 md:border-r md:border-stone-200 md:dark:border-stone-800"
        >
          {sidebar}
        </aside>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {topbar && (
          <header className="hidden md:flex md:items-center md:h-14 md:px-6 md:bg-white md:dark:bg-stone-900 md:border-b md:border-stone-200 md:dark:border-stone-800 md:shadow-[0_1px_2px_rgba(0,0,0,0.04)] md:sticky md:top-0 md:z-30">
            {topbar}
          </header>
        )}

        {mobileHeader && (
          <header className="flex md:hidden items-center h-12 px-4 bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 sticky top-0 z-30">
            {mobileHeader}
          </header>
        )}

        {errorSlot}

        <main id="main" className="flex-1 min-w-0 px-4 md:px-6 py-4 md:py-6 pb-20 md:pb-6">
          {children}
        </main>

        {bottomNav && (
          <nav
            aria-label="メインナビゲーション"
            className="md:hidden fixed bottom-0 inset-x-0 h-16 border-t border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 z-30"
          >
            {bottomNav}
          </nav>
        )}
      </div>
    </div>
  );
}
