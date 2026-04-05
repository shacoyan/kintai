// FILE: components/Tenant/TenantSelector.tsx
import React from 'react';
import type { TenantWithRole } from '../../types';

interface TenantSelectorProps {
  tenants: TenantWithRole[];
  onSelect: (tenant: TenantWithRole) => void;
  onCreateNew: () => void;
  onJoin: () => void;
}

const TenantSelector: React.FC<TenantSelectorProps> = ({ tenants, onSelect, onCreateNew, onJoin }) => {
  const roleColors: Record<string, string> = {
    owner: 'bg-blue-100 text-blue-800',
    admin: 'bg-green-100 text-green-800',
    staff: 'bg-gray-100 text-gray-800',
  };

  const roleLabels: Record<string, string> = {
    owner: 'オーナー',
    admin: '管理者',
    staff: 'スタッフ',
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-lg space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">ワークスペースを選択</h1>
          <p className="mt-2 text-sm text-gray-600">参加するワークスペースを選んでください</p>
        </div>

        {tenants.length > 0 ? (
          <div className="space-y-3">
            {tenants.map((tenant) => (
              <button
                key={tenant.id}
                onClick={() => onSelect(tenant)}
                className="w-full flex items-center justify-between p-4 bg-white shadow-sm rounded-lg border border-gray-200 hover:shadow-md hover:border-blue-300 transition-all duration-200 text-left focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <div className="min-w-0">
                  <p className="text-base font-semibold text-gray-900 truncate">{tenant.name}</p>
                  <p className="text-sm text-gray-500 truncate">{tenant.display_name}</p>
                </div>
                <span className={`ml-4 px-3 py-1 text-xs font-medium rounded-full ${roleColors[tenant.role]}`}>
                  {roleLabels[tenant.role]}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 bg-white rounded-lg border border-gray-200">
            <p className="text-gray-500">所属しているワークスペースがありません</p>
          </div>
        )}

        <div className="space-y-3 pt-4 border-t border-gray-200">
          <button
            onClick={onCreateNew}
            className="w-full py-2.5 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            新しいワークスペースを作成
          </button>
          <button
            onClick={onJoin}
            className="w-full py-2.5 px-4 bg-white text-gray-700 font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
          >
            招待コードで参加
          </button>
        </div>
      </div>
    </div>
  );
};

export default TenantSelector;
