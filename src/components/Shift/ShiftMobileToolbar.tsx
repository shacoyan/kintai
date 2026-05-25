import { ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { format } from 'date-fns';

interface Props {
  shiftViewMonth: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onFilterClick?: () => void;
  pendingFilterCount?: number;
}

export function ShiftMobileToolbar({
  shiftViewMonth,
  onPrevMonth,
  onNextMonth,
  onFilterClick,
  pendingFilterCount,
}: Props) {
  return (
    <div className="sticky -top-3 z-10 bg-stone-50/95 dark:bg-stone-900/95 backdrop-blur px-3 pt-2 pb-2.5 flex items-center gap-2 -mx-4 lg:hidden">
      <button
        type="button"
        onClick={onPrevMonth}
        aria-label="前月"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-500 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 focus-ring"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <div className="flex min-w-[56px] flex-col items-center">
        <span className="text-sm font-semibold text-stone-900 dark:text-stone-100 tabular-nums">
          {format(shiftViewMonth, 'yyyy/MM')}
        </span>
      </div>
      <button
        type="button"
        onClick={onNextMonth}
        aria-label="次月"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-500 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 focus-ring"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      <div className="flex-1" />
      {onFilterClick && (
        <button
          type="button"
          onClick={onFilterClick}
          aria-label={pendingFilterCount && pendingFilterCount > 0 ? `フィルタ (${pendingFilterCount})` : 'フィルタ'}
          className="relative inline-flex h-7 w-7 items-center justify-center rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 focus-ring"
        >
          <Filter className="w-3.5 h-3.5" />
          {pendingFilterCount && pendingFilterCount > 0 ? (
            <span className="absolute -top-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-white text-[9px] font-semibold tabular-nums">
              {pendingFilterCount}
            </span>
          ) : null}
        </button>
      )}
    </div>
  );
}
