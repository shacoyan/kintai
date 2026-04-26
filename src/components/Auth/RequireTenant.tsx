import React from 'react';
import { Navigate } from 'react-router-dom';
import { useTenant } from '../../hooks/useTenant';

export const RequireTenant: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentTenant, loading } = useTenant();

  if (loading) {
    return (
      <div className="h-screen w-screen flex justify-center items-center bg-neutral-50">
        <div className="w-16 h-16 border-4 border-primary-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!currentTenant) {
    return <Navigate to="/tenant" replace />;
  }

  return <>{children}</>;
};
