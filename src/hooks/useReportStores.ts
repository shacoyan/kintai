import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { formatSupabaseError } from '../lib/errors';
import { useTenant } from '../contexts/TenantContext';
import { useStoreContext } from '../contexts/StoreContext';
import { useCan } from '../lib/permissions/useCan';
import type { Store } from '../types';

// =============================================================================
// useReportStores — 日報/月報の店舗セレクタ source（裁定 §3 案1）
// -----------------------------------------------------------------------------
//   - managerial（owner / manager）: tenant の全 active stores を取得して返す
//     （`stores WHERE tenant_id` は RLS `get_my_tenant_ids()` で manager も通過）。
//     これにより owner/manager は7店舗横断で日報・月報を扱える（DB 権限・/sales・
//     総合タブと整合）。
//   - staff: `useStoreContext().stores`（所属店のみ）をそのまま返す。
//   - **StoreContext 本体は触らない**（局所吸収・回帰リスク回避）。
//   - 取得失敗時は `useStoreContext().stores` にフォールバック（fail-open。
//     スコープは UI 表示の広狭であり権限境界は RLS が握るためセキュリティ問題なし）。
// =============================================================================

export interface UseReportStoresResult {
  stores: Store[];
  loading: boolean;
}

export function useReportStores(): UseReportStoresResult {
  const { currentTenant } = useTenant();
  const { stores: contextStores, loading: contextLoading } = useStoreContext();
  const can = useCan();
  // C26 viewAllReportStores（全 active stores 取得可否。bool のみ can 化・fetch ロジックは据え置き）。挙動不変。
  const isManagerial = can('viewAllReportStores');
  const tenantId = currentTenant?.id ?? null;

  const [managerialStores, setManagerialStores] = useState<Store[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    // staff（または tenant 未確定）は context の所属店をそのまま使う。
    if (!isManagerial || !tenantId) {
      setManagerialStores(null);
      setLoading(false);
      return;
    }

    const run = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('stores')
          .select('*')
          .eq('tenant_id', tenantId);
        if (error) throw error;
        if (cancelled) return;
        const list = ((data as Store[]) || [])
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
        setManagerialStores(list);
      } catch (err) {
        if (!cancelled) {
          const friendly = formatSupabaseError(err);
          logger.error('useReportStores fetch failed (fallback to context stores):', friendly);
          // fail-open: context の所属店にフォールバック。
          setManagerialStores(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [isManagerial, tenantId]);

  if (isManagerial && managerialStores) {
    return { stores: managerialStores, loading: loading || contextLoading };
  }
  // staff / 取得前 / 取得失敗時は context の stores。
  return { stores: contextStores, loading: contextLoading || (isManagerial && loading) };
}
