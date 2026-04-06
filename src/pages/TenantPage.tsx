// FILE: pages/TenantPage.tsx
import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTenant } from '../hooks/useTenant';
import TenantSelector from '../components/Tenant/TenantSelector';
import CreateTenant from '../components/Tenant/CreateTenant';
import JoinTenant from '../components/Tenant/JoinTenant';
import type { Tenant, TenantWithRole } from '../types';

type PageState = 'select' | 'create' | 'join';

const TenantPage: React.FC = () => {
  const [pageState, setPageState] = useState<PageState>('select');
  const navigate = useNavigate();
  const { tenants, currentTenant, setCurrentTenant, fetchTenants, createTenant, joinTenant, loading, error } = useTenant();

  // テナント選択済みなら即ダッシュボードへ
  if (currentTenant) {
    return <Navigate to="/" replace />;
  }

  const handleSelect = (tenant: TenantWithRole) => {
    setCurrentTenant(tenant);
    navigate('/', { replace: true });
  };

  const handleTenantCreated = async (tenant: Tenant) => {
    await fetchTenants();
    setCurrentTenant(tenant);
    navigate('/', { replace: true });
  };

  const handleTenantJoined = async (tenant: Tenant) => {
    await fetchTenants();
    setCurrentTenant(tenant);
    navigate('/', { replace: true });
  };

  if (loading && pageState === 'select' && tenants.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center space-y-4">
          <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-sm text-gray-500">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error && pageState === 'select') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-md border border-gray-100 text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 mb-4">
            <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">エラーが発生しました</h2>
          <p className="text-sm text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => fetchTenants()}
            className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }

  switch (pageState) {
    case 'create':
      return (
        <CreateTenant
          onCreate={handleTenantCreated}
          onCancel={() => setPageState('select')}
          createTenant={createTenant}
        />
      );
    case 'join':
      return (
        <JoinTenant
          onJoin={handleTenantJoined}
          onCancel={() => setPageState('select')}
          joinTenant={joinTenant}
        />
      );
    case 'select':
    default:
      return (
        <TenantSelector
          tenants={tenants}
          onSelect={handleSelect}
          onCreateNew={() => setPageState('create')}
          onJoin={() => setPageState('join')}
        />
      );
  }
};

export default TenantPage;
