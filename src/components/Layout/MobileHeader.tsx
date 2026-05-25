import { BrandMark } from '../ui';
import { NotificationBell } from '../Notification/NotificationBell';
import { UserMenuPopover } from './UserMenuPopover';

export function MobileHeader() {
  return (
    <div className="flex items-center w-full gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <BrandMark size="sm" color="currentColor" className="text-blue-600 dark:text-blue-400" />
        <span className="font-serif-jp text-base font-semibold text-stone-900 dark:text-stone-100 truncate">
          kintai
        </span>
      </div>
      <div className="flex-1" />
      <NotificationBell />
      <UserMenuPopover showStoreSelector showRoleBadge showThemeToggle />
    </div>
  );
}
