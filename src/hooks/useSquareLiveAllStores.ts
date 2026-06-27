import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '../lib/logger';
import { squareFetch } from '../lib/sales/squareLiveClient';
import { MSG } from '../lib/sales/messages';
import { computeDailyTotals } from '../lib/sales/dailyTotals';
import {
  computeMultiStoreDailyTotals,
  type MultiStoreDailyTotals,
  type StoreDailyEntry,
} from '../lib/sales/multiStoreTotals';
import { normalizeLiveSales } from './useSquareLiveSales';
import { normalizeOpenOrders } from './useSquareOpenOrders';

// =============================================================================
// useSquareLiveAllStores — 全店(ALL)×今日 の複数店ライブ取得 hook（要件B）
// -----------------------------------------------------------------------------
// オーナー要件(B): 全店(ALL)選択 × today のとき、許可店舗すべての当日 live を取得し
//   上=全店合計の3カード / 下=店舗別(今日)内訳 を表示する。
//
// 設計上の必須事項:
//   - Rules of Hooks: 店舗ごとに hook をループ呼びしない。本 hook 単体で
//     Promise.allSettled により N 店ぶんを並列取得する（1 店失敗が他店を巻き込まない）。
//   - fail-closed: スコープ外店舗は絶対に取得しない。呼び出し側(SalesPage)が
//     許可店 × id 解決済みの stores のみを渡す契約（本 hook は渡された stores のみ取得）。
//   - 金額の誠実性: 取得失敗店を ¥0 と誤算入しない。各店の error を perStore に保持し、
//     aggregate は computeMultiStoreDailyTotals が失敗店を合計から除外して complete=false
//     で不可知を通知する（過少表示禁止）。
//   - 世代ガード: generationRef で unmount / 引数変更後の setState 競合を捨てる。
//   - 自動更新: today 表示中のみ 60s interval（単店 live hook と統一）。
//   - 既存単店 live hook（useSquareLiveSales / useSquareOpenOrders）は一切触らない。
//     normalize 純関数（normalizeLiveSales / normalizeOpenOrders）と集計純関数
//     （computeDailyTotals / computeMultiStoreDailyTotals）を再利用する。
// =============================================================================

/** 取得対象 1 店（許可済み）。 */
export interface AllStoresStore {
  /** 店舗名（表示・突合用） */
  name: string;
  /**
   * Square location_id。空文字（未解決）でも除外せず渡してよい。
   * 未解決店は本 hook が fetch せず error 付き PerStoreResult にする
   * （complete=false で全店合計を不可知に倒し過少表示を防ぐ）。
   */
  locationId: string;
}

export interface UseSquareLiveAllStoresArgs {
  /** 営業日 today（getBusinessDate(11)）YYYY-MM-DD。 */
  date: string;
  /** 取得対象店舗（許可店すべて。id 未解決店も含めてよい＝失敗扱いで可視化。空配列のとき何もしない）。 */
  stores: AllStoresStore[];
  /** 営業日の日付変更線（JST hour 0-23）。 */
  startHour: number;
  /** 営業日の終端 hour。 */
  endHour: number;
  /** false のときフェッチをスキップ。省略時 true。 */
  enabled?: boolean;
  /**
   * 未決済(OPEN orders)を取得するか。省略時 true（=今日の従来挙動）。
   * false（過去日）のとき各店 /api/open-orders を呼ばず openTotal/openCount=0 とする
   * （未決済は「今この瞬間に未会計の伝票」概念のため今日のみ。過去日は決済済みのみ）。
   */
  includeOpen?: boolean;
}

/** 1 店舗分の取得結果（単店 computeDailyTotals 相当＋取得成否）。 */
export interface PerStoreResult {
  /** 店舗名 */
  storeName: string;
  /** 決済済み売上合計 */
  settledTotal: number;
  /** 決済済み取引件数 */
  settledCount: number;
  /** 未決済(OPEN)売上合計 */
  openTotal: number;
  /** 未決済(OPEN)伝票件数 */
  openCount: number;
  /** 合計売上 = settledTotal + openTotal */
  grandTotal: number;
  /** 合計件数 = settledCount + openCount */
  grandCount: number;
  /** 取得に失敗した場合の全文エラー（成功時 null）。truthy のとき合計から除外される。 */
  error: string | null;
}

export interface UseSquareLiveAllStoresResult {
  /** 店舗別結果（stores の順序を維持） */
  perStore: PerStoreResult[];
  /** 全店合計（失敗店除外・complete/anyError で不可知通知） */
  aggregate: MultiStoreDailyTotals;
  /** いずれかの店舗を取得中 */
  loading: boolean;
  /** いずれかの店舗が取得失敗したか（aggregate.anyError と同値） */
  anyError: boolean;
  /** 最終更新時刻（live 鮮度表示用） */
  lastUpdated: Date | null;
  /** 手動再取得 */
  refresh: () => void;
}

/** 60s（単店 live hook と統一）。 */
const REFRESH_INTERVAL_MS = 60_000;

/** PerStoreResult[] → 集計純関数入力 StoreDailyEntry[] へ詰め替え（error は全文を渡す）。 */
function toEntries(perStore: PerStoreResult[]): StoreDailyEntry[] {
  return perStore.map((p) => ({
    storeName: p.storeName,
    settledTotal: p.settledTotal,
    settledCount: p.settledCount,
    openTotal: p.openTotal,
    openCount: p.openCount,
    error: p.error,
  }));
}

