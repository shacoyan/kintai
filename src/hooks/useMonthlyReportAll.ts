import { useCallback, useEffect, useState } from 'react';
import { logger } from '../lib/logger';
import { formatSupabaseError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { normalizeMonthlyReportAll } from '../lib/reports/monthlyReportAdapter';
import type { MonthlyReportAll } from '../lib/reports/types';

// =============================================================================
// useMonthlyReportAll — 総合月報（get_monthly_report_all）取得 hook
// -----------------------------------------------------------------------------
// 設計書 §1.1・§1.8・§5.5・§5.6（Loop D/E）。
//
//   - public スキーマ RPC のため **`supabase`（public クライアント）の `.rpc()`**
//     で呼ぶ。`supabaseSquare` / `withSquareSession` は使わない（§1.1・R8）。
//   - **managerial のみ呼ぶ**前提（呼び出し側が enabled で制御）。staff には RPC が
//     利益額・率 null を返すため二層防御（adapter が null 保持）。enabled=false の
//     ときはフェッチせず data=null。
//   - year / month が揃い、かつ enabled=true のときのみフェッチ（fail-closed）。
//   - stale クリア: 引数変更時に即 data=null（B17）。
//   - エラーは全文表示（短縮禁止）。
// =============================================================================

export interface UseMonthlyReportAllResult {
  data: MonthlyReportAll | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useMonthlyReportAll(
  year: number | null,
  month: number | null,
  enabled = true,
): UseMonthlyReportAllResult {
  const [data, setData] = useState<MonthlyReportAll | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const ready = enabled && year != null && month != null;

  useEffect(() => {
    let cancelled = false;

    if (!ready) {
      setLoading(false);
      setData(null);
      setError(null);
      return;
    }

    const run = async () => {
      setLoading(true);
      // stale クリア（B17）。
      setData(null);
      setError(null);
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc(
          'get_monthly_report_all',
          { p_year: year, p_month: month },
        );
        if (rpcError) throw rpcError;
        if (cancelled) return;
        setData(normalizeMonthlyReportAll(rpcData));
      } catch (err) {
        if (!cancelled) {
          const friendly = formatSupabaseError(err);
          logger.error('useMonthlyReportAll RPC failed:', friendly);
          // fail-closed。
          setData(null);
          setError(friendly.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [year, month, ready, reloadKey]);

  return { data, loading, error, reload };
}
