import type { ReactNode } from 'react';
import { AppShell } from './AppShell';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileHeader } from './MobileHeader';
import { BottomNav } from './BottomNav';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <AppShell
      sidebar={<Sidebar />}
      topbar={<TopBar />}
      mobileHeader={<MobileHeader />}
      bottomNav={<BottomNav />}
    >
      {children}
    </AppShell>
  );
}
