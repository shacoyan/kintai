import { useEffect } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { X, Plus } from 'lucide-react';
import { Button } from '../ui';
import { UnifiedShiftSidebar, type UnifiedShiftSidebarProps } from './UnifiedShiftSidebar';

export interface DayDetailModalProps extends Omit<UnifiedShiftSidebarProps, 'selectedDate'> {
  /** ISO yyyy-MM-dd。null のとき modal は描画されない */
  selectedDate: string | null;
  /** 「追加」ボタンクリック (Toolbar 右上の Quick Add)。未指定なら表示しない */
  onQuickAdd?: () => void;
}

/**
 * 日付セルクリックで開く詳細モーダル (PC 専用)。
 *
 * 正典 `screen-shift.jsx` `DayDetailModal` の構造をベースに、
 * kintai の既存 `UnifiedShiftSidebar` を本体に流用することで
 * 編集/承認/却下/フォームの機能を完全に保持する。
 */
export function DayDetailModal(props: DayDetailModalProps) {
  const { selectedDate, onSelectedDateChange, onQuickAdd, ...rest } = props;

  useEffect(() => {
    if (!selectedDate) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSelectedDateChange(null);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [selectedDate, onSelectedDateChange]);

  if (!selectedDate) return null;

  const dateObj = (() => {
    try {
      const parsed = new Date(`${selectedDate}T00:00:00`);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    } catch {
      return null;
    }
  })();

  const yyyymm = dateObj ? format(dateObj, 'yyyy / MM', { locale: ja }) : selectedDate.slice(0, 7);
  const dd = dateObj ? format(dateObj, 'd', { locale: ja }) : selectedDate.slice(8, 10);
  const weekday = dateObj ? format(dateObj, '(E)', { locale: ja }) : '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="day-detail-modal-title"
      onClick={() => onSelectedDateChange(null)}
      className="fixed inset-0 z-30 bg-stone-900/30 backdrop-blur-[2px] flex items-center justify-center p-6 motion-safe:animate-[fadeIn_120ms_ease-out]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] max-h-[85vh] bg-white dark:bg-stone-900 rounded-xl shadow-2xl flex flex-col overflow-hidden motion-safe:animate-[zoomIn_150ms_ease-out]"
      >
        <div className="px-5 py-4 flex items-center gap-3 border-b border-stone-200/70 dark:border-stone-700">
          <div className="min-w-0">
            <div className="text-[11px] text-stone-500 dark:text-stone-400 font-medium tabular-nums">
              {yyyymm}
            </div>
            <div
              id="day-detail-modal-title"
              className="text-2xl font-bold leading-none mt-0.5 text-stone-900 dark:text-stone-100"
            >
              <span className="tabular-nums">{dd}</span>
              <span className="text-[13px] text-stone-500 dark:text-stone-400 font-medium ml-1">
                {weekday}
              </span>
            </div>
          </div>
          <div className="flex-1" />
          {onQuickAdd && (
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Plus className="w-4 h-4" />}
              onClick={onQuickAdd}
            >
              追加
            </Button>
          )}
          <button
            type="button"
            onClick={() => onSelectedDateChange(null)}
            aria-label="閉じる"
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-stone-500 hover:text-stone-900 hover:bg-stone-100 dark:hover:bg-stone-800 motion-safe:transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <UnifiedShiftSidebar
            {...rest}
            selectedDate={selectedDate}
            onSelectedDateChange={onSelectedDateChange}
          />
        </div>
      </div>
    </div>
  );
}
