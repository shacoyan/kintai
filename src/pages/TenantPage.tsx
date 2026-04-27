import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTenant } from '../hooks/useTenant';
import TenantSelector from '../components/Tenant/TenantSelector';
import CreateTenant from '../components/Tenant/CreateTenant';
import JoinTenant from '../components/Tenant/JoinTenant';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { PageLoader } from '../components/ui';
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
    const fetched = await fetchTenants();
    const found = fetched.find(t => t.id === tenant.id);
    setCurrentTenant(found || tenant);
    navigate('/', { replace: true });
  };

  const handleTenantJoined = async (tenant: Tenant) => {
    const fetched = await fetchTenants();
    const found = fetched.find(t => t.id === tenant.id);
    setCurrentTenant(found || tenant);
    navigate('/', { replace: true });
  };

  if (loading && pageState === 'select' && tenants.length === 0) {
    return <PageLoader variant="screen" />;
  }

  if (error && pageState === 'select') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-900 p-4">
        <div className="w-full max-w-md space-y-4">
          <ErrorBanner message={error} onRetry={() => fetchTenants()} />
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
