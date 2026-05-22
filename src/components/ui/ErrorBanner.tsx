import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './Button';

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
        <Button
          variant="tertiary"
          size="sm"
          onClick={onRetry}
          iconLeft={<RefreshCw className="w-4 h-4" />}
          className="ml-auto text-red-600 dark:text-red-300 hover:text-red-700 dark:hover:text-red-100 hover:bg-red-100/50 dark:hover:bg-red-900/30"
        >
          再試行
        </Button>
      )}
    </div>
  );
}
