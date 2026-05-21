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
  pending_preference: 'bg-warning-100 ring-2 ring-warning-500 text-warning-800 dark:bg-warning-900/40 dark:ring-warning-400 dark:text-warning-300',
  tentative: 'bg-info-100 ring-2 ring-info-500 text-info-800 dark:bg-info-900/40 dark:ring-info-400 dark:text-info-300',
  approved: 'bg-success-100 ring-2 ring-success-500 text-success-800 dark:bg-success-900/40 dark:ring-success-400 dark:text-success-300',
  modified: 'bg-primary-100 ring-2 ring-primary-500 text-primary-800 dark:bg-primary-900/40 dark:ring-primary-400 dark:text-primary-300',
  rejected: 'bg-danger-100 ring-2 ring-danger-500 text-danger-800 dark:bg-danger-900/40 dark:ring-danger-400 dark:text-danger-300',
  cancelled: 'bg-neutral-200 ring-2 ring-neutral-500 text-neutral-800 dark:bg-neutral-700 dark:ring-neutral-400 dark:text-neutral-100',
};

const CHIP_OFF_CLASS =
  'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 ring-1 ring-transparent';

interface ShiftStatusFilterProps {
  value: Set<StatusFilterValue>;
  onChange: (next: Set<StatusFilterValue>) => void;
  /**
   * true: pending_preference チェックボックスを表示 (manager 表示時)
   * false (default): 非表示
   */
  showPreferenceStatus?: boolean;
}

function StatusChip({
  status,
  isActive,
  onToggle,
}: {
  status: StatusFilterValue;
  isActive: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isActive}
      aria-label={STATUS_FILTER_LABELS[status]}
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium motion-safe:transition-colors duration-120 ease-out-expo cursor-pointer select-none ${
        isActive ? STATUS_CHIP_ON_CLASS[status] : CHIP_OFF_CLASS
      }`}
    >
      <span className={`inline-block w-2 h-2 rounded-full ${STATUS_FILTER_DOT_CLASS[status]}`} />
      <span>{STATUS_FILTER_LABELS[status]}</span>
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

  const displayedStatuses = ALL_STATUS_FILTER_VALUES.filter(
    (s) => showPreferenceStatus || s !== 'pending_preference'
  );

  const activeStatusLabels = displayedStatuses
    .filter((s) => value.has(s))
    .map((s) => STATUS_FILTER_LABELS[s]);

  const isAllOff = displayedStatuses.length > 0 && activeStatusLabels.length === 0;
  const summaryText =
    activeStatusLabels.length > 0 ? activeStatusLabels.join(', ') : 'なし';

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
            onToggle={() => toggle(status)}
          />
        ))}
      </fieldset>

      {/* SP: collapsible */}
      <details className="sm:hidden">
        <summary className="cursor-pointer text-sm font-medium text-neutral-700 dark:text-neutral-300 select-none px-1 py-1">
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
              onToggle={() => toggle(status)}
            />
          ))}
        </fieldset>
      </details>

      {isAllOff && (
        <div
          role="status"
          className="mt-2 px-3 py-2 bg-warning-50 dark:bg-warning-900/30 text-warning-800 dark:text-warning-300 text-xs rounded"
        >
          すべてのステータスが非表示です。少なくとも 1 つのステータスを選択してください。
        </div>
      )}
    </div>
  );
}
