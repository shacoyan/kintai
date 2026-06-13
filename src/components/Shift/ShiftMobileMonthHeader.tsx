import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

interface Props {
  shiftViewMonth: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
}

// finalSpec §2: 月ラベル + 前後送り + 今日 + 曜日ヘッダを一塊で sticky。
// weekStartsOn: 1（月始まり）。土=blue-600 / 日=red-700 / 平日=stone-500。
const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'] as const;

function weekdayColorClass(index: number): string {
  if (index === 5) return 'text-blue-600 dark:text-blue-400'; // 土
  if (index === 6) return 'text-red-700 dark:text-red-400'; // 日
  return 'text-stone-500 dark:text-stone-400'; // 平日
}

export function ShiftMobileMonthHeader({
  shiftViewMonth,
  onPrevMonth,
  onNextMonth,
  onToday,
}: Props) {
  return (
    <div className="sticky top-0 z-10 bg-stone-50/95 dark:bg-stone-900/95 backdrop-blur -mx-4 px-3 pt-2 pb-2 lg:hidden">
      {/* 上段: 月ラベル + 前後送り + 今日 */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onPrevMonth}
          aria-label="前月"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-stone-500 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="flex-1 text-center text-base font-semibold text-stone-900 dark:text-stone-100 tabular-nums">
          {format(shiftViewMonth, 'yyyy年M月')}
        </span>
        <button
          type="button"
          onClick={onNextMonth}
          aria-label="次月"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-stone-500 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={onToday}
          aria-label="今日へ移動"
          className="inline-flex h-11 min-w-[44px] items-center justify-center rounded-md px-3 text-[13px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-stone-100 dark:hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          今日
        </button>
      </div>

      {/* 下段: 曜日ヘッダ（月始まり） */}
      <div className="mt-1.5 grid grid-cols-7">
        {WEEKDAY_LABELS.map((label, index) => (
          <div
            key={label}
            className={`text-center text-[11px] font-semibold ${weekdayColorClass(index)}`}
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
