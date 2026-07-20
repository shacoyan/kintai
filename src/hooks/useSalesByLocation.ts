import { useEffect, useMemo, useState } from 'react';
import { logger } from '../lib/logger';
import { formatSupabaseError } from '../lib/errors';
import { supabaseSquare, withSquareSession } from '../lib/supabaseSquare';
import { mergeSalesByLocationRowsByName } from '../lib/sales/locationNameMerge';
import { toFiniteNumber } from '../lib/sales/salesRangeAdapter';
import type { SalesRangeMeta } from '../lib/sales/salesRangeAdapter';

// =============================================================================
// useSalesByLocation — 期間内の店舗別合計を SECURITY DEFINER RPC から取得する hook
// -----------------------------------------------------------------------------
// 設計書 追補B/C（2026-06-09 Loop2）。新 RPC
// `square_dashboard.get_sales_by_location_scoped(p_from, p_to, p_location_names)`
// （migration 071）を `withSquareSession`（authenticated JWT 注入 + fail-closed）
// 経由で 1 回呼び、店舗別合計 rows に整形して返す（owner/manager の店舗別比較
// LocationBarChart 用）。
//
//   - スコープ強制は RPC 内で `get_allowed_location_ids` から再導出（070 と同一）。
//     staff は自店 1 行のみ／他店 inject は構造的に 0 行。フロント再フィルタ不要。
//   - 移植元 `useMultiLocationSegment`（店舗ごとに HTTP 多発）は使わず RPC 1 回。
//   - fail-closed: セッション無し / エラー時は rows=[]・error 設定。
//
// 客数の母数（最重要・2026-05-31 母数不整合バグの byLocation 版再発防止）:
//   `totalCustomers` は 4 セグメント合計（new+repeat+regular+staff）に統一。
//   RPC が返す `customer_count`（ユニーク ID 系）は使わない。本体 §2 と
//   LocationBarChart の客数表示の母数を「表示客数」に一致させる。
//   ※ unlisted（記載なし）は含めない（表示客数 = 4 セグ合計と整合）。
//
// location_name マージ（2026-07-21 D-01 対応）:
//   locations_meta に旧新アカウントの同名 14 行が is_active=true で並存するため、
//   071 が返す行は同一店舗が旧 ID 行 / 新 ID 行の 2 行に割れ得る。normalizeByLocation
//   の最終段で `mergeSalesByLocationRowsByName` を適用し、location_name をキーに
//   totalSales/totalCustomers を加算・1 行に統合する（詳細は locationNameMerge.ts）。
//   色は location_name 由来（切替前後で同色）。locationId は代表 ID（初出行）で
//   071/077 間の一致は保証しない — 下流の id 突合は禁止。
// =============================================================================

export interface SalesByLocationRow {
  /** マージ後の代表 locationId（初出行の id。071/077 間の一致は保証しない）。 */
  locationId: string;
  locationName: string;
  /** 決済済 + 未決済（total_amount + open_total_amount）。本体 total 定義 §3.3 と整合。同名行はマージ加算済み。 */
  totalSales: number;
  /** 4 セグメント合計（new+repeat+regular+staff）。customer_count(ユニークID) は使わない。同名行はマージ加算済み。 */
  totalCustomers: number;
  /** 系列色（location_name 由来の安定色。2026-07-21 D3）。 */
  color: string;
}

export interface UseSalesByLocationArgs {
  /** 開始日 YYYY-MM-DD（営業日基準） */
  from: string;
  /** 終了日 YYYY-MM-DD（営業日基準） */
  to: string;
  /**
   * 閲覧対象の Square location_name 配列。
   * `null` = ALL（許可全店）。owner の全店比較は null。RPC には p_location_names=null。
   */
  locationNames: string[] | null;
  /** false のときフェッチをスキップ（スコープ確定前など）。省略時 true。 */
  enabled?: boolean;
}

export interface UseSalesByLocationResult {
  rows: SalesByLocationRow[];
  meta: SalesRangeMeta | null;
  loading: boolean;
  error: string | null;
}

/** RPC byLocation 行の生型（RPC §B.3 の返り）。すべて optional 防御で受ける。 */
interface RawLocationRow {
  location_id?: string;
  location_name?: string;
  total_amount?: number;
  open_total_amount?: number;
  customer_count?: number;
  new_customer_count?: number;
  repeat_customer_count?: number;
  regular_customer_count?: number;
  staff_customer_count?: number;
  unlisted_customer_count?: number;
}

