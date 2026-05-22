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
        sm: { container: 'py-6', icon: 'w-8 h-8', title: 'text-sm font-medium', desc: 'text-xs' },
        md: { container: 'py-12', icon: 'w-12 h-12', title: 'text-base font-medium', desc: 'text-sm' },
        lg: { container: 'py-20', icon: 'w-16 h-16', title: 'text-lg font-semibold', desc: 'text-base' },
      }[size]
    : { container: '', icon: '', title: '', desc: '' };

  if (isNeutral) {
    const renderedIcon = icon
      ? cloneIconWithAriaHidden(icon)
      : <Inbox className={`${sizeClasses.icon} text-stone-400 dark:text-stone-500`} aria-hidden={true} />;

    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex flex-col items-center justify-center ${sizeClasses.container} text-center px-4${className ? ` ${className}` : ''}`}
        data-testid={dataTestId}
      >
        {renderedIcon}
        <h3 className={`${sizeClasses.title} text-stone-900 dark:text-stone-100 mt-4`}>{title}</h3>
        {description && (
          <p className={`${sizeClasses.desc} text-stone-500 dark:text-stone-400 mt-1 max-w-sm`}>{description}</p>
        )}
        {action && (
          <Button onClick={action.onClick} variant={action.variant ?? 'primary'} size="sm" className="mt-6">
            {action.label}
          </Button>
        )}
      </div>
    );
  }

  const toneStyles = tone === 'info' ? {
    container: 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800',
    text: 'text-blue-800 dark:text-blue-300',
    action: 'bg-blue-100 dark:bg-blue-800/40 text-blue-700 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-800/60',
    actionClass: 'flex-shrink-0 inline-flex items-center px-3 py-2 rounded-md text-sm font-medium motion-safe:transition-colors duration-120 ease-out-expo',
    actionIconWrap: 'ml-1.5',
  } : {
    container: 'bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800',
    text: 'text-orange-800 dark:text-orange-200',
    action: 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white',
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
