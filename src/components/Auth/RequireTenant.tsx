import React, { useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTenant } from '../../hooks/useTenant';
import { PageLoader } from '../ui';

const REDIRECT_PREVENT_PATHS = ['/tenant', '/login', '/reset-password'];

export const RequireTenant: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentTenant, loading } = useTenant();
  const location = useLocation();
  // 既に tenant が解決されたら以降 loading=true でも children を keep mount。
  // refresh race (Supabase TOKEN_REFRESHED 等で TenantContext.fetchTenants が再走し
  // setLoading(true) になる瞬間) に tree を unmount しないよう守る stale-while-revalidate。
  // 詳細: docs/2026-05-13-kintai-visibility-state-reset-bug-techdesign.md §3.1 案 A
  const hasResolvedOnce = useRef(false);
  if (currentTenant) hasResolvedOnce.current = true;

  if (loading && !hasResolvedOnce.current) {
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
