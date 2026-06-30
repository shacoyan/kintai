// =============================================================================
// Phase 2 — 閲覧範囲設定の読取/書込フック（店長 manager の閲覧スコープ）
// 設計書: .company/engineering/docs/2026-06-30-kintai-permissions-phase2-view-scope-ui.md §5.2
//
// 読取: tenant_view_scopes を managerial RLS で select（owner/manager のみ通る）。
// 書込: set_view_scope RPC 経由のみ（migration 106）。
//   直 upsert は RLS 0 行除外を無音 success にする落とし穴があるため使わない。
//   RPC は非 owner / 無効 domain / 無効 scope を RAISE で遮断する（0 行無音を構造的に排除）。
//
// 型付け方針（§5.1）: tenant_view_scopes テーブル Row 型は手動補完済（src/types/supabase.ts）。
//   set_view_scope RPC は本番未適用＝生成型の Functions に無いため、rpc 呼出のみ手動キャストする。
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { formatSupabaseError, type FriendlyError } from '../lib/errors';
import type { Database } from '../types/supabase';

export type ViewDomain = 'attendance' | 'shift' | 'shift_preference';
export type ViewScope = 'tenant' | 'own_stores';

// 第一弾スコープ（厳守）: RLS 強制済の 3 domain のみ。manager 固定（RPC も 'manager' 固定）。
export const VIEW_DOMAINS: ViewDomain[] = ['attendance', 'shift', 'shift_preference'];

// 既定は全 'tenant'（Phase1 ヘルパ既定／行欠落・未取得時の安全側＝fail-open）。
const DEFAULT_SCOPES: Record<ViewDomain, ViewScope> = {
  attendance: 'tenant',
  shift: 'tenant',
  shift_preference: 'tenant',
};

type ViewScopeRow = Database['public']['Tables']['tenant_view_scopes']['Row'];

export interface UseViewScopes {
  scopes: Record<ViewDomain, ViewScope>;
  loading: boolean;
  error: FriendlyError | null;
  clearError: () => void;
  setScope: (domain: ViewDomain, scope: ViewScope) => Promise<void>;
  refetch: () => Promise<void>;
}

function isViewDomain(v: string): v is ViewDomain {
  return v === 'attendance' || v === 'shift' || v === 'shift_preference';
}
function isViewScope(v: string): v is ViewScope {
  return v === 'tenant' || v === 'own_stores';
}

export function useViewScopes(tenantId: string | null): UseViewScopes {
  const [scopes, setScopes] = useState<Record<ViewDomain, ViewScope>>({ ...DEFAULT_SCOPES });
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<FriendlyError | null>(null);
  const clearError = useCallback(() => setError(null), []);

  const fetchScopes = useCallback(async (): Promise<void> => {
    if (!tenantId) {
      setScopes({ ...DEFAULT_SCOPES });
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('tenant_view_scopes')
        .select('domain, scope')
        .eq('tenant_id', tenantId)
        .eq('role', 'manager');

      if (fetchError) {
        throw fetchError;
      }

      const next: Record<ViewDomain, ViewScope> = { ...DEFAULT_SCOPES };
      for (const row of (data ?? []) as Pick<ViewScopeRow, 'domain' | 'scope'>[]) {
        if (isViewDomain(row.domain) && isViewScope(row.scope)) {
          next[row.domain] = row.scope;
        }
      }
      setScopes(next);
    } catch (e) {
      const fmt = formatSupabaseError(e);
      logger.error('useViewScopes fetchScopes error:', fmt);
      setError(fmt);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    let isMounted = true;
    const run = async () => {
      if (!tenantId) {
        if (isMounted) {
          setScopes({ ...DEFAULT_SCOPES });
          setLoading(false);
        }
        return;
      }
      try {
        setLoading(true);
        setError(null);
        const { data, error: fetchError } = await supabase
          .from('tenant_view_scopes')
          .select('domain, scope')
          .eq('tenant_id', tenantId)
          .eq('role', 'manager');

        if (!isMounted) return;
        if (fetchError) {
          throw fetchError;
        }

        const next: Record<ViewDomain, ViewScope> = { ...DEFAULT_SCOPES };
        for (const row of (data ?? []) as Pick<ViewScopeRow, 'domain' | 'scope'>[]) {
          if (isViewDomain(row.domain) && isViewScope(row.scope)) {
            next[row.domain] = row.scope;
          }
        }
        setScopes(next);
      } catch (e) {
        const fmt = formatSupabaseError(e);
        logger.error('useViewScopes fetch error:', fmt);
        if (isMounted) setError(fmt);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    run();
    return () => {
      isMounted = false;
    };
  }, [tenantId]);

  const setScope = useCallback(
    async (domain: ViewDomain, scope: ViewScope): Promise<void> => {
      if (!tenantId) {
        throw new Error('テナント情報が取得できないため閲覧範囲を更新できません。');
      }

      const prev = scopes[domain];
      // 楽観更新（失敗時はロールバック）。
      setScopes((s) => ({ ...s, [domain]: scope }));

      try {
        setError(null);
        // set_view_scope は本番未適用＝生成型 Functions に無いため rpc 呼出のみ手動キャスト（§5.1）。
        const rpc = supabase.rpc as unknown as (
          fn: 'set_view_scope',
          args: { p_tenant_id: string; p_domain: ViewDomain; p_scope: ViewScope },
        ) => Promise<{ data: ViewScopeRow | null; error: unknown }>;

        const { data, error: rpcError } = await rpc('set_view_scope', {
          p_tenant_id: tenantId,
          p_domain: domain,
          p_scope: scope,
        });

        if (rpcError) {
          throw rpcError;
        }

        // RETURNING を信頼して確定反映（行が返れば DB の scope を採用）。
        if (data && isViewDomain(data.domain) && isViewScope(data.scope)) {
          const confirmedDomain = data.domain;
          const confirmedScope = data.scope;
          setScopes((s) => ({ ...s, [confirmedDomain]: confirmedScope }));
        }
      } catch (e) {
        // 失敗時はロールバック。エラーは全文表示（短縮禁止）。
        setScopes((s) => ({ ...s, [domain]: prev }));
        const fmt = formatSupabaseError(e);
        logger.error('useViewScopes setScope error:', fmt);
        setError(fmt);
        throw new Error(fmt.message);
      }
    },
    [tenantId, scopes],
  );

  return {
    scopes,
    loading,
    error,
    clearError,
    setScope,
    refetch: fetchScopes,
  };
}
