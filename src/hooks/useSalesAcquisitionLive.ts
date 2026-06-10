import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '../lib/logger';
import { squareFetch } from '../lib/sales/squareLiveClient';
import { toFiniteNumber } from '../lib/sales/salesRangeAdapter';
import { aggregateSegments } from '../lib/sales/customerSegment';
import type {
  AcquisitionBreakdown,
  Discount,
  LineItem,
  OpenOrder,
  Transaction,
} from '../lib/sales/types';

// =============================================================================
// useSalesAcquisitionLive — 獲得経路の live 補完 hook（Wave4-P2 §4.1.1 / §4.1.2）
// -----------------------------------------------------------------------------
// 役割: 現在の period 期間の transactions-range（+open-orders-range）を fetch し、
// `aggregateSegments(allTransactions).acquisition` だけを返す。売上・客数・トレンドは
// 一切触らない（それは useSalesSegment=RPC が正本）。獲得経路だけの live 補完。
//
// 三重ガード（設計書どおり。enabled=false で fetch しない）:
//   1. 単店選択時のみ（locationId 解決済み）。ALL は補完しない（§4.1.4）。
//   2. 非 today（today live は別経路）。
//   3. 期間 92 日クランプ（コスト上限。clampAcquisitionRange 純関数）。
//
// fail-soft（§4.1.1）: 失敗時は acquisition=null（売上表示には一切影響させない＝
// 呼び出し側は data の既定ゼロのまま）。両 fetch 失敗時のみ error。片方成功なら成功側で集計。
//
// AbortController + 世代管理: 引数変更/unmount で in-flight を中断 & stale 破棄。
// =============================================================================

/** 獲得経路 transactions-range の期間上限（四半期相当）。year/長期はこれにクランプ。 */
export const ACQUISITION_MAX_RANGE_DAYS = 92;

/** acquisition fetch の timeout（catalog 多段がありうるため明示 60s）。 */
const ACQUISITION_TIMEOUT_MS = 60_000;

export interface UseSalesAcquisitionLiveArgs {
  /** 期間先頭（SalesPage の dates[0] 相当 = from）YYYY-MM-DD。 */
  startDate: string;
  /** 期間末尾（to）YYYY-MM-DD。 */
  endDate: string;
  /** 単店の Square location_id（ALL は補完対象外）。 */
  locationId: string;
  /** STORE_START_HOUR。 */
  startHour: number;
  /** (STORE_START_HOUR + 23) % 24。 */
  endHour: number;
  /** 非 today かつ単店 id 解決済みのときのみ true。 */
  enabled: boolean;
}

export interface UseSalesAcquisitionLiveResult {
  /** 取得成功時のみ。null=未取得/取得失敗（呼び出し側は既定ゼロのまま）。 */
  acquisition: AcquisitionBreakdown | null;
  loading: boolean;
  /** 全文（短縮禁止）。失敗時も売上表示は壊さない（acquisition だけ欠落）。 */
  error: string | null;
  /** クランプが効いて「直近 92 日」に縮めた場合 true（チャート注記用）。 */
  clamped: boolean;
}

/** /api/transactions-range レスポンスの生形（byDate）。 */
interface RawTxRangeResponse {
  byDate?: Record<string, { transactions?: unknown } | undefined>;
}

/** /api/open-orders-range レスポンスの生形（byDate）。 */
interface RawOpenRangeResponse {
  byDate?: Record<string, { orders?: unknown } | undefined>;
}

/** YYYY-MM-DD を UTC ミリ秒に変換（日数差計算用。TZ 非依存で安定）。 */
function dateToUtcMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

