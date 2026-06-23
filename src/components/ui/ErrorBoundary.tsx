import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { CHUNK_ERR, CHUNK_RELOAD_FLAG } from '../../lib/lazyWithRetry';
import { Card } from './Card';
import { Button } from './Button';
import { Heading } from './Heading';

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

    // chunk 読み込み失敗(古いデプロイのキャッシュ等)は 1 回だけ自動 reload で復旧。
    // 通常の render エラーは reload せず、reset() による in-app 復旧に委ねる。
    if (CHUNK_ERR.test(error.message)) {
      try {
        if (sessionStorage.getItem(CHUNK_RELOAD_FLAG) !== '1') {
          sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
          window.location.reload();
        }
      } catch {
        /* ignore */
      }
    }
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
      <div className="min-h-[60vh] w-full flex items-center justify-center p-4 bg-stone-50 dark:bg-stone-900">
        <Card padding="lg" className="w-full max-w-md text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-50 dark:bg-red-800/30 mb-4">
            <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" aria-hidden="true" />
          </div>
          <Heading level={3} as="h2" className="mb-2">
            予期しないエラーが発生しました
          </Heading>
          <p className="text-sm text-stone-600 dark:text-stone-300 mb-6">
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
            <details className="mt-6 text-left text-xs text-stone-500 dark:text-stone-300">
              <summary className="cursor-pointer">エラー詳細 (dev)</summary>
              <pre className="mt-2 p-2 bg-stone-100 dark:bg-stone-800 rounded-md overflow-auto whitespace-pre-wrap break-words">
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
