import type { ReactNode } from 'react';
import { AppShell } from './AppShell';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileHeader } from './MobileHeader';
import { BottomNav } from './BottomNav';
import { OnboardingDialog } from '../Onboarding/OnboardingDialog';
import { PersistentErrorStack } from '../ui/PersistentErrorStack';

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
      errorSlot={<PersistentErrorStack />}
    >
      <OnboardingDialog />
      <div className="mx-auto w-full max-w-7xl">{children}</div>
    </AppShell>
  );
}
