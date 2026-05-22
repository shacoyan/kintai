import * as React from 'react';
import { cn } from '../../lib/cn';

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  withDot?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

const toneMap: Record<BadgeTone, string> = {
  neutral: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  primary: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  warning: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  danger:  'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  info:    'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};

export function Badge(props: BadgeProps): JSX.Element {
  const {
    tone = 'neutral',
    withDot = false,
    icon,
    className,
    children,
    ...rest
  } = props;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium tabular-nums',
        toneMap[tone],
        className,
      )}
      {...rest}
    >
      {withDot ? (
        <span
          aria-hidden="true"
          className="w-1.5 h-1.5 rounded-full bg-current opacity-80"
        />
      ) : null}
      {icon ? (
        <span aria-hidden="true" className="inline-flex items-center [&_svg]:w-3 [&_svg]:h-3">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
    </span>
  );
}
