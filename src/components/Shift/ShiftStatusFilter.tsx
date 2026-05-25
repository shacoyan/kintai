import { useCallback } from 'react';
import type { StatusFilterValue } from './unifiedShiftTypes';
import {
  ALL_STATUS_FILTER_VALUES,
  STATUS_FILTER_LABELS,
  STATUS_FILTER_DOT_CLASS,
  STATUS_FILTER_STORAGE_KEY,
  DEFAULT_STATUS_FILTER,
} from './unifiedShiftTypes';

/**
 * localStorage から status filter を読み出す。
 * SSR 安全。失敗時はデフォルト集合。
 */
export function readStatusFilter(): Set<StatusFilterValue> {
  if (typeof window === 'undefined') return new Set(DEFAULT_STATUS_FILTER);
  try {
    const raw = localStorage.getItem(STATUS_FILTER_STORAGE_KEY);
    if (!raw) return new Set(DEFAULT_STATUS_FILTER);
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set(DEFAULT_STATUS_FILTER);
    return new Set(
      arr.filter((v) =>
        (ALL_STATUS_FILTER_VALUES as readonly string[]).includes(v)
      ) as StatusFilterValue[]
    );
  } catch {
    return new Set(DEFAULT_STATUS_FILTER);
  }
}

/**
 * localStorage へ status filter を保存する。
 * SSR 安全。失敗時は無視。
 */
export function writeStatusFilter(set: Set<StatusFilterValue>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STATUS_FILTER_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // ignore quota / serialization errors
  }
}

/**
 * Tailwind JIT は動的クラス文字列を検出できないため、
 * status ごとに完全なクラス文字列を Record で持つ必要がある。
 */
const STATUS_CHIP_ON_CLASS: Record<StatusFilterValue, string> = {
  pending_preference: 'bg-orange-50 ring-2 ring-orange-500 text-orange-700 dark:bg-orange-800/40 dark:ring-orange-400 dark:text-orange-200',
  tentative: 'bg-blue-100 ring-2 ring-blue-500 text-blue-800 dark:bg-blue-900/40 dark:ring-blue-400 dark:text-blue-300',
  approved: 'bg-emerald-50 ring-2 ring-emerald-500 text-emerald-700 dark:bg-emerald-800/40 dark:ring-emerald-400 dark:text-emerald-200',
  modified: 'bg-blue-100 ring-2 ring-blue-500 text-blue-800 dark:bg-blue-900/40 dark:ring-blue-400 dark:text-blue-300',
  rejected: 'bg-red-50 ring-2 ring-red-500 text-red-700 dark:bg-red-800/40 dark:ring-red-400 dark:text-red-200',
  cancelled: 'bg-stone-200 ring-2 ring-stone-500 text-stone-800 dark:bg-stone-700 dark:ring-stone-400 dark:text-stone-100',
};

const CHIP_OFF_CLASS =
  'bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 ring-1 ring-transparent';

interface ShiftStatusFilterProps {
  value: Set<StatusFilterValue>;
  onChange: (next: Set<StatusFilterValue>) => void;
  /**
   * true: pending_preference チェックボックスを表示 (manager 表示時)
   * false (default): 非表示
   */
  showPreferenceStatus?: boolean;
  /** chip 右端に件数を出す (オプション)。未指定は従来通り件数なし */
  counts?: Partial<Record<StatusFilterValue, number>>;
}

function StatusChip({
  status,
  isActive,
  count,
  onToggle,
}: {
  status: StatusFilterValue;
  isActive: boolean;
  count?: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isActive}
      aria-label={STATUS_FILTER_LABELS[status]}
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 px-4 py-2.5 sm:px-3 sm:py-1.5 rounded-full text-sm sm:text-xs font-medium motion-safe:transition-colors duration-150 ease-out cursor-pointer select-none ${
        isActive ? STATUS_CHIP_ON_CLASS[status] : CHIP_OFF_CLASS
      }`}
    >
      <span className={`inline-block w-2 h-2 rounded-full ${STATUS_FILTER_DOT_CLASS[status]}`} />
      <span>{STATUS_FILTER_LABELS[status]}</span>
      {typeof count === 'number' && (
        <span
          className={`tabular-nums text-[10px] ${
            isActive ? 'opacity-80' : 'text-stone-400 dark:text-stone-500'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * シフトカレンダーのステータスフィルタ (controlled component)
 * - PC: 横並び pill チェックボックス列
 * - SP: <details> で collapsible
 * - 全 OFF 時は警告バナー
 * - localStorage 永続化は親が readStatusFilter / writeStatusFilter を介して行う
 */
export function ShiftStatusFilter({
  value,
  onChange,
  showPreferenceStatus = false,
  counts,
}: ShiftStatusFilterProps) {
  const toggle = useCallback(
    (status: StatusFilterValue) => {
      const next = new Set(value);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      onChange(next);
    },
    [value, onChange]
  );

  // オーナー要望: 「修正」「却下」「取消」chip は表示しない。
  //   - 型 (StatusFilterValue) と localStorage 永続化キーは互換維持。
  //   - ShiftCalendar 側で modified/rejected/cancelled が statusFilter に
  //     含まれていれば従来通り表示されるが、UI でトグルする手段は無い。
  const HIDDEN_STATUSES: ReadonlySet<StatusFilterValue> = new Set([
    'modified',
    'rejected',
    'cancelled',
  ]);
  const displayedStatuses = ALL_STATUS_FILTER_VALUES.filter(
    (s) =>
      !HIDDEN_STATUSES.has(s) &&
      (showPreferenceStatus || s !== 'pending_preference')
  );

  const activeStatusLabels = displayedStatuses
    .filter((s) => value.has(s))
    .map((s) => STATUS_FILTER_LABELS[s]);

  const isAllOff = displayedStatuses.length > 0 && activeStatusLabels.length === 0;
  const summaryText = `${activeStatusLabels.length}/${displayedStatuses.length} 表示`;

  return (
    <div>
      {/* PC: 横並び */}
      <fieldset
        className="hidden sm:flex flex-wrap gap-2"
        aria-label="表示するステータス"
      >
        {displayedStatuses.map((status) => (
          <StatusChip
            key={status}
            status={status}
            isActive={value.has(status)}
            count={counts?.[status]}
            onToggle={() => toggle(status)}
          />
        ))}
      </fieldset>

      {/* SP: collapsible */}
      <details className="sm:hidden">
        <summary className="cursor-pointer text-sm font-medium text-stone-700 dark:text-stone-300 select-none px-2 py-2">
          表示ステータス（{summaryText}）
        </summary>
        <fieldset
          className="mt-2 flex flex-wrap gap-2"
          aria-label="表示するステータス"
        >
          {displayedStatuses.map((status) => (
            <StatusChip
              key={status}
              status={status}
              isActive={value.has(status)}
              count={counts?.[status]}
              onToggle={() => toggle(status)}
            />
          ))}
        </fieldset>
      </details>

      {isAllOff && (
        <div
          role="status"
          className="mt-2 px-3 py-2 bg-orange-50 dark:bg-orange-800/30 text-orange-700 dark:text-orange-200 text-xs rounded-md"
        >
          すべてのステータスが非表示です。少なくとも 1 つのステータスを選択してください。
        </div>
      )}
    </div>
  );
}
