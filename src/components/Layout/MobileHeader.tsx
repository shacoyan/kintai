import { StoreSelector } from '../Store/StoreSelector';
import { TenantSwitcher } from '../Tenant/TenantSwitcher';
import { BrandMark } from '../ui';

export function MobileHeader() {
  return (
    <div className="flex items-center w-full gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <BrandMark size="sm" color="currentColor" className="text-primary-700 dark:text-primary-400" />
        <span className="font-serif-jp text-base font-semibold text-primary-700 dark:text-primary-400 truncate">
          kintai
        </span>
      </div>
      <TenantSwitcher compact />
      <div className="flex-1" />
      <div className="max-w-[160px]">
        <StoreSelector />
      </div>
    </div>
  );
}

