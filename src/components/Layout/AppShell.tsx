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
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100 flex">
      {sidebar && (
        <aside
          aria-label="グローバルナビゲーション"
          className="hidden md:flex md:flex-col md:w-[240px] md:shrink-0 md:border-r md:border-neutral-200 md:bg-white md:dark:border-neutral-800 md:dark:bg-neutral-900"
        >
          {sidebar}
        </aside>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {topbar && (
          <header className="hidden md:flex md:items-center md:h-16 md:px-6 md:border-b md:border-neutral-200 md:bg-white md:dark:border-neutral-800 md:dark:bg-neutral-900 md:sticky md:top-0 md:z-30">
            {topbar}
          </header>
        )}

        {mobileHeader && (
          <header className="flex md:hidden items-center h-14 px-4 border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 sticky top-0 z-30">
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
            className="md:hidden fixed bottom-0 inset-x-0 h-16 border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 z-30"
          >
            {bottomNav}
          </nav>
        )}
      </div>
    </div>
  );
}
