import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Card } from './Card';
import { Button } from './Button';

export interface ErrorBoundaryFallbackProps {
  error: Error;
  reset: () => void;
}

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: (props: ErrorBoundaryFallbackProps) => React.ReactNode;
  scope?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React class ErrorBoundary。React tree 例外をキャッチして fallback UI を出す。
 * - `scope` はログ用ラベル（'app' / 'route' / 任意）
 * - 既定 fallback: Card + 再試行 / ホームへ + dev 環境のみ error 詳細
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const scope = this.props.scope ?? 'unknown';
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary][${scope}]`, error, info);
  }

  reset(): void {
    this.setState({ hasError: false, error: null });
  }

  render(): React.ReactNode {
    if (!this.state.hasError || !this.state.error) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback({ error: this.state.error, reset: this.reset });
    }

    const isDev = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
    const error = this.state.error;

    return (
      <div className="min-h-[60vh] w-full flex items-center justify-center p-4 bg-neutral-50 dark:bg-neutral-900">
        <Card padding="lg" className="w-full max-w-md text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-danger-100 dark:bg-danger-900/30 mb-4">
            <AlertTriangle className="h-6 w-6 text-danger-600 dark:text-danger-400" aria-hidden="true" />
          </div>
          <h2 className="text-heading-3 text-neutral-900 dark:text-neutral-100 mb-2">
            予期しないエラーが発生しました
          </h2>
          <p className="text-body-sm text-neutral-600 dark:text-neutral-300 mb-6">
            ページを再読込してください。問題が続く場合はサポートに連絡してください。
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Button variant="primary" onClick={this.reset}>
              再試行
            </Button>
            <Button variant="tertiary" onClick={() => window.location.assign('/')}>
              ホームへ
            </Button>
          </div>
          {isDev && (
            <details className="mt-6 text-left text-xs text-neutral-500 dark:text-neutral-400">
              <summary className="cursor-pointer">エラー詳細 (dev)</summary>
              <pre className="mt-2 p-2 bg-neutral-100 dark:bg-neutral-800 rounded overflow-auto whitespace-pre-wrap break-words">
                {error.message}
                {'\n\n'}
                {error.stack}
              </pre>
            </details>
          )}
        </Card>
      </div>
    );
  }
}

export default ErrorBoundary;
