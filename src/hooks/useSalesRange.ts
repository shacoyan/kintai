import { useEffect, useState } from 'react';
import { logger } from '../lib/logger';
import { formatSupabaseError } from '../lib/errors';
import { supabaseSquare, withSquareSession } from '../lib/supabaseSquare';
import type {
  SalesRangeResponse,
  SalesRangeMeta,
  SalesRangeDay,
} from '../lib/sales/salesRangeAdapter';

// =============================================================================
// useSalesRange — 前日まで集計済み売上を SECURITY DEFINER RPC から取得する hook
// -----------------------------------------------------------------------------
// 設計書 §5.1。`square_dashboard.get_sales_range_scoped(p_from, p_to,
// p_location_names)` を `withSquareSession`（authenticated JWT 注入 + fail-closed）
// 経由で呼び、RPC が返す jsonb を `SalesRangeResponse`（{byDate, meta}）に正規化
// して返す。
//
//   - スコープ強制は RPC 内で auth.uid() から所属店・ロールを引いてサーバ側実施
//     （staff=自店のみ / owner・manager=全店）。フロントは越権集合を渡しても
//     黙って無視される（§1.3 step4）。
//   - fail-closed: セッション無し / エラー時は空集合（byDate:{}, source:'empty'）。
//   - Loop3 拡張点: 当日含む期間は将来 `/api/sales-range`（hybrid）へ分岐。
//     Loop2 は常に RPC。
//
// RPC 呼び出し（schema 指定 rpc）の書き方:
//   `supabaseSquare` は `db.schema='square_dashboard'` 固定クライアントのため、
//   `supabaseSquare.rpc('get_sales_range_scoped', {...})` は
//   square_dashboard スキーマの関数に解決される（public 用 `supabase` とは別）。
// =============================================================================

export interface UseSalesRangeArgs {
  /** 開始日 YYYY-MM-DD（営業日基準） */
  from: string;
  /** 終了日 YYYY-MM-DD（営業日基準） */
  to: string;
  /**
   * 閲覧対象の Square location_name 配列。
   * `null` = ALL（許可全店）。RPC には p_location_names=null で渡す。
   */
  locationNames: string[] | null;
  /**
   * false のときフェッチをスキップする（スコープ確定前など）。
   * 省略時は true。
   */
  enabled?: boolean;
}

export interface UseSalesRangeResult {
  data: SalesRangeResponse | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_RESPONSE: SalesRangeResponse = {
  byDate: {},
  meta: {
    source: 'empty',
    location_ids: [],
    live_dates: [],
    aggregate_dates: [],
    future_dates: [],
    use_aggregate: false,
  },
};

/**
 * RPC が返す jsonb を完全な `SalesRangeMeta` に正規化する。
 * RPC（§2）は source/location_ids/aggregate_dates/use_aggregate/empty のみ返すため、
 * adapter が要求する live_dates/future_dates 等の欠落フィールドを既定値で補う。
 */
function normalizeMeta(raw: unknown): SalesRangeMeta {
  const m = (raw ?? {}) as Partial<SalesRangeMeta> & Record<string, unknown>;
  return {
    source: (m.source as SalesRangeMeta['source']) ?? 'aggregate',
    location_ids: Array.isArray(m.location_ids) ? (m.location_ids as string[]) : [],
    live_dates: Array.isArray(m.live_dates) ? (m.live_dates as string[]) : [],
    aggregate_dates: Array.isArray(m.aggregate_dates)
      ? (m.aggregate_dates as string[])
      : [],
    future_dates: Array.isArray(m.future_dates) ? (m.future_dates as string[]) : [],
    use_aggregate: typeof m.use_aggregate === 'boolean' ? m.use_aggregate : true,
    empty: typeof m.empty === 'boolean' ? m.empty : undefined,
  };
}

/**
 * RPC の返り jsonb を `SalesRangeResponse` に正規化する。
 */
function normalizeResponse(raw: unknown): SalesRangeResponse {
  const obj = (raw ?? {}) as { byDate?: unknown; meta?: unknown };
  const byDate =
    obj.byDate && typeof obj.byDate === 'object'
      ? (obj.byDate as Record<string, SalesRangeDay>)
      : {};
  return { byDate, meta: normalizeMeta(obj.meta) };
}

export function useSalesRange(args: UseSalesRangeArgs): UseSalesRangeResult {
  const { from, to, locationNames, enabled = true } = args;

  const [data, setData] = useState<SalesRangeResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);

  // locationNames は配列参照が毎レンダー変わり得るため、内容で依存キー化する。
  const locKey = locationNames === null ? 'ALL' : [...locationNames].sort().join('|');

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      setLoading(false);
      return;
    }

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: rpcData, error: rpcError } = await withSquareSession(
          async () =>
            await supabaseSquare.rpc('get_sales_range_scoped', {
              p_from: from,
              p_to: to,
              // ALL は NULL 相当（RPC が許可全店を合算）。
              p_location_names: locationNames,
            })
        );
        if (rpcError) throw rpcError;
        if (cancelled) return;

        setData(normalizeResponse(rpcData));
      } catch (err) {
        if (!cancelled) {
          const friendly = formatSupabaseError(err);
          logger.error('useSalesRange RPC failed:', friendly);
          // fail-closed: セッション無し / エラー時は空集合を返す。
          setData(EMPTY_RESPONSE);
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
  }, [from, to, locKey, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error };
}
