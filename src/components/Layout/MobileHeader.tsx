import { StoreSelector } from '../Store/StoreSelector';
import { TenantSwitcher } from '../Tenant/TenantSwitcher';
import { BrandMark } from '../ui';
import { NotificationBell } from '../Notification/NotificationBell';

export function MobileHeader() {
  return (
    <div className="flex items-center w-full gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <BrandMark size="sm" color="currentColor" className="text-blue-600 dark:text-blue-400" />
        <span className="font-serif-jp text-base font-semibold text-stone-900 dark:text-stone-100 truncate">
          kintai
        </span>
      </div>
      <TenantSwitcher compact />
      <div className="flex-1" />
      <NotificationBell />
      <div className="max-w-[160px]">
        <StoreSelector />
      </div>
    </div>
  );
}
