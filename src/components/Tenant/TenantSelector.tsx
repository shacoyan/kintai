// FILE: components/Tenant/TenantSelector.tsx
import React from 'react';
import { Building2, UserPlus } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import type { TenantWithRole } from '../../types';

interface TenantSelectorProps {
  tenants: TenantWithRole[];
  onSelect: (tenant: TenantWithRole) => void;
  onCreateNew: () => void;
  onJoin: () => void;
}

const TenantSelector: React.FC<TenantSelectorProps> = ({ tenants, onSelect, onCreateNew, onJoin }) => {
  const roleColors: Record<string, string> = {
    owner: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    manager: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    staff: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  };

  const roleLabels: Record<string, string> = {
    owner: 'オーナー',
    manager: '店長',
    staff: 'スタッフ',
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="w-full max-w-lg space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">ワークスペースを選択</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">参加するワークスペースを選んでください</p>
        </div>

        {tenants.length > 0 ? (
          <div className="space-y-3">
            {tenants.map((tenant) => (
              <button
                key={tenant.id}
                onClick={() => onSelect(tenant)}
                className="w-full flex items-center justify-between p-4 bg-white dark:bg-gray-800 shadow-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 transition-all duration-200 text-left focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <div className="min-w-0">
                  <p className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">{tenant.name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{tenant.display_name}</p>
                </div>
                <span className={`ml-4 px-3 py-1 text-xs font-medium rounded-full ${roleColors[tenant.role] || roleColors.staff}`}>
                  {roleLabels[tenant.role] || roleLabels.staff}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Building2 className="w-12 h-12 text-slate-400" />}
            title="参加中のワークスペースがありません"
            description="新しく作成するか、招待コードで既存のワークスペースに参加してください"
          />
        )}

        <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onCreateNew}
            className="w-full btn-primary flex items-center justify-center"
          >
            <Building2 className="w-4 h-4 mr-2" />
            新しいワークスペースを作成
          </button>
          <button
            onClick={onJoin}
            className="w-full btn-secondary flex items-center justify-center"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            招待コードで参加
          </button>
        </div>
      </div>
    </div>
  );
};

export default TenantSelector;
