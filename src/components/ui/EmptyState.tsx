import React from 'react';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon = '📋', title, description, action }) => (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <span className="text-4xl mb-3">{icon}</span>
    <h3 className="text-lg font-medium text-gray-600 dark:text-gray-400 mb-1">{title}</h3>
    {description && (
      <p className="text-sm text-gray-400 dark:text-gray-500 max-w-xs">{description}</p>
    )}
    {action && (
      <button
        onClick={action.onClick}
        className="mt-4 btn-primary text-sm"
      >
        {action.label}
      </button>
    )}
  </div>
);
