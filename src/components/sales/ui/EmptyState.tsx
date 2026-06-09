import type { ReactNode } from 'react';

export type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  minHeight?: number | string;
  variant?: 'centered' | 'inline';
  tone?: 'neutral' | 'warning' | 'danger';
  role?: string;
  className?: string;
};

const defaultIcon = (
  <svg
    className="w-12 h-12"
    stroke="currentColor"
    strokeWidth={1.5}
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path d="M20 13V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6" />
    <path d="M4 13l3.5 3.5a2 2 0 0 0 1.414.586h6.172a2 2 0 0 0 1.414-.586L20 13" />
    <path d="M4 13v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </svg>
);

const defaultInlineIcon = (
  <svg
    className="w-5 h-5"
    stroke="currentColor"
    strokeWidth={1.5}
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path d="M20 13V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6" />
    <path d="M4 13l3.5 3.5a2 2 0 0 0 1.414.586h6.172a2 2 0 0 0 1.414-.586L20 13" />
    <path d="M4 13v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </svg>
);

const toneStyles: Record<string, string> = {
  neutral: 'bg-surface-subtle border-border text-text',
  warning: 'bg-warning-50 border-warning-300 text-warning-800',
  danger: 'bg-danger-50 border-danger-300 text-danger-800',
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  minHeight,
  variant = 'centered',
  tone = 'neutral',
  role: roleProp = 'status',
  className = '',
}: EmptyStateProps) {
  if (variant === 'inline') {
    const ariaLive = roleProp === 'alert' ? 'assertive' : 'polite';
    return (
      <div
        role={roleProp}
        aria-live={ariaLive}
        className={`flex items-start gap-3 rounded-md border p-4 ${toneStyles[tone] ?? toneStyles.neutral} ${className}`}
      >
        <div className="flex-shrink-0 mt-0.5" aria-hidden="true">
          {icon ?? defaultInlineIcon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium">{title}</p>
          {description && <p className="text-sm mt-1 opacity-90">{description}</p>}
        </div>
        {action && <div className="flex-shrink-0 ml-2">{action}</div>}
      </div>
    );
  }

  const ariaLive = roleProp === 'alert' ? 'assertive' : 'polite';
  const pyClass = minHeight != null ? 'py-6' : 'py-12';

  return (
    <div
      role={roleProp}
      aria-live={ariaLive}
      className={`flex flex-col items-center justify-center text-center gap-3 text-text-muted ${pyClass} ${className}`}
      style={minHeight != null ? { minHeight } : undefined}
    >
      <div className="text-text-subtle">{icon ?? defaultIcon}</div>
      <h3 className="text-base font-semibold text-text">{title}</h3>
      {description && <p className="text-sm">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
