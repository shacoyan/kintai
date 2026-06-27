import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { MOTION } from '../../../lib/sales/motion';

const cn = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

export interface StoreSelectorOption {
  value: string;
  label: string;
}

export interface StoreSelectorProps {
  options: StoreSelectorOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
}

const tabBaseClass =
  `px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap ${MOTION.fast} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1`;

const selectedClass = 'bg-primary text-white';
const unselectedClass = 'bg-surface-subtle text-text-muted hover:bg-surface-muted';

/**
 * WAI-ARIA tabs パターンの roving Arrow ナビゲーション共通ハンドラ。
 * ArrowRight/Down → 次、ArrowLeft/Up → 前（wrap）、Home → 先頭、End → 末尾。
 * 該当キー時はフォーカス移動と同時に選択も発火（automatic activation）。
 * PeriodSelector と挙動を揃える。
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

/**
 * 店舗選択ボタン群（PeriodSelector のボタン型 UI を踏襲）。
 * options は動的（ALL + 許可店舗、最大8個程度）。選択中は bg-primary text-white。
 * 純表示コンポーネント：状態は持たず value/onChange のみ。値の意味（ALL_VALUE 等）は呼び出し側で解釈。
 * 店舗数が多くても破綻しないよう flex-wrap + overflow-x-auto で responsive 対応。
 */
export function StoreSelector({
  options,
  value,
  onChange,
  ariaLabel = '店舗選択',
  className,
}: StoreSelectorProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  return (
    <div
      className={cn('flex flex-wrap gap-2 overflow-x-auto', className)}
      role="tablist"
      aria-label={ariaLabel}
    >
      {options.map((opt, index) => {
        const isSelected = value === opt.value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[opt.value] = el;
            }}
            type="button"
            role="tab"
            aria-selected={isSelected}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) =>
              handleTabKeyDown(
                e,
                index,
                options.length,
                (i) => refs.current[options[i].value]?.focus(),
                (i) => onChange(options[i].value),
              )
            }
            className={cn(tabBaseClass, isSelected ? selectedClass : unselectedClass)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default StoreSelector;
