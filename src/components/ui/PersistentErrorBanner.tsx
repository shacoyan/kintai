import { useState, type FC } from 'react';
import {
  AlertCircle,
  RefreshCw,
  X,
  ChevronDown,
  ChevronUp,
  Copy,
} from 'lucide-react';
import { Spinner } from './Spinner';
import type { PersistentError } from '../../contexts/PersistentErrorContext';

interface PersistentErrorBannerProps {
  error: PersistentError;
  onDismiss: (id: string) => void;
  onRetry: (id: string) => Promise<void>;
}

export const PersistentErrorBanner: FC<PersistentErrorBannerProps> = ({
  error,
  onDismiss,
  onRetry,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const displayTitle =
    error.title ?? error.operation ?? 'エラーが発生しました';

  const handleCopy = async () => {
    const text = JSON.stringify(
      {
        operation: error.operation,
        message: error.message,
        errorCode: error.errorCode,
        occurredAt: error.occurredAt,
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 古いブラウザ用フォールバック
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
      } catch {
        // 失敗時は無視
      }
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const occurredTime = new Date(error.occurredAt).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const isCritical = error.severity === 'critical';

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={`rounded border-l-4 p-4 shadow-sm ${
        isCritical
          ? 'border-l-danger-500 bg-danger-50 dark:bg-danger-900/20'
          : 'border-l-warning-500 bg-warning-50 dark:bg-warning-900/20'
      }`}
    >
      <div className="flex items-start gap-3">
        <AlertCircle
          aria-hidden="true"
          className={`mt-0.5 h-5 w-5 flex-shrink-0 ${
            isCritical ? 'text-danger-500' : 'text-warning-500'
          }`}
        />
        <div className="min-w-0 flex-1">
          {/* タイトル行 */}
          <div className="flex items-center">
            <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {displayTitle}
            </h4>
            {error.count >= 2 && (
              <span className="ml-2 rounded bg-danger-100 px-2 py-0.5 text-xs font-medium text-danger-700 dark:bg-danger-800 dark:text-danger-300">
                ×{error.count}
              </span>
            )}
          </div>

          {/* メッセージ本文 (短縮禁止) */}
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-700 dark:text-neutral-300">
            {error.message}
          </p>

          {/* 再試行複数回失敗時の訴求 */}
          {error.retryAttempts >= 3 && (
            <p className="mt-2 text-sm font-medium text-danger-600 dark:text-danger-400">
              再試行が複数回失敗しています。サポートに連絡してください
            </p>
          )}

          {/* アクションボタン群 */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {error.retry && (
              <button
                type="button"
                onClick={() => {
                  void onRetry(error.id);
                }}
                disabled={error.isRetrying}
                className="inline-flex items-center gap-1.5 rounded bg-danger-100 px-3 py-1 text-xs font-medium text-danger-700 hover:bg-danger-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-danger-800 dark:text-danger-300 dark:hover:bg-danger-700"
              >
                {error.isRetrying ? (
                  <Spinner size="sm" />
                ) : (
                  <RefreshCw aria-hidden="true" className="h-3 w-3" />
                )}
                再試行
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsOpen((prev) => !prev)}
              aria-expanded={isOpen}
              className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              詳細を見る
              {isOpen ? (
                <ChevronUp aria-hidden="true" className="h-3 w-3" />
              ) : (
                <ChevronDown aria-hidden="true" className="h-3 w-3" />
              )}
            </button>
          </div>

          {/* Accordion 詳細 */}
          {isOpen && (
            <div className="mt-3 rounded bg-neutral-50 p-3 text-xs dark:bg-neutral-800 space-y-1">
              {error.errorCode && (
                <p>
                  <span className="font-medium text-neutral-600 dark:text-neutral-400">
                    エラーコード:
                  </span>{' '}
                  <span className="text-neutral-800 dark:text-neutral-200">{error.errorCode}</span>
                </p>
              )}
              {error.operation && (
                <p>
                  <span className="font-medium text-neutral-600 dark:text-neutral-400">
                    操作:
                  </span>{' '}
                  <span className="text-neutral-800 dark:text-neutral-200">{error.operation}</span>
                </p>
              )}
              <p>
                <span className="font-medium text-neutral-600 dark:text-neutral-400">
                  発生時刻:
                </span>{' '}
                <span className="text-neutral-800 dark:text-neutral-200">{occurredTime}</span>
              </p>
              <p className="whitespace-pre-wrap break-words">
                <span className="font-medium text-neutral-600 dark:text-neutral-400">
                  メッセージ:
                </span>{' '}
                <span className="text-neutral-800 dark:text-neutral-200">{error.message}</span>
              </p>
              {error.detail && (
                <p className="whitespace-pre-wrap break-words">
                  <span className="font-medium text-neutral-600 dark:text-neutral-400">
                    詳細:
                  </span>{' '}
                  <span className="text-neutral-800 dark:text-neutral-200">{error.detail}</span>
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  void handleCopy();
                }}
                className="mt-2 inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
              >
                <Copy aria-hidden="true" className="h-3 w-3" />
                {copied ? 'コピーしました' : 'コピー'}
              </button>
            </div>
          )}
        </div>

        {/* dismiss ボタン */}
        <button
          type="button"
          onClick={() => onDismiss(error.id)}
          aria-label="エラーバナーを閉じる"
          className="flex-shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
