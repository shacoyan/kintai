import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '../lib/logger';
import { squareFetch } from '../lib/sales/squareLiveClient';
import { aggregateSegments } from '../lib/sales/customerSegment';
import {
  clampAcquisitionRange,
  flattenTxRange,
  flattenOpenRange,
} from './useSalesAcquisitionLive';
import type { AcquisitionBreakdown } from '../lib/sales/types';

// =============================================================================
// useSalesAcquisitionAllStores — 全店舗比較テーブルの獲得経路 5 列 hook（設計書 D7）
// -----------------------------------------------------------------------------
// useSalesAcquisitionLive と同方式（transactions-range + open-orders-range を
// Promise.allSettled）を許可店ぶん行う。useSquareLiveAllStores のパターンに倣い
// 店間も allSettled（1 店失敗が他店を巻き込まない）。
//
//   - hook 内で /api/locations を 1 回 fetch して name→id 解決する（SalesPage の
//     needLocationId 条件は触らない = 非 today ALL で自己完結）。
//   - 未解決店は fetch せず byName[name]=null + failedStores へ。
//   - /api/locations 自体の失敗は error（全文）+ 全店 null + failedStores 全店。
//   - fail-soft: 店単位の失敗（tx/open 両方失敗）は該当店のみ null + failedStores。
//     売上系列（071/077 由来）には一切影響させない（この hook は byName しか返さない）。
//   - 92 日クランプ（全店共通の start/end）。timeout 60s。AbortController + 世代ガード。
//   - settled 結果 → byName の畳み込みは純関数 buildAcquisitionByName に切り出す（export）。
// =============================================================================

/** acquisition fetch の timeout（useSalesAcquisitionLive と同方式・60s）。 */
const ACQUISITION_ALL_STORES_TIMEOUT_MS = 60_000;

export interface UseSalesAcquisitionAllStoresArgs {
  /** 対象店舗名（許可店・name-unique 前提）。 */
  locationNames: string[];
  /** 開始日 YYYY-MM-DD（営業日基準）。 */
  startDate: string;
  /** 終了日 YYYY-MM-DD（営業日基準）。 */
  endDate: string;
  /** STORE_START_HOUR。 */
  startHour: number;
  /** (STORE_START_HOUR + 23) % 24。 */
  endHour: number;
  /** false のときフェッチをスキップ（owner/manager×ALL×非today のみ true にする）。 */
  enabled: boolean;
}

export interface UseSalesAcquisitionAllStoresResult {
  /** 店舗名 → 獲得経路内訳。未取得/失敗店は null（過少表示禁止のため 0 埋めしない）。 */
  byName: Record<string, AcquisitionBreakdown | null>;
  /** 取得に失敗した（または未解決だった）店舗名一覧。 */
  failedStores: string[];
  loading: boolean;
  /** /api/locations 自体の失敗のみここに乗る（全文・短縮しない）。店単位の失敗は failedStores 側。 */
  error: string | null;
  /** クランプが効いて「直近92暦日」に縮めた場合 true。 */
  clamped: boolean;
}

/**
 * 1 店ぶんの settle 結果（純関数 buildAcquisitionByName の入力・テスト容易化のため export）。
 * locationId が空文字なら「未解決」= tx/openResult を見ずに null 扱いにする。
 */
export interface StoreAcquisitionSettleInput {
  name: string;
  locationId: string;
  txResult: PromiseSettledResult<unknown> | null;
  openResult: PromiseSettledResult<unknown> | null;
}

/**
 * 店ごとの settle 結果を byName（店舗名 → AcquisitionBreakdown | null）に畳み込む純関数。
 *
 *   - locationId 未解決（空文字）→ null + failedStores。
 *   - tx/open 両方失敗 → null + failedStores。
 *   - 片方成功 → 成功側だけで aggregateSegments().acquisition。
 *   - 両方成功 → 合算して集計。
 */
export function buildAcquisitionByName(
  inputs: StoreAcquisitionSettleInput[],
): { byName: Record<string, AcquisitionBreakdown | null>; failedStores: string[] } {
  const byName: Record<string, AcquisitionBreakdown | null> = {};
  const failedStores: string[] = [];

  for (const input of inputs) {
    if (!input.locationId) {
      byName[input.name] = null;
      failedStores.push(input.name);
      continue;
    }

    const isTxFail = !input.txResult || input.txResult.status === 'rejected';
    const isOpenFail = !input.openResult || input.openResult.status === 'rejected';

    if (isTxFail && isOpenFail) {
      byName[input.name] = null;
      failedStores.push(input.name);
      continue;
    }

    const allTransactions = [
      ...(!isTxFail && input.txResult && input.txResult.status === 'fulfilled'
        ? flattenTxRange(input.txResult.value)
        : []),
      ...(!isOpenFail && input.openResult && input.openResult.status === 'fulfilled'
        ? flattenOpenRange(input.openResult.value)
        : []),
    ];

    byName[input.name] = aggregateSegments(allTransactions).acquisition;
  }

  return { byName, failedStores };
}

