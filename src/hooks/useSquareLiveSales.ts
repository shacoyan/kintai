import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '../lib/logger';
import { squareFetch } from '../lib/sales/squareLiveClient';
import { toFiniteNumber } from '../lib/sales/salesRangeAdapter';
import { MSG } from '../lib/sales/messages';
import type { Discount, LineItem, Transaction } from '../lib/sales/types';

// =============================================================================
// useSquareLiveSales — 当日 live 売上 hook（Wave4-P1 §4.3.2）
// -----------------------------------------------------------------------------
// 見本（square-dashboard）`useSquareData` の kintai 版。差分:
//   - token prop を廃止。Bearer は squareLiveClient が public セッションから載せる。
//   - 既存 hooks（useSalesRange 等）の堅牢化パターンを踏襲:
//       enabled=false / !locationId → 何もしない（即クリア）
//       fetch 開始時に旧 data を即クリア（stale 1 フレーム表示の解消）
//       cancelled フラグで unmount / 引数変更後の setState 競合を防ぐ
//       fail-closed: error 時は sales=null / transactions=[] で空表示に倒す
//       error は全文（squareFetch が HTTP ステータス全文を載せる＝短縮禁止）
//   - API レスポンス → 表示型変換は normalize 純関数に切り出し（null/欠落/数値文字列を
//     toFiniteNumber で吸収。NaN 伝播ガード）。テストは純関数を直接検証する。
//   - 自動更新: today 表示中のみ 60s interval（見本踏襲）。
//
// 戻り型契約（§4.3.2）:
//   { sales: {total_amount,transaction_count}|null, transactions, loading, error,
//     lastUpdated, refresh }
// =============================================================================

export interface UseSquareLiveSalesArgs {
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

/** §4.3.2 の sales 戻り型（見本 SalesData の table-stakes 部分）。 */
export interface LiveSalesSummary {
  total_amount: number;
  transaction_count: number;
}

export interface UseSquareLiveSalesResult {
  sales: LiveSalesSummary | null;
  transactions: Transaction[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => void;
}

/** /api/sales レスポンスの生形（フィールド欠落・数値文字列を許容）。 */
interface RawSalesResponse {
  total_amount?: unknown;
  transaction_count?: unknown;
}

/** /api/transactions レスポンスの生形。 */
interface RawTransactionsResponse {
  transactions?: unknown;
}

/** 60s（見本踏襲）。 */
const REFRESH_INTERVAL_MS = 60_000;

/**
 * /api/sales レスポンス → `LiveSalesSummary | null` 純関数。
 * null/undefined/数値文字列を toFiniteNumber で吸収する（NaN 伝播ガード）。
 * resp 自体が null/非オブジェクトなら null を返す（fail-closed）。
 *
 * export しているのはテスト（純関数検証）と再利用のため。
 */
export function normalizeLiveSales(raw: unknown): LiveSalesSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as RawSalesResponse;
  return {
    total_amount: toFiniteNumber(r.total_amount),
    transaction_count: toFiniteNumber(r.transaction_count),
  };
}

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
 * /api/transactions レスポンス → `Transaction[]` 純関数。
 * transactions が配列でなければ空配列（fail-closed）。各行の数値・配列フィールドを
 * 防御的に正規化する（null/欠落/数値文字列を吸収、NaN 伝播ガード）。
 *
 * export しているのはテスト（純関数検証）と再利用のため。
 */
export function normalizeLiveTransactions(raw: unknown): Transaction[] {
  const list =
    raw && typeof raw === 'object'
      ? (raw as RawTransactionsResponse).transactions
      : undefined;
  if (!Array.isArray(list)) return [];
  return list.map((row): Transaction => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      id: r.id == null ? '' : String(r.id),
      customer_name:
        r.customer_name == null ? null : String(r.customer_name),
      created_at_jst:
        typeof r.created_at_jst === 'string' ? r.created_at_jst : '',
      order_created_at_jst:
        r.order_created_at_jst == null ? null : String(r.order_created_at_jst),
      amount: toFiniteNumber(r.amount),
      status: typeof r.status === 'string' ? r.status : '',
      source: typeof r.source === 'string' ? r.source : '',
      line_items: Array.isArray(r.line_items)
        ? r.line_items.map(normalizeLineItem)
        : [],
      discounts: Array.isArray(r.discounts)
        ? r.discounts.map(normalizeDiscount)
        : [],
    };
  });
}

export function useSquareLiveSales(
  args: UseSquareLiveSalesArgs,
): UseSquareLiveSalesResult {
  const { date, locationId, startHour, endHour, enabled = true } = args;

  const active = enabled && !!locationId && !!date;

  const [sales, setSales] = useState<LiveSalesSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState<boolean>(active);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // refresh / interval から最新の fetch 関数を呼ぶための ref（依存差し替えで stale
  // closure を避ける）。各 fetch 世代に cancelled フラグを持たせる。
  const generationRef = useRef(0);

  const doFetch = useCallback(async () => {
    if (!active) return;

    // この fetch 世代を識別。後続 fetch / unmount 時に世代不一致で setState を捨てる。
    const myGeneration = ++generationRef.current;

    setLoading(true);
    // fetch 開始時に旧 data を即クリア（period/店舗切替直後の stale 1 フレームを解消）。
    setSales(null);
    setTransactions([]);
    setError(null);

    const params = new URLSearchParams({
      date,
      location_id: locationId,
      start_hour: String(startHour),
      end_hour: String(endHour),
    });

    try {
      const [salesRaw, txRaw] = await Promise.all([
        squareFetch<unknown>(`/api/sales?${params.toString()}`),
        squareFetch<unknown>(`/api/transactions?${params.toString()}`),
      ]);
      if (myGeneration !== generationRef.current) return; // stale 世代は破棄

      setSales(normalizeLiveSales(salesRaw));
      setTransactions(normalizeLiveTransactions(txRaw));
      setLastUpdated(new Date());
    } catch (err) {
      if (myGeneration !== generationRef.current) return;
      const message =
        err instanceof Error ? err.message : MSG.error.sales;
      logger.error('useSquareLiveSales fetch failed:', message);
      // fail-closed: 空表示に倒す（全文 error を保持）。
      setSales(null);
      setTransactions([]);
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
      setSales(null);
      setTransactions([]);
      setError(null);
      setLastUpdated(null);
      return;
    }

    doFetch();

    // today 表示中のみ 60s 自動更新（見本踏襲）。
    const interval = setInterval(doFetch, REFRESH_INTERVAL_MS);
    return () => {
      // unmount / 引数変更で in-flight fetch の結果を捨てる。
      generationRef.current++;
      clearInterval(interval);
    };
  }, [active, doFetch]);

  return {
    sales,
    transactions,
    loading,
    error,
    lastUpdated,
    refresh: doFetch,
  };
}
