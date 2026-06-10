import { useCallback, useEffect, useState } from 'react';
import { logger } from '../lib/logger';
import { formatSupabaseError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { normalizeMonthlyReport } from '../lib/reports/monthlyReportAdapter';
import type { MonthlyReport } from '../lib/reports/types';

// =============================================================================
// useMonthlyReport — 店舗別月報（get_monthly_report）取得 hook
// -----------------------------------------------------------------------------
// 設計書 §1.1・§1.8・§5.2・§5.6（Loop D/E）。
//
//   - public スキーマ RPC のため **`supabase`（public クライアント）の `.rpc()`**
//     で呼ぶ。`supabaseSquare` / `withSquareSession` は使わない（§1.1・R8）。
//     Square 値の取得は RPC が内部で SECURITY DEFINER で行うためフロントは
//     Square クライアントに触れない。
//   - スコープ強制は RPC 内（auth.uid() → 所属店・ロール）。staff には経営数値が
//     null で返る（adapter が null 保持）。
//   - storeId / year / month が揃ったときのみフェッチ（fail-closed）。
//   - stale クリア: 引数変更時に即 data=null（SalesPage B17 パターン＝旧店舗・
//     旧月データの 1 フレーム残存防止）。
//   - エラーは全文表示（短縮禁止）。
// =============================================================================

export interface UseMonthlyReportResult {
  data: MonthlyReport | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useMonthlyReport(
  storeId: string | null,
  year: number | null,
  month: number | null,
): UseMonthlyReportResult {
  const [data, setData] = useState<MonthlyReport | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const enabled = !!storeId && year != null && month != null;

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      setLoading(false);
      setData(null);
      setError(null);
      return;
    }

    const run = async () => {
      setLoading(true);
      // stale クリア（B17）: 店舗 / 年月切替直後に旧データが見える stale を解消。
      setData(null);
      setError(null);
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc(
          'get_monthly_report',
          { p_store_id: storeId, p_year: year, p_month: month },
        );
        if (rpcError) throw rpcError;
        if (cancelled) return;
        setData(normalizeMonthlyReport(rpcData));
      } catch (err) {
        if (!cancelled) {
          const friendly = formatSupabaseError(err);
          logger.error('useMonthlyReport RPC failed:', friendly);
          // fail-closed: エラー時は data=null（旧データを残さない）。
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
  }, [storeId, year, month, enabled, reloadKey]);

  return { data, loading, error, reload };
}
