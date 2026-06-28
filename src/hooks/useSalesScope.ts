import { useEffect, useState } from 'react';
import { logger } from '../lib/logger';
import { formatSupabaseError } from '../lib/errors';
import { supabaseSquare, withSquareSession } from '../lib/supabaseSquare';
import { resolveSquareLocationName } from '../lib/squareStoreMap';
import { useTenant } from '../contexts/TenantContext';
import { useStoreContext } from '../contexts/StoreContext';
import { useCan } from '../lib/permissions/useCan';

// =============================================================================
// useSalesScope — Square 売上の閲覧スコープ（許可 location 名集合）を算出する hook
// -----------------------------------------------------------------------------
// 設計書 §2.4。DB 側 RLS は square_dashboard.* を authenticated 全員に開放
// （qual=true）しているため、店舗の絞り込みはアプリ層で行う。
//   - owner / manager → 本番テナントの全 active Square 店（locations_meta 全 active）
//     を閲覧可。canViewAll=true。
//   - staff（is_parttime 含む）→ useStoreContext().stores（自分の所属店）を
//     resolveSquareLocationName で Square 名に変換し、locations_meta(active) との
//     intersection のみ。Square に未マッチの所属店（例「経営内勤」）は対象外
//     （エラーにしない）。canViewAll=false。
// =============================================================================

export interface SalesScope {
  /** 閲覧を許可する Square location_name の集合 */
  allowedLocationNames: string[];
  /** 全店（ALL）選択肢を出してよいか（owner / manager のみ true） */
  canViewAll: boolean;
  loading: boolean;
}

interface LocationMetaRow {
  location_name: string;
  is_active: boolean;
}

export function useSalesScope(): SalesScope {
  const { currentTenant } = useTenant();
  const { stores, loading: storesLoading } = useStoreContext();
  const can = useCan();

  // C25 viewAllSales（全店 ALL 選択肢の可否。bool のみ can 化・allowedLocationNames 算出は据え置き）。挙動不変。
  const canViewAll = can('viewAllSales');

  const [activeLocationNames, setActiveLocationNames] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;

    const fetchActiveLocations = async () => {
      if (!currentTenant) {
        if (!cancelled) {
          setActiveLocationNames([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      try {
        // B20: 売上 hook と同じ withSquareSession に統一。セッション無し時は
        // 即 throw → 下の catch が fail-closed（setActiveLocationNames([])）。
        // public ログアウト後の旧 JWT で locations_meta が読める経路を構造封鎖。
        const { data, error } = await withSquareSession(
          async () =>
            await supabaseSquare
              .from('locations_meta')
              .select('location_name, is_active')
              .eq('is_active', true),
        );

        if (error) throw error;
        if (cancelled) return;

        const names = ((data as LocationMetaRow[] | null) ?? [])
          .map((r) => r.location_name)
          .filter((n): n is string => !!n);
        setActiveLocationNames(names);
      } catch (err) {
        if (!cancelled) {
          logger.error('Failed to fetch locations_meta:', formatSupabaseError(err));
          setActiveLocationNames([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchActiveLocations();
    return () => {
      cancelled = true;
    };
  }, [currentTenant?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 許可集合の算出
  let allowedLocationNames: string[];
  if (canViewAll) {
    // owner / manager は全 active 店
    allowedLocationNames = activeLocationNames;
  } else {
    // staff: 所属店を Square 名へ変換し、active locations_meta と intersection。
    // 未マッチ（locations_meta に実在しない名）は除外（エラーにしない）。
    const activeSet = new Set(activeLocationNames);
    const mapped = stores.map((s) => resolveSquareLocationName(s.name));
    const seen = new Set<string>();
    allowedLocationNames = mapped.filter((name) => {
      if (!activeSet.has(name) || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }

  // Loop2 申し送り §6.1: locations_meta fetch だけでなく、StoreContext の所属店
  // ロード中（storesLoading）と currentTenant 未確定も loading に合成する。
  // staff のスコープ確定前に「対象店舗なし」を一瞬誤表示するのを防ぐ。
  const combinedLoading = loading || storesLoading || !currentTenant;

  return { allowedLocationNames, canViewAll, loading: combinedLoading };
}
