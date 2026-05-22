import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
  label?: string;
  inline?: boolean;
  /**
   * true の場合、Spinner の横に可視テキストとして label を表示します。
   * false の場合、スクリーンリーダー用の非可視テキストとして label を扱います。
   * デフォルトは false です。
   */
  showLabel?: boolean;
}

const SIZE_PX: Record<SpinnerSize, number> = {
  sm: 16,
  md: 20,
  lg: 28,
};

/**
 * 共通スピナー。色は currentColor（呼び出し側 `text-blue-500` 等で制御）。
 * `role="status"` + `aria-label` で SR 対応。
 * `showLabel` を true にすると、アイコンの横に可視状態でラベルを表示します。
 */
export function Spinner(props: SpinnerProps): JSX.Element {
  const {
    size = 'md',
    className,
    label = '読み込み中',
    inline = false,
    showLabel = false,
  } = props;
  const px = SIZE_PX[size];

  return (
    <span
      role="status"
      aria-label={label}
      className={cn(inline ? 'inline-flex' : 'flex', 'items-center justify-center gap-2', className)}
    >
      <Loader2
        size={px}
        className="motion-safe:animate-spin"
        aria-hidden="true"
      />
      {showLabel ? (
        <span>{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </span>
  );
}

export default Spinner;
