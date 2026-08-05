import { X } from 'lucide-react';
import { Button } from '../ui';
import { messages } from '../../lib/messages';

interface BulkSelectionBarProps {
  /** 選択中の日付件数 */
  selectedCount: number;
  /** 「すべて解除」クリック時（selectedCount > 0 のときのみ表示） */
  onClearAll: () => void;
  /** 「キャンセル」クリック時 */
  onCancel: () => void;
  /** 「次へ」クリック時（selectedCount === 0 のとき disabled） */
  onProceed: () => void;
  /** PC / SP で外側の margin 等を差し替えるための追加クラス */
  className?: string;
}

/**
 * 一括シフト申請「選択中」バー（PC / SP 共通）。
 * 2026-08-05 kintai-shift-mine-filter 機能2:
 * PC・SP でほぼ同一だった JSX を 1 箇所に集約。
 * PC / SP いずれの呼び出し元でも「カレンダーの上」に配置すること（下端 sticky にしない）。
 */
export function BulkSelectionBar({
  selectedCount,
  onClearAll,
  onCancel,
  onProceed,
  className = '',
}: BulkSelectionBarProps) {
  return (
    // 理由: 一括選択モード active 状態の枠線強調 (例外③)
    <div
      role="region"
      aria-label="一括シフト申請 選択モード"
      className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 flex-wrap rounded-md border border-blue-100 dark:border-blue-700 bg-blue-50 dark:bg-blue-800/30 px-3 py-2 static shadow-none ${className}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-blue-700 dark:text-blue-100 tabular-nums">
          {messages.shiftPreference.bulk.selectedCount(selectedCount)}
        </span>
        {selectedCount > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="text-xs font-semibold text-blue-700 dark:text-blue-200 hover:underline focus-ring"
          >
            {messages.shiftPreference.bulk.clearAll}
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<X className="w-4 h-4" />}
          onClick={onCancel}
          className="grow sm:grow-0"
        >
          {messages.shiftPreference.bulk.cancelMode}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onProceed}
          disabled={selectedCount === 0}
          className="grow sm:grow-0"
        >
          {messages.shiftPreference.bulk.proceedButton(selectedCount)}
        </Button>
      </div>
    </div>
  );
}