const EMPTY_BY_NAME: Record<string, AcquisitionBreakdown | null> = {};
const EMPTY_FAILED: string[] = [];

export function useSalesAcquisitionAllStores(
  args: UseSalesAcquisitionAllStoresArgs,
): UseSalesAcquisitionAllStoresResult {
  const { locationNames, startDate, endDate, startHour, endHour, enabled } = args;

  const active = enabled && locationNames.length > 0 && !!startDate && !!endDate;
  // locationNames は参照が毎レンダー変わり得るため、内容キーで effect 依存を安定化する。
  const namesKey = [...locationNames].sort().join('|');

  const [byName, setByName] = useState<Record<string, AcquisitionBreakdown | null>>(
    EMPTY_BY_NAME,
  );
  const [failedStores, setFailedStores] = useState<string[]>(EMPTY_FAILED);
  const [loading, setLoading] = useState<boolean>(active);
  const [error, setError] = useState<string | null>(null);
  const [clamped, setClamped] = useState<boolean>(false);

  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(async () => {
    if (!active) return;

    const myGeneration = ++generationRef.current;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    // fetch 開始時に旧 data を即クリア（期間/店舗集合切替直後の stale 残存を防ぐ）。
    setByName(EMPTY_BY_NAME);
    setFailedStores(EMPTY_FAILED);
    setError(null);

    const { start, end, clamped: didClamp } = clampAcquisitionRange(startDate, endDate);
    setClamped(didClamp);

    try {
      const locRaw = await squareFetch<{ locations: { id: string; name: string }[] }>(
        '/api/locations',
        { timeoutMs: ACQUISITION_ALL_STORES_TIMEOUT_MS, signal: controller.signal },
      );
      if (myGeneration !== generationRef.current) return; // stale 破棄

      const idMap: Record<string, string> = {};
      for (const loc of locRaw.locations ?? []) idMap[loc.name] = loc.id;

      const settled = await Promise.allSettled(
        locationNames.map(async (name): Promise<StoreAcquisitionSettleInput> => {
          const locationId = idMap[name] ?? '';
          if (!locationId) {
            // 未解決店は fetch せず null 扱い（該当店の 5 列のみ `--`）。
            return { name, locationId: '', txResult: null, openResult: null };
          }
          const params = new URLSearchParams({
            start_date: start,
            end_date: end,
            location_id: locationId,
            start_hour: String(startHour),
            end_hour: String(endHour),
          }).toString();

          const [txResult, openResult] = await Promise.allSettled([
            squareFetch<unknown>(`/api/transactions-range?${params}`, {
              timeoutMs: ACQUISITION_ALL_STORES_TIMEOUT_MS,
              signal: controller.signal,
            }),
            squareFetch<unknown>(`/api/open-orders-range?${params}`, {
              timeoutMs: ACQUISITION_ALL_STORES_TIMEOUT_MS,
              signal: controller.signal,
            }),
          ]);

          return { name, locationId, txResult, openResult };
        }),
      );

      if (myGeneration !== generationRef.current) return; // stale 破棄
      if (controller.signal.aborted) return;

      // 店単位の outer allSettled 自体が reject するのは想定外経路のみだが、
      // 念のため reject された店も未解決扱い（null + failedStores）にして fail-soft を保つ。
      const inputs: StoreAcquisitionSettleInput[] = settled.map((res, i) => {
        if (res.status === 'fulfilled') return res.value;
        const name = locationNames[i];
        const reason = res.reason instanceof Error ? res.reason.message : String(res.reason);
        logger.error(`useSalesAcquisitionAllStores fetch failed (${name}):`, reason);
        return { name, locationId: '', txResult: null, openResult: null };
      });

      const built = buildAcquisitionByName(inputs);
      setByName(built.byName);
      setFailedStores(built.failedStores);
    } catch (err) {
      if (myGeneration !== generationRef.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : String(err);
      logger.error('useSalesAcquisitionAllStores /api/locations failed:', message);
      // /api/locations 自体の失敗は全店 null（過少表示禁止＝不可知として揃える）。
      const allNull: Record<string, AcquisitionBreakdown | null> = {};
      for (const name of locationNames) allNull[name] = null;
      setByName(allNull);
      setFailedStores([...locationNames]);
      setError(message);
    } finally {
      if (myGeneration === generationRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, startDate, endDate, startHour, endHour, namesKey]);

  useEffect(() => {
    if (!active) {
      generationRef.current++;
      if (abortRef.current) abortRef.current.abort();
      setLoading(false);
      setByName(EMPTY_BY_NAME);
      setFailedStores(EMPTY_FAILED);
      setError(null);
      setClamped(false);
      return;
    }

    doFetch();

    return () => {
      generationRef.current++;
      if (abortRef.current) abortRef.current.abort();
    };
  }, [active, doFetch]);

  return { byName, failedStores, loading, error, clamped };
}