/** UTC ミリ秒を YYYY-MM-DD に戻す。 */
function utcMsToDate(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 獲得経路 fetch の期間を上限クランプする純関数（§4.1.2）。
 * `endDate - startDate > maxDays` のとき startDate を `endDate - maxDays` に切り上げる。
 * 売上・客数（RPC=全期間）には影響しない。acquisition チャートだけが「直近 maxDays 日」になる。
 *
 * 無効入力（NaN になる日付）はクランプせずそのまま返す（fail-soft。呼び出し側で fetch 判定）。
 *
 * @returns { start, end, clamped }。clamped=true のときチャートに注記を出す。
 */
export function clampAcquisitionRange(
  startDate: string,
  endDate: string,
  maxDays: number = ACQUISITION_MAX_RANGE_DAYS,
): { start: string; end: string; clamped: boolean } {
  const startMs = dateToUtcMs(startDate);
  const endMs = dateToUtcMs(endDate);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return { start: startDate, end: endDate, clamped: false };
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const spanDays = Math.round((endMs - startMs) / dayMs);
  if (spanDays <= maxDays) {
    return { start: startDate, end: endDate, clamped: false };
  }
  const clampedStartMs = endMs - maxDays * dayMs;
  return { start: utcMsToDate(clampedStartMs), end: endDate, clamped: true };
}

/** LineItem 1 件を正規化（acquisition 集計に必要な name/quantity/amount/category）。 */
function normalizeLineItem(raw: unknown): LineItem {
  const r = (raw ?? {}) as Record<string, unknown>;
  const category = r.category;
  return {
    name: typeof r.name === 'string' ? r.name : '',
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

/** transactions-range の 1 transaction を最小正規化（acquisition は line_items のみ依存）。 */
function normalizeRangeTransaction(raw: unknown): Transaction {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: r.id == null ? '' : String(r.id),
    customer_name: r.customer_name == null ? null : String(r.customer_name),
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
}

/** open-orders-range の 1 order を Transaction 化（見本 openOrderToTransaction 同型）。 */
function normalizeOpenOrderAsTransaction(raw: unknown): Transaction {
  const r = (raw ?? {}) as Record<string, unknown>;
  const o: OpenOrder = {
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
  return {
    id: o.id,
    customer_name: o.customer_name,
    created_at_jst: o.created_at ?? '',
    amount: o.total_money,
    status: 'OPEN',
    source: 'OPEN_TICKET',
    line_items: o.line_items,
    discounts: o.discounts,
  };
}

/**
 * transactions-range byDate を flat 化して Transaction[] に正規化する純関数。
 * byDate が非オブジェクトなら空配列（fail-soft）。export はテスト用。
 */
export function flattenTxRange(raw: unknown): Transaction[] {
  const byDate =
    raw && typeof raw === 'object'
      ? (raw as RawTxRangeResponse).byDate
      : undefined;
  if (!byDate || typeof byDate !== 'object') return [];
  const out: Transaction[] = [];
  for (const day of Object.values(byDate)) {
    const list = day?.transactions;
    if (Array.isArray(list)) out.push(...list.map(normalizeRangeTransaction));
  }
  return out;
}

/**
 * open-orders-range byDate を flat 化して Transaction[]（OPEN 化）に正規化する純関数。
 * byDate が非オブジェクトなら空配列（fail-soft）。export はテスト用。
 */
export function flattenOpenRange(raw: unknown): Transaction[] {
  const byDate =
    raw && typeof raw === 'object'
      ? (raw as RawOpenRangeResponse).byDate
      : undefined;
  if (!byDate || typeof byDate !== 'object') return [];
  const out: Transaction[] = [];
  for (const day of Object.values(byDate)) {
    const list = day?.orders;
    if (Array.isArray(list)) out.push(...list.map(normalizeOpenOrderAsTransaction));
  }
  return out;
}

export function useSalesAcquisitionLive(
  args: UseSalesAcquisitionLiveArgs,
): UseSalesAcquisitionLiveResult {
  const { startDate, endDate, locationId, startHour, endHour, enabled } = args;

  const active = enabled && !!locationId && !!startDate && !!endDate;

  const [acquisition, setAcquisition] = useState<AcquisitionBreakdown | null>(
    null,
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [clamped, setClamped] = useState<boolean>(false);

  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(async () => {
    if (!active) return;

    const myGeneration = ++generationRef.current;

    // 前 in-flight を中断。
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    // fail-soft: 取得中は前回値を破棄（period/店舗切替の stale 残存を防ぐ）。
    setAcquisition(null);
    setError(null);

    const { start, end, clamped: didClamp } = clampAcquisitionRange(
      startDate,
      endDate,
    );
    setClamped(didClamp);

    const baseParams = {
      start_date: start,
      end_date: end,
      location_id: locationId,
      start_hour: String(startHour),
      end_hour: String(endHour),
    };
    const txParams = new URLSearchParams(baseParams).toString();
    const openParams = new URLSearchParams(baseParams).toString();

    try {
      const [txResult, openResult] = await Promise.allSettled([
        squareFetch<unknown>(`/api/transactions-range?${txParams}`, {
          timeoutMs: ACQUISITION_TIMEOUT_MS,
          signal: controller.signal,
        }),
        squareFetch<unknown>(`/api/open-orders-range?${openParams}`, {
          timeoutMs: ACQUISITION_TIMEOUT_MS,
          signal: controller.signal,
        }),
      ]);

      if (myGeneration !== generationRef.current) return; // stale 破棄
      if (controller.signal.aborted) return;

      const isTxFailure = txResult.status === 'rejected';
      const isOpenFailure = openResult.status === 'rejected';

      // 両方失敗時のみ fail-soft で null + error。片方成功なら成功側だけで集計。
      if (isTxFailure && isOpenFailure) {
        const reason =
          txResult.status === 'rejected' && txResult.reason instanceof Error
            ? txResult.reason.message
            : '期間データの取得に失敗しました';
        logger.error('useSalesAcquisitionLive both fetch failed:', reason);
        setAcquisition(null);
        setError(reason);
        return;
      }

      const allTransactions: Transaction[] = [];
      if (!isTxFailure) {
        allTransactions.push(...flattenTxRange(txResult.value));
      }
      if (!isOpenFailure) {
        allTransactions.push(...flattenOpenRange(openResult.value));
      }

      setAcquisition(aggregateSegments(allTransactions).acquisition);
    } catch (err) {
      if (myGeneration !== generationRef.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message =
        err instanceof Error ? err.message : '期間データの取得に失敗しました';
      logger.error('useSalesAcquisitionLive fetch failed:', message);
      setAcquisition(null);
      setError(message);
    } finally {
      if (myGeneration === generationRef.current) setLoading(false);
    }
  }, [active, startDate, endDate, locationId, startHour, endHour]);

  useEffect(() => {
    if (!active) {
      // 三重ガードのいずれか不成立 → 補完しない（acquisition=null リセット）。
      generationRef.current++;
      if (abortRef.current) abortRef.current.abort();
      setLoading(false);
      setAcquisition(null);
      setError(null);
      setClamped(false);
      return;
    }

    doFetch();

    return () => {
      // unmount / 引数変更で in-flight を中断 & stale 破棄。
      generationRef.current++;
      if (abortRef.current) abortRef.current.abort();
    };
  }, [active, doFetch]);

  return { acquisition, loading, error, clamped };
}
