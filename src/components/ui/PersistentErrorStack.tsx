import type { FC } from 'react';
import { usePersistentError } from '../../contexts/PersistentErrorContext';
import { PersistentErrorBanner } from './PersistentErrorBanner';

export const PersistentErrorStack: FC = () => {
  const { errors, dismiss, dismissAll, retry } = usePersistentError();

  if (errors.length === 0) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="エラー通知"
      className="sticky top-14 md:top-16 z-20 w-full bg-transparent px-4 md:px-6 pt-2"
    >
      {/* ヘッダ行 (すべて閉じる) */}
      {errors.length >= 2 && (
        <div className="mb-2 flex items-center justify-end">
          <button
            type="button"
            onClick={dismissAll}
            className="text-xs text-stone-600 underline hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
          >
            すべて閉じる ({errors.length})
          </button>
        </div>
      )}

      {/* バナースタック */}
      <div className="space-y-2">
        {errors.map((error) => (
          <PersistentErrorBanner
            key={error.id}
            error={error}
            onDismiss={dismiss}
            onRetry={retry}
          />
        ))}
      </div>
    </div>
  );
};
