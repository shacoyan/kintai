import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorBanner({ message, onRetry, className = '' }: ErrorBannerProps) {
  return (
    <div role="alert" className={`flex items-start gap-3 bg-rose-50 dark:bg-rose-900/20 border-l-4 border-rose-500 rounded p-4 ${className}`}>
      <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
      <div className="flex-1 text-rose-800 dark:text-rose-200 text-sm">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-300 hover:text-rose-900 dark:hover:text-rose-100 text-sm font-medium">
          <RefreshCw className="w-4 h-4" />再試行
        </button>
      )}
    </div>
  );
}
