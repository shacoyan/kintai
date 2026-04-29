import React from 'react';
import { Inbox } from 'lucide-react';
import { Button } from './Button';

export type EmptyStateSize = 'sm' | 'md' | 'lg';
export type EmptyStateTone = 'neutral' | 'info' | 'warning';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  iconRight?: React.ReactNode;
  variant?: 'primary' | 'tertiary';
}

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  size?: EmptyStateSize;
  tone?: EmptyStateTone;
  className?: string;
  'data-testid'?: string;
}

const cloneIconWithAriaHidden = (icon: React.ReactNode): React.ReactNode => {
  if (React.isValidElement(icon)) {
    return React.cloneElement(icon as React.ReactElement<Record<string, unknown>>, { 'aria-hidden': true });
  }
  return icon;
};

const renderActionIcon = (icon: React.ReactNode) => {
  if (!icon) return null;
  if (React.isValidElement(icon)) {
    return React.cloneElement(icon as React.ReactElement<Record<string, unknown>>, { 'aria-hidden': true });
  }
  return icon;
};

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  size = 'md',
  tone = 'neutral',
  className,
  'data-testid': dataTestId,
}) => {
  const isNeutral = tone === 'neutral';

  const sizeClasses = isNeutral
    ? {
        sm: { container: 'py-6', icon: 'w-8 h-8', title: 'text-body-sm font-medium', desc: 'text-xs' },
        md: { container: 'py-12', icon: 'w-12 h-12', title: 'text-heading-3', desc: 'text-body-sm' },
        lg: { container: 'py-20', icon: 'w-16 h-16', title: 'text-heading-2', desc: 'text-body' },
      }[size]
    : { container: '', icon: '', title: '', desc: '' };

  if (isNeutral) {
    const renderedIcon = icon
      ? cloneIconWithAriaHidden(icon)
      : <Inbox className={`text-neutral-400 dark:text-neutral-500 ${sizeClasses.icon}`} aria-hidden={true} />;

    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex flex-col items-center justify-center ${sizeClasses.container} text-center${className ? ` ${className}` : ''}`}
        data-testid={dataTestId}
      >
        {renderedIcon}
        <h3 className={`${sizeClasses.title} text-neutral-600 dark:text-neutral-300 mb-1`}>{title}</h3>
        {description && (
          <p className={`${sizeClasses.desc} text-neutral-400 dark:text-neutral-500 max-w-xs`}>{description}</p>
        )}
        {action && (
          <Button onClick={action.onClick} variant={action.variant ?? 'primary'} size="sm" className="mt-4">
            {action.label}
          </Button>
        )}
      </div>
    );
  }

  const toneStyles = tone === 'info' ? {
    container: 'bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800',
    text: 'text-primary-800 dark:text-primary-300',
    action: 'bg-primary-100 dark:bg-primary-800/40 text-primary-700 dark:text-primary-200 hover:bg-primary-200 dark:hover:bg-primary-800/60',
    actionClass: 'flex-shrink-0 inline-flex items-center px-3 py-2 rounded-md text-sm font-medium motion-safe:transition-colors duration-120 ease-out-expo',
    actionIconWrap: 'ml-1.5',
  } : {
    container: 'bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800',
    text: 'text-warning-800 dark:text-warning-200',
    action: 'bg-primary-600 hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600 text-white',
    actionClass: 'flex-shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded text-xs font-semibold motion-safe:transition-colors duration-120 ease-out-expo',
    actionIconWrap: '',
  };

  return (
    <div
      role="status"
      className={`rounded-lg p-3 flex items-center justify-between ${toneStyles.container}${className ? ` ${className}` : ''}`}
      data-testid={dataTestId}
    >
      <div className="flex items-center gap-2">
        {icon && <span className="flex-shrink-0">{cloneIconWithAriaHidden(icon)}</span>}
        <div>
          <h3 className={`text-heading-3 ${toneStyles.text}`}>{title}</h3>
          {description && (
            <p className={`text-sm ${toneStyles.text}`}>{description}</p>
          )}
        </div>
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className={`${toneStyles.actionClass} ${toneStyles.action}`}
        >
          {action.label}
          {action.iconRight && (
            toneStyles.actionIconWrap
              ? <span className={toneStyles.actionIconWrap}>{renderActionIcon(action.iconRight)}</span>
              : renderActionIcon(action.iconRight)
          )}
        </button>
      )}
    </div>
  );
};
