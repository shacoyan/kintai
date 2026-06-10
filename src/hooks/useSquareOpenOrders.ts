import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '../lib/logger';
import { squareFetch } from '../lib/sales/squareLiveClient';
import { toFiniteNumber } from '../lib/sales/salesRangeAdapter';
import { MSG } from '../lib/sales/messages';
import type { Discount, LineItem, OpenOrder } from '../lib/sales/types';

// =============================================================================
// useSquareOpenOrders — 当日 live 未決済伝票 hook（Wave4-P2 §4.3.1）
// -----------------------------------------------------------------------------
// useSquareLiveSales と同型（見本 square-dashboard `useOpenOrders` の kintai 版）:
//   - token prop を廃止。Bearer は squareLiveClient が public セッションから載せる。
//   - enabled=false / !locationId / !date → 何もしない（即クリア）。
//   - fetch 開始時に旧 data を即クリア（stale 1 フレーム表示の解消）。
//   - generationRef で unmount / 引数変更後の setState 競合を防ぐ（世代ガード）。
//   - fail-closed: error 時は orders=[] で空表示に倒す（全文 error 保持＝短縮禁止）。
//   - 自動更新: today 表示中のみ 60s interval（useSquareLiveSales と揃える＝
//     同一画面 2 hook の interval を統一しコール頻度を抑える。見本 30s より緩める）。
//   - API レスポンス → 表示型変換は normalize 純関数 `normalizeOpenOrders` に切り出し。
//     null/欠落/数値文字列を toFiniteNumber で吸収（NaN 伝播ガード）。テストは純関数を検証。
//
// 戻り型契約（§4.3.1）:
//   { orders: OpenOrder[], loading, error, lastUpdated, refresh }
// =============================================================================

export interface UseSquareOpenOrdersArgs {
  /** 営業日 today（getBusinessDate(11)）YYYY-MM-DD。 */
  date: string;
  /** 選択店の Square location_id。空のときフェッチしない。 */
  locationId: string;
  /** 営業日の日付変更線（JST hour 0-23）。 */
  startHour: number;
  /** 営業日の終端 hour。見本互換で受領（passthrough）。 */
  endHour: number;
  /** false のときフェッチをスキップ。省略時 true。 */
  enabled?: boolean;
}

export interface UseSquareOpenOrdersResult {
  orders: OpenOrder[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => void;
}

/** /api/open-orders レスポンスの生形（フィールド欠落・数値文字列を許容）。 */
interface RawOpenOrdersResponse {
  orders?: unknown;
}

/** 60s（useSquareLiveSales と統一）。 */
const REFRESH_INTERVAL_MS = 60_000;

/** LineItem 1 件を正規化（数値文字列・欠落を吸収）。 */
function normalizeLineItem(raw: unknown): LineItem {
  const r = (raw ?? {}) as Record<string, unknown>;
  const category = r.category;
  return {
    name: typeof r.name === 'string' ? r.name : '',
    // 見本の LineItem.quantity は string。欠落時は '0' に倒す。
    quantity: r.quantity == null ? '0' : String(r.quantity),
    amount: toFiniteNumber(r.amount),
    category: category == null ? null : String(category),
  };
}

/** Discount 1 件を正規化。 */
function normalizeDiscount(raw: unknown): Discount {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    name: typeof r.name === 'string' ? r.name : '',
    amount: toFiniteNumber(r.amount),
  };
}

/**
 * /api/open-orders レスポンス → `OpenOrder[]` 純関数。
 * orders が配列でなければ空配列（fail-closed）。各行の数値・配列フィールドを
 * 防御的に正規化する（null/欠落/数値文字列を吸収、NaN 伝播ガード）。
 *
 * export しているのはテスト（純関数検証）と再利用のため。
 */
export function normalizeOpenOrders(raw: unknown): OpenOrder[] {
  const list =
    raw && typeof raw === 'object'
      ? (raw as RawOpenOrdersResponse).orders
      : undefined;
  if (!Array.isArray(list)) return [];
  return list.map((row): OpenOrder => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      id: r.id == null ? '' : String(r.id),
      created_at: r.created_at == null ? null : String(r.created_at),
      total_money: toFiniteNumber(r.total_money),
      customer_name: r.customer_name == null ? null : String(r.customer_name),
      line_items: Array.isArray(r.line_items)
        ? r.line_items.map(normalizeLineItem)
        : [],
      discounts: Array.isArray(r.discounts)
        ? r.discounts.map(normalizeDiscount)
        : [],
    };
  });
}

export function useSquareOpenOrders(
  args: UseSquareOpenOrdersArgs,
): UseSquareOpenOrdersResult {
  const { date, locationId, startHour, endHour, enabled = true } = args;

  const active = enabled && !!locationId && !!date;

  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [loading, setLoading] = useState<boolean>(active);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // refresh / interval から最新の fetch を呼ぶための世代 ref（stale closure 回避）。
  const generationRef = useRef(0);

  const doFetch = useCallback(async () => {
    if (!active) return;

    // この fetch 世代を識別。後続 fetch / unmount 時に世代不一致で setState を捨てる。
    const myGeneration = ++generationRef.current;

    setLoading(true);
    // fetch 開始時に旧 data を即クリア（period/店舗切替直後の stale 1 フレームを解消）。
    setOrders([]);
    setError(null);

    const params = new URLSearchParams({
      date,
      location_id: locationId,
      start_hour: String(startHour),
      end_hour: String(endHour),
    });

    try {
      const raw = await squareFetch<unknown>(
        `/api/open-orders?${params.toString()}`,
      );
      if (myGeneration !== generationRef.current) return; // stale 世代は破棄

      setOrders(normalizeOpenOrders(raw));
      setLastUpdated(new Date());
    } catch (err) {
      if (myGeneration !== generationRef.current) return;
      const message = err instanceof Error ? err.message : MSG.error.openOrders;
      logger.error('useSquareOpenOrders fetch failed:', message);
      // fail-closed: 空表示に倒す（全文 error を保持）。
      setOrders([]);
      setError(message);
    } finally {
      if (myGeneration === generationRef.current) setLoading(false);
    }
  }, [active, date, locationId, startHour, endHour]);

  useEffect(() => {
    if (!active) {
      // enabled=false / location 未確定 → 何もしない（stale クリア）。
      // 世代を進めて in-flight fetch の遅延結果を捨てる。
      generationRef.current++;
      setLoading(false);
      setOrders([]);
      setError(null);
      setLastUpdated(null);
      return;
    }

    doFetch();

    // today 表示中のみ 60s 自動更新。
    const interval = setInterval(doFetch, REFRESH_INTERVAL_MS);
    return () => {
      // unmount / 引数変更で in-flight fetch の結果を捨てる。
      generationRef.current++;
      clearInterval(interval);
    };
  }, [active, doFetch]);

  return {
    orders,
    loading,
    error,
    lastUpdated,
    refresh: doFetch,
  };
}