const EMPTY_META: SalesRangeMeta = {
  source: 'empty',
  location_ids: [],
  live_dates: [],
  aggregate_dates: [],
  future_dates: [],
  use_aggregate: false,
};

/**
 * RPC が返す meta jsonb を `SalesRangeMeta` に正規化する（071 は
 * source/location_ids/use_aggregate/empty のみ返すため欠落を既定値で補う）。
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
 * RPC の返り jsonb を `{ rows, meta }` に正規化する純関数。
 * React 非依存。テスト（母数・スコープ観点）と hook 本体から共有する。
 *
 *   - totalSales     = total_amount + open_total_amount（決済済+未決済）
 *   - totalCustomers = new+repeat+regular+staff（4 セグ合計。customer_count は不使用）
 *   - RPC 側の total_amount DESC 並びを尊重する行構築の後、最終段で
 *     `mergeSalesByLocationRowsByName` により同名行をマージする（初出順維持・
 *     代表 locationId=初出行・色は location_name 由来で決定的に割当）。
 */
export function normalizeByLocation(raw: unknown): {
  rows: SalesByLocationRow[];
  meta: SalesRangeMeta;
} {
  const obj = (raw ?? {}) as { byLocation?: unknown; meta?: unknown };
  const list = Array.isArray(obj.byLocation) ? (obj.byLocation as RawLocationRow[]) : [];

  const preMergeRows: SalesByLocationRow[] = list.map((r) => {
    const locationId = typeof r.location_id === 'string' ? r.location_id : '';
    // B18: 数値正規化を toFiniteNumber 経由にし、数値文字列連結 / null+x=NaN を防ぐ。
    const totalSales =
      toFiniteNumber(r.total_amount) + toFiniteNumber(r.open_total_amount);
    const totalCustomers =
      toFiniteNumber(r.new_customer_count) +
      toFiniteNumber(r.repeat_customer_count) +
      toFiniteNumber(r.regular_customer_count) +
      toFiniteNumber(r.staff_customer_count);
    return {
      locationId,
      locationName: typeof r.location_name === 'string' ? r.location_name : '',
      totalSales,
      totalCustomers,
      color: '', // マージ関数側で location_name 由来色に上書きされる。
    };
  });

  const rows = mergeSalesByLocationRowsByName(preMergeRows);

  return { rows, meta: normalizeMeta(obj.meta) };
}

export function useSalesByLocation(
  args: UseSalesByLocationArgs,
): UseSalesByLocationResult {
  const { from, to, locationNames, enabled = true } = args;

  const [raw, setRaw] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);

  // locationNames は配列参照が毎レンダー変わり得るため、内容で依存キー化する。
  const locKey = locationNames === null ? 'ALL' : [...locationNames].sort().join('|');

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      setLoading(false);
      // stale クリア。rows は useMemo（error||raw==null→[]）に派生するため null で即空になる。
      // owner→staff 切替や enabled=false 時に旧データ（他店含む）の残存表示を防ぐ。
      setRaw(null);
      setError(null);
      return;
    }

    const run = async () => {
      setLoading(true);
      // B17: fetch 開始時に旧 raw を即クリアし、period/店舗切替直後に旧期間データが
      // 1 フレーム見える stale を解消（rows は useMemo で raw==null→[] に即追従）。
      setRaw(null);
      setError(null);
      try {
        const { data: rpcData, error: rpcError } = await withSquareSession(
          async () =>
            await supabaseSquare.rpc('get_sales_by_location_scoped', {
              p_from: from,
              p_to: to,
              // ALL は NULL 相当（RPC が許可全店を合算）。
              p_location_names: locationNames,
            }),
        );
        if (rpcError) throw rpcError;
        if (cancelled) return;
        setRaw(rpcData);
      } catch (err) {
        if (!cancelled) {
          const friendly = formatSupabaseError(err);
          logger.error('useSalesByLocation RPC failed:', friendly);
          // fail-closed: セッション無し / エラー時は空集合を返す。
          setRaw(null);
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

  const { rows, meta } = useMemo(() => {
    // fail-closed: エラー時 / フェッチ前は空 rows。
    if (error || raw == null) return { rows: [] as SalesByLocationRow[], meta: null };
    return normalizeByLocation(raw);
  }, [raw, error]);

  return { rows, meta: meta ?? (error ? EMPTY_META : null), loading, error };
}
