import React, { useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { PageLoader } from '../ui';

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  // 一度でも user が解決されたら以降 loading=true でも children を keep mount する
  // (TOKEN_REFRESHED 等の sequence で tree が unmount されると配下 local state が
  //  全消失するため、Supabase JS 標準の stale-while-revalidate を模す。
  //  詳細: docs/2026-05-13-kintai-visibility-state-reset-bug-techdesign.md §3.1 案 A)
  const hasResolvedOnce = useRef(false);
  if (user) hasResolvedOnce.current = true;

  if (loading && !hasResolvedOnce.current) {
    return <PageLoader variant="screen" label="認証情報を確認しています…" />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};
