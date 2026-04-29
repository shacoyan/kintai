// FILE: components/Tenant/TenantSelector.tsx
import React from 'react';
import { Building2, UserPlus } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { Heading } from '../ui';
import type { TenantWithRole } from '../../types';

interface TenantSelectorProps {
  tenants: TenantWithRole[];
  onSelect: (tenant: TenantWithRole) => void;
  onCreateNew: () => void;
  onJoin: () => void;
}

const TenantSelector: React.FC<TenantSelectorProps> = ({ tenants, onSelect, onCreateNew, onJoin }) => {
  const roleColors: Record<string, string> = {
    owner: 'bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-200',
    manager: 'bg-success-100 text-success-800 dark:bg-success-900 dark:text-success-200',
    staff: 'bg-neutral-100 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-300',
  };

  const roleLabels: Record<string, string> = {
    owner: 'オーナー',
    manager: '店長',
    staff: 'スタッフ',
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-900 p-4">
      <div className="w-full max-w-lg space-y-8">
        <div className="text-center">
          <Heading level={1}>ワークスペースを選択</Heading>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">参加するワークスペースを選んでください</p>
        </div>

        {tenants.length > 0 ? (
          <div className="space-y-3">
            {tenants.map((tenant) => (
              <button
                key={tenant.id}
                onClick={() => onSelect(tenant)}
                className="w-full flex items-center justify-between p-4 bg-white dark:bg-neutral-800 shadow-sm rounded-lg border border-neutral-200 dark:border-neutral-700 hover:border-primary-300 dark:hover:border-primary-600 motion-safe:transition-colors duration-120 ease-out-expo text-left focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <div className="min-w-0">
                  <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100 truncate">{tenant.name}</p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-300 truncate">{tenant.display_name}</p>
                </div>
                <span className={`ml-4 px-3 py-1 text-xs font-medium rounded-full ${roleColors[tenant.role] || roleColors.staff}`}>
                  {roleLabels[tenant.role] || roleLabels.staff}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Building2 className="w-12 h-12 text-neutral-400" />}
            title="参加中のワークスペースがありません"
            description="新しく作成するか、招待コードで既存のワークスペースに参加してください"
          />
        )}

        <div className="space-y-3 pt-4 border-t border-neutral-200 dark:border-neutral-700">
          <Button
            onClick={onCreateNew}
            variant="primary"
            fullWidth
            iconLeft={<Building2 className="w-4 h-4" />}
          >
            新しいワークスペースを作成
          </Button>
          <Button
            onClick={onJoin}
            variant="secondary"
            fullWidth
            iconLeft={<UserPlus className="w-4 h-4" />}
          >
            招待コードで参加
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TenantSelector;
