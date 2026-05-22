import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorBanner({ message, onRetry, className = '' }: ErrorBannerProps) {
  return (
    <div role="alert" className={`flex items-start gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-red-800 dark:text-red-200 ${className}`}>
      <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
      <div className="flex-1 text-sm">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-300 dark:hover:text-red-100">
          <RefreshCw className="w-4 h-4" />再試行
        </button>
      )}
    </div>
  );
}
