import React from 'react';
import { Navigate } from 'react-router-dom';
import { useTenant } from '../../hooks/useTenant';
import { PageLoader } from '../ui';

export const RequireTenant: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentTenant, loading } = useTenant();

  if (loading) {
    return <PageLoader variant="screen" label="ワークスペースを読み込み中…" />;
  }

  if (!currentTenant) {
    return <Navigate to="/tenant" replace />;
  }

  return <>{children}</>;
};
