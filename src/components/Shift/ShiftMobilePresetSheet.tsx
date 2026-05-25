import type { ShiftPreset } from '../../types';
import { BottomSheet } from '../ui';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  presets: ShiftPreset[];
  targetDate: string;
  onSelect: (preset: ShiftPreset) => void | Promise<void>;
  disabled?: boolean;
}

function formatHHmm(time: string): string {
  return time.slice(0, 5);
}

export function ShiftMobilePresetSheet({
  isOpen,
  onClose,
  presets,
  targetDate,
  onSelect,
  disabled,
}: Props) {
  const handleSelect = async (preset: ShiftPreset) => {
    if (disabled) return;
    await onSelect(preset);
    onClose();
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={`${targetDate} のプリセット`}
    >
      {presets.length === 0 ? (
        <div className="rounded-md border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/60 p-4 text-center text-sm text-stone-500 dark:text-stone-400">
          プリセットが登録されていません
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {presets.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                onClick={() => void handleSelect(preset)}
                disabled={disabled}
                className="w-full rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-3 text-left hover:bg-stone-50 dark:hover:bg-stone-700/40 focus-ring disabled:cursor-not-allowed disabled:opacity-50 motion-safe:transition-colors duration-150"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
                    {preset.name}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-stone-700 dark:text-stone-200">
                    {formatHHmm(preset.start_time)}-{formatHHmm(preset.end_time)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  );
}
