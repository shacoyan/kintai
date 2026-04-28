import React from 'react';
import { Inbox } from 'lucide-react';
import { Button } from './Button';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    {icon ?? <Inbox className="w-12 h-12 text-neutral-400 dark:text-neutral-500" />}
    <h3 className="text-lg font-medium text-neutral-600 dark:text-neutral-400 mb-1">{title}</h3>
    {description && (
      <p className="text-sm text-neutral-400 dark:text-neutral-500 max-w-xs">{description}</p>
    )}
    {action && (
      <Button
        onClick={action.onClick}
        variant="primary"
        size="sm"
        className="mt-4"
      >
        {action.label}
      </Button>
    )}
  </div>
);
