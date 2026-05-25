import { NotificationBell } from '../Notification/NotificationBell';
import { UserMenuPopover } from './UserMenuPopover';

export interface TopBarProps {
  title?: string;
  showRoleBadge?: boolean;
  showStoreSelector?: boolean;
  showThemeToggle?: boolean;
  showNotificationBell?: boolean;
  showUserMenu?: boolean;
  rightSlot?: React.ReactNode;
}

export function TopBar({
  title,
  showRoleBadge = true,
  showStoreSelector = true,
  showThemeToggle = true,
  showNotificationBell = true,
  showUserMenu = true,
  rightSlot,
}: TopBarProps) {
  return (
    <div className="flex items-center w-full gap-4 flex-wrap">
      {title && (
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100 truncate">
          {title}
        </h1>
      )}
      <div className="flex-1" />
      {rightSlot}
      {showNotificationBell && <NotificationBell />}
      {showUserMenu && (
        <UserMenuPopover
          showRoleBadge={showRoleBadge}
          showStoreSelector={showStoreSelector}
          showThemeToggle={showThemeToggle}
        />
      )}
    </div>
  );
}
