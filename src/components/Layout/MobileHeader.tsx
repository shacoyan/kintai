import { StoreSelector } from '../Store/StoreSelector';
import { BrandMark } from '../ui';

export function MobileHeader() {
  return (
    <div className="flex items-center w-full gap-3">
      <div className="flex items-center gap-2">
        <BrandMark size="sm" color="currentColor" className="text-primary-700 dark:text-primary-400" />
        <span className="font-serif-jp text-base font-semibold text-primary-700 dark:text-primary-400">
          kintai
        </span>
      </div>
      <div className="flex-1" />
      <StoreSelector />
    </div>
  );
}
