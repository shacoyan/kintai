import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorBanner({ message, onRetry, className = '' }: ErrorBannerProps) {
  return (
    <div role="alert" className={`flex items-start gap-3 bg-danger-50 dark:bg-danger-900/20 border-l-4 border-danger-500 rounded p-4 ${className}`}>
      <AlertCircle className="w-5 h-5 text-danger-600 dark:text-danger-400 flex-shrink-0 mt-0.5" />
      <div className="flex-1 text-danger-800 dark:text-danger-200 text-sm">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex items-center gap-1 text-danger-700 dark:text-danger-300 hover:text-danger-900 dark:hover:text-danger-100 text-sm font-medium">
          <RefreshCw className="w-4 h-4" />再試行
        </button>
      )}
    </div>
  );
}
