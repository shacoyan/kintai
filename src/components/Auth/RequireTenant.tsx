import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTenant } from '../../hooks/useTenant';
import { PageLoader } from '../ui';

const REDIRECT_PREVENT_PATHS = ['/tenant', '/login', '/reset-password'];

export const RequireTenant: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentTenant, loading } = useTenant();
  const location = useLocation();

  if (loading) {
    return <PageLoader variant="screen" label="ワークスペースを読み込み中…" />;
  }

  if (!currentTenant) {
    const shouldPreserveReturn = !REDIRECT_PREVENT_PATHS.includes(location.pathname);
    const from = location.pathname + location.search;
    const state = shouldPreserveReturn ? { from } : undefined;
    return <Navigate to="/tenant" replace state={state} />;
  }

  return <>{children}</>;
};
