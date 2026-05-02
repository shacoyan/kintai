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
  neutral: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-100',
  primary: 'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200',
  success: 'bg-success-50 text-success-700 dark:bg-success-900/40 dark:text-success-200',
  warning: 'bg-warning-50 text-warning-700 dark:bg-warning-900/40 dark:text-warning-100',
  danger:  'bg-danger-50 text-danger-700 dark:bg-danger-900/40 dark:text-danger-100',
  info:    'bg-info-50 text-info-700 dark:bg-info-900/40 dark:text-info-200',
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
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold',
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
