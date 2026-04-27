import { Spinner } from './Spinner';
import { cn } from '../../lib/cn';

export type PageLoaderVariant = 'page' | 'screen';

export interface PageLoaderProps {
  label?: string;
  variant?: PageLoaderVariant;
  className?: string;
}

/**
 * ページ / スクリーン全体ローディング。Suspense fallback / 認証待ち等に使用。
 * `screen` はフルスクリーン + dark 対応背景。`aria-live="polite"` でアナウンス。
 */
export function PageLoader(props: PageLoaderProps): JSX.Element {
  const { label = '読み込み中…', variant = 'page', className } = props;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        'flex flex-col items-center justify-center gap-3',
        variant === 'screen'
          ? 'min-h-screen w-full bg-neutral-50 dark:bg-neutral-900'
          : 'py-12',
        className,
      )}
    >
      <Spinner size="lg" label={label} className="text-primary-600 dark:text-primary-400" />
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{label}</p>
    </div>
  );
}

export default PageLoader;