const EMPTY_PER_STORE: PerStoreResult[] = [];
const EMPTY_AGGREGATE = computeMultiStoreDailyTotals(EMPTY_PER_STORE);

export function useSquareLiveAllStores(
  args: UseSquareLiveAllStoresArgs,
): UseSquareLiveAllStoresResult {
  const { date, stores, startHour, endHour, enabled = true, includeOpen = true } = args;

  const active = enabled && !!date && stores.length > 0;

  // stores 配列は呼び出し側 useMemo 依存で参照が変わりうるため、内容のキーで
  // effect 依存を安定化する（name|id のソート不要＝順序維持して結合）。
  // name/id に空白を含んでも衝突しないよう JSON.stringify で曖昧さなく連結する（nit-A）。
  const storesKey = stores.map((s) => JSON.stringify([s.name, s.locationId])).join('');

  const [perStore, setPerStore] = useState<PerStoreResult[]>(EMPTY_PER_STORE);
  const [aggregate, setAggregate] = useState<MultiStoreDailyTotals>(EMPTY_AGGREGATE);
  const [loading, setLoading] = useState<boolean>(active);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const generationRef = useRef(0);

  const doFetch = useCallback(async () => {
    if (!active) return;

    const myGeneration = ++generationRef.current;

    setLoading(true);
    // fetch 開始時に旧 data を即クリア（店舗集合切替直後の stale を解消）。
    setPerStore(EMPTY_PER_STORE);
    setAggregate(EMPTY_AGGREGATE);

    // 各店 1 件分の取得（決済済み + 未決済を並列）。1 店の失敗は allSettled で
    // 他店を巻き込まない。各店内も Promise.all で sales/open-orders 同時取得。
    const results = await Promise.allSettled(
      stores.map(async (store): Promise<PerStoreResult> => {
        // location_id 未解決店は fetch せず失敗扱い（error 付き）にする。
        // computeMultiStoreDailyTotals が合計から除外し complete=false で不可知に倒す
        // ＝未解決店をサイレントに脱落させない（過少表示禁止）。内訳にも事由を明示する。
        if (!store.locationId) {
          return {
            storeName: store.name,
            settledTotal: 0,
            settledCount: 0,
            openTotal: 0,
            openCount: 0,
            grandTotal: 0,
            grandCount: 0,
            error: '店舗IDを解決できませんでした（locations_meta 未登録の可能性があります）',
          };
        }
        const params = new URLSearchParams({
          date,
          location_id: store.locationId,
          start_hour: String(startHour),
          end_hour: String(endHour),
        });
        // 過去日（includeOpen=false）は未決済を取得しない（無駄打ち排除＋概念整合）。
        // 決済済みのみ取得し open=[] で集計＝openTotal/openCount=0。
        // 今日（includeOpen=true）は従来どおり sales/open-orders を並列取得（perf 不変）。
        const [salesRaw, openRaw] = await Promise.all([
          squareFetch<unknown>(`/api/sales?${params.toString()}`),
          includeOpen
            ? squareFetch<unknown>(`/api/open-orders?${params.toString()}`)
            : Promise.resolve(null),
        ]);
        const sales = normalizeLiveSales(salesRaw);
        const openOrders = includeOpen ? normalizeOpenOrders(openRaw) : [];
        // 単店集計は唯一の真実源 computeDailyTotals を再利用（二重計上ゼロ）。
        const t = computeDailyTotals(sales, openOrders);
        return {
          storeName: store.name,
          settledTotal: t.settledTotal,
          settledCount: t.settledCount,
          openTotal: t.openTotal,
          openCount: t.openCount,
          grandTotal: t.grandTotal,
          grandCount: t.grandCount,
          error: null,
        };
      }),
    );

    if (myGeneration !== generationRef.current) return; // stale 世代は破棄

    // allSettled 結果を stores の順序のまま PerStoreResult[] に展開。
    // rejected の店は ¥0 ではなく error を立てる（合計から除外される＝過少表示禁止）。
    const next: PerStoreResult[] = results.map((res, i) => {
      const store = stores[i];
      if (res.status === 'fulfilled') return res.value;
      const reason = res.reason;
      const message =
        reason instanceof Error ? reason.message : String(reason ?? MSG.error.sales);
      logger.error(`useSquareLiveAllStores fetch failed (${store.name}):`, message);
      return {
        storeName: store.name,
        settledTotal: 0,
        settledCount: 0,
        openTotal: 0,
        openCount: 0,
        grandTotal: 0,
        grandCount: 0,
        error: message,
      };
    });

    setPerStore(next);
    setAggregate(computeMultiStoreDailyTotals(toEntries(next)));
    setLastUpdated(new Date());
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, date, startHour, endHour, storesKey, includeOpen]);

  useEffect(() => {
    if (!active) {
      // enabled=false / 店舗なし → 何もしない（stale クリア）。
      generationRef.current++;
      setLoading(false);
      setPerStore(EMPTY_PER_STORE);
      setAggregate(EMPTY_AGGREGATE);
      setLastUpdated(null);
      return;
    }

    doFetch();

    // today 表示中のみ 60s 自動更新。
    const interval = setInterval(doFetch, REFRESH_INTERVAL_MS);
    return () => {
      generationRef.current++;
      clearInterval(interval);
    };
  }, [active, doFetch]);

  return {
    perStore,
    aggregate,
    loading,
    anyError: aggregate.anyError,
    lastUpdated,
    refresh: doFetch,
  };
}
