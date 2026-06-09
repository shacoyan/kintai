import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { PeriodPreset } from '../../../lib/sales/types';
import { MOTION } from '../../../lib/sales/motion';

const cn = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

const PERIOD_TABS: { key: PeriodPreset; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'week', label: '週' },
  { key: 'month', label: '今月' },
  { key: 'quarter', label: '四半期' },
  { key: 'year', label: '年間' },
];

export interface PeriodSelectorProps {
  period: PeriodPreset;
  onPeriodChange: (p: PeriodPreset) => void;
  weekIndex: number;
  onWeekIndexChange: (n: number) => void;
  availableWeeks: number;
  quarterIndex: number;
  onQuarterIndexChange: (n: number) => void;
  ariaLabel?: string;
  className?: string;
}

const tabBaseClass =
  `px-4 py-2 text-sm font-medium rounded-lg ${MOTION.fast} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1`;

const weekTabBaseClass =
  `px-3 py-1.5 text-sm font-medium rounded-lg ${MOTION.fast} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1`;

const selectedClass = 'bg-primary text-white';
const unselectedClass = 'bg-surface-subtle text-text-muted hover:bg-surface-muted';

/**
 * WAI-ARIA tabs パターンの roving Arrow ナビゲーション共通ハンドラ。
 * ArrowRight/Down → 次、ArrowLeft/Up → 前（wrap）、Home → 先頭、End → 末尾。
 * 該当キー時はフォーカス移動（focusByIndex）と同時に選択（selectByIndex）も発火する
 * （automatic activation = 見本 square-dashboard Tabs.tsx 準拠）。
 * 上記以外のキー（Tab/Enter/Space 等）はネイティブ挙動を維持。
 */
function handleTabKeyDown(
  e: KeyboardEvent<HTMLButtonElement>,
  index: number,
  count: number,
  focusByIndex: (i: number) => void,
  selectByIndex: (i: number) => void,
) {
  if (count <= 0) return;
  let next: number;
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      next = (index + 1) % count;
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      next = (index - 1 + count) % count;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = count - 1;
      break;
    default:
      return;
  }
  e.preventDefault();
  focusByIndex(next);
  selectByIndex(next);
}

export function PeriodSelector({
  period,
  onPeriodChange,
  weekIndex,
  onWeekIndexChange,
  availableWeeks,
  quarterIndex,
  onQuarterIndexChange,
  ariaLabel = '期間選択',
  className,
}: PeriodSelectorProps) {
  const periodRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const weekRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const quarterRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const weekValues = Array.from({ length: Math.max(availableWeeks, 0) }, (_, i) => i + 1);
  const quarterValues = [1, 2, 3, 4];

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={ariaLabel}>
        {PERIOD_TABS.map((tab, index) => {
          const isSelected = period === tab.key;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                periodRefs.current[tab.key] = el;
              }}
              type="button"
              role="tab"
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onPeriodChange(tab.key)}
              onKeyDown={(e) =>
                handleTabKeyDown(
                  e,
                  index,
                  PERIOD_TABS.length,
                  (i) => periodRefs.current[PERIOD_TABS[i].key]?.focus(),
                  (i) => onPeriodChange(PERIOD_TABS[i].key),
                )
              }
              className={cn(tabBaseClass, isSelected ? selectedClass : unselectedClass)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {period === 'week' && availableWeeks > 0 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="週選択">
          {weekValues.map((n, index) => {
            const isSelected = weekIndex === n;
            return (
              <button
                key={n}
                ref={(el) => {
                  weekRefs.current[String(n)] = el;
                }}
                type="button"
                role="tab"
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => onWeekIndexChange(n)}
                onKeyDown={(e) =>
                  handleTabKeyDown(
                    e,
                    index,
                    weekValues.length,
                    (i) => weekRefs.current[String(weekValues[i])]?.focus(),
                    (i) => onWeekIndexChange(weekValues[i]),
                  )
                }
                className={cn(weekTabBaseClass, isSelected ? selectedClass : unselectedClass)}
              >
                第{n}週
              </button>
            );
          })}
        </div>
      )}

      {period === 'quarter' && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="四半期選択">
          {quarterValues.map((n, index) => {
            const isSelected = quarterIndex === n;
            return (
              <button
                key={n}
                ref={(el) => {
                  quarterRefs.current[String(n)] = el;
                }}
                type="button"
                role="tab"
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => onQuarterIndexChange(n)}
                onKeyDown={(e) =>
                  handleTabKeyDown(
                    e,
                    index,
                    quarterValues.length,
                    (i) => quarterRefs.current[String(quarterValues[i])]?.focus(),
                    (i) => onQuarterIndexChange(quarterValues[i]),
                  )
                }
                className={cn(weekTabBaseClass, isSelected ? selectedClass : unselectedClass)}
              >
                Q{n}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PeriodSelector;
