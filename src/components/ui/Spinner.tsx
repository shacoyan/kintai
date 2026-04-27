import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
  label?: string;
  inline?: boolean;
}

const SIZE_PX: Record<SpinnerSize, number> = {
  sm: 16,
  md: 20,
  lg: 28,
};

/**
 * 共通スピナー。色は currentColor（呼び出し側 `text-primary-500` 等で制御）。
 * `role="status"` + `aria-label` + `<span className="sr-only">` で SR 対応。
 */
export function Spinner(props: SpinnerProps): JSX.Element {
  const { size = 'md', className, label = '読み込み中', inline = false } = props;
  const px = SIZE_PX[size];
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(inline ? 'inline-flex' : 'flex', 'items-center justify-center', className)}
    >
      <Loader2
        size={px}
        className="motion-safe:animate-spin"
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export default Spinner;
