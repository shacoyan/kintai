import { useCallback } from 'react';
import type { StatusFilterValue } from './unifiedShiftTypes';
import {
  ALL_STATUS_FILTER_VALUES,
  STATUS_FILTER_LABELS,
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

const SHORT_LABEL: Partial<Record<StatusFilterValue, string>> = {
  pending_preference: '申請中',
  unavailable_preference: '出勤不可',
  tentative: '仮承認',
  approved: '本承認',
};

/** status ごとの ON 時のスタイル (bg / border / text / dot) */
const STATUS_ON_STYLES: Partial<Record<StatusFilterValue, {
  chip: string;
  dot: string;
  count: string;
}>> = {
  pending_preference: {
    chip: 'bg-blue-50 border-blue-600 text-blue-700 dark:bg-blue-900/30 dark:border-blue-400 dark:text-blue-300',
    dot: 'bg-blue-600 dark:bg-blue-400',
    count: 'text-blue-700 dark:text-blue-300',
  },
  unavailable_preference: {
    chip: 'bg-red-50 border-red-600 text-red-700 dark:bg-red-900/30 dark:border-red-400 dark:text-red-300',
    dot: 'bg-red-600 dark:bg-red-400',
    count: 'text-red-700 dark:text-red-300',
  },
  tentative: {
    chip: 'bg-orange-50 border-orange-500 text-orange-700 dark:bg-orange-900/30 dark:border-orange-400 dark:text-orange-300',
    dot: 'bg-orange-500 dark:bg-orange-400',
    count: 'text-orange-700 dark:text-orange-300',
  },
  approved: {
    chip: 'bg-emerald-50 border-emerald-600 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-400 dark:text-emerald-300',
    dot: 'bg-emerald-600 dark:bg-emerald-400',
    count: 'text-emerald-700 dark:text-emerald-300',
  },
};

/** デフォルト (modified/rejected/cancelled 用) */
const STATUS_ON_DEFAULT = {
  chip: 'bg-stone-100 border-stone-400 text-stone-900 dark:bg-stone-700 dark:border-stone-500 dark:text-stone-100',
  dot: 'bg-stone-500 dark:bg-stone-400',
  count: 'text-stone-700 dark:text-stone-300',
};

/** OFF 時 (共通) */
const STATUS_OFF = {
  chip: 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50 dark:bg-stone-800 dark:border-stone-700 dark:text-stone-300',
  dot: 'bg-stone-400 dark:bg-stone-500',
  count: 'text-stone-500 dark:text-stone-400',
};

const CHIP_BASE_CLASS =
  'inline-flex items-center gap-1.5 rounded-full border h-[26px] min-h-[44px] sm:min-h-0 px-[9px] text-xs font-medium motion-safe:transition-colors duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

/** 「自分のみ」チップの ON/OFF スタイル (ステータス系の色とは衝突しない violet 系) */
const MINE_ONLY_ON_STYLE = {
  chip: 'bg-violet-50 border-violet-600 text-violet-700 dark:bg-violet-900/30 dark:border-violet-400 dark:text-violet-300',
  dot: 'bg-violet-600 dark:bg-violet-400',
};
const MINE_ONLY_OFF_STYLE = {
  chip: 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50 dark:bg-stone-800 dark:border-stone-700 dark:text-stone-300',
  dot: 'bg-stone-400 dark:bg-stone-500',
};

export interface ShiftStatusFilterProps {
  value: Set<StatusFilterValue>;
  onChange: (next: Set<StatusFilterValue>) => void;
  /**
   * true: pending_preference チェックボックスを表示 (manager 表示時)
   * false (default): 非表示
   */
  showPreferenceStatus?: boolean;
  /** chip 右端に件数を出す (オプション)。未指定は従来通り件数なし */
  counts?: Partial<Record<StatusFilterValue, number>>;
  /**
   * 「自分のみ」チップを表示するか。呼び出し側で
   * canManageTenant && currentUserId != null を判定して渡す。
   * false / 未指定なら「自分のみ」チップ・バナーは一切描画しない。
   */
  showMineOnlyFilter?: boolean;
  /** 「自分のみ」表示トグルの現在値 */
  mineOnly?: boolean;
  /** 「自分のみ」表示トグル変更ハンドラ */
  onMineOnlyChange?: (next: boolean) => void;
}

function MineOnlyChip({
  isActive,
  onToggle,
}: {
  isActive: boolean;
  onToggle: () => void;
}) {
  const style = isActive ? MINE_ONLY_ON_STYLE : MINE_ONLY_OFF_STYLE;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isActive}
      aria-label="自分のみ表示"
      onClick={onToggle}
      className={`${CHIP_BASE_CLASS} ${style.chip}`}
    >
      <span
        aria-hidden="true"
        className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`}
      />
      <span>自分のみ</span>
    </button>
  );
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
  const onStyle = STATUS_ON_STYLES[status] ?? STATUS_ON_DEFAULT;
  const style = isActive ? onStyle : STATUS_OFF;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isActive}
      aria-label={STATUS_FILTER_LABELS[status]}
      onClick={onToggle}
      className={`${CHIP_BASE_CLASS} ${style.chip}`}
    >
      {/* status dot — 左端 */}
      <span
        aria-hidden="true"
        className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`}
      />
      <span>{SHORT_LABEL[status] ?? STATUS_FILTER_LABELS[status]}</span>
      {typeof count === 'number' && (
        <span className={`tabular-nums text-[10px] font-semibold ml-0.5 ${style.count}`}>
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * シフトカレンダーのステータスフィルタ (controlled component)
 * - PC: 横並び pill チェックボックス列
 * - SP: 横並び pill チェックボックス列（常時表示・flex-wrap で折り返し）
 * - 全 OFF 時はフィルタなしとして扱う
 * - localStorage 永続化は親が readStatusFilter / writeStatusFilter を介して行う
 */
export function ShiftStatusFilter({
  value,
  onChange,
  showPreferenceStatus = false,
  counts,
  showMineOnlyFilter = false,
  mineOnly = false,
  onMineOnlyChange,
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

  const toggleMineOnly = useCallback(() => {
    onMineOnlyChange?.(!mineOnly);
  }, [mineOnly, onMineOnlyChange]);

  // showMineOnlyFilter は呼び出し側が canManageTenant && currentUserId != null を
  // 判定して渡す前提だが、onMineOnlyChange が無ければ描画しない (安全側)。
  const renderMineOnly = showMineOnlyFilter && !!onMineOnlyChange;

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
      (showPreferenceStatus || (s !== 'pending_preference' && s !== 'unavailable_preference'))
  );

  return (
    <div>
      {/* PC: 横並び */}
      <div className="hidden sm:flex flex-wrap items-center gap-2">
        <fieldset
          className="flex flex-wrap gap-2"
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

        {renderMineOnly && (
          // FIX-3: 区切り線とチップを 1 要素にまとめ、行送り時も常に同じ行に留める
          // (区切り線だけが前行末に取り残されチップが孤立するレイアウト崩れを防ぐ)。
          <div className="inline-flex items-center gap-2 flex-nowrap shrink-0">
            {/* ステータス軸とメンバー軸を視覚的に区切る */}
            <span
              aria-hidden="true"
              className="w-px h-4 bg-stone-300 dark:bg-stone-600 shrink-0"
            />
            <fieldset
              className="flex flex-wrap gap-2"
              aria-label="表示するメンバー"
            >
              <MineOnlyChip isActive={mineOnly} onToggle={toggleMineOnly} />
            </fieldset>
          </div>
        )}
      </div>

      {/* SP: 常時表示 */}
      <div className="sm:hidden flex flex-wrap items-center gap-2">
        <fieldset
          className="flex flex-wrap gap-2"
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

        {renderMineOnly && (
          <>
            <span
              aria-hidden="true"
              className="w-px h-4 bg-stone-300 dark:bg-stone-600"
            />
            <fieldset
              className="flex flex-wrap gap-2"
              aria-label="表示するメンバー"
            >
              <MineOnlyChip isActive={mineOnly} onToggle={toggleMineOnly} />
            </fieldset>
          </>
        )}
      </div>
    </div>
  );
}
