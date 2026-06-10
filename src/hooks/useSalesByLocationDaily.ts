import { useEffect, useMemo, useState } from 'react';
import { logger } from '../lib/logger';
import { formatSupabaseError } from '../lib/errors';
import { supabaseSquare, withSquareSession } from '../lib/supabaseSquare';
import { getLocationColors } from '../lib/sales/locationColors';
import {
  dayMetricsToTrendPoint,
  toFiniteNumber,
} from '../lib/sales/salesRangeAdapter';
import type { SalesRangeDay } from '../lib/sales/salesRangeAdapter';
import type { DailySegmentPoint } from '../lib/sales/types';

// =============================================================================
// useSalesByLocationDaily — 店舗別 × 日別トレンドを SECURITY DEFINER RPC から取得
// -----------------------------------------------------------------------------
// 設計書 Wave3（2026-06-10）§3.1。新 RPC
// `square_dashboard.get_sales_by_location_daily_scoped(p_from, p_to, p_location_names)`
// （migration 077）を `withSquareSession`（authenticated JWT 注入 + fail-closed）
// 経由で 1 回呼び、店舗別×日別 DailySegmentPoint 系列に整形して返す
// （LocationTrendChart / WeekdayLocationAnalysisSection 用）。
//
//   - 雛形は 071 hook（useSalesByLocation）。スコープ強制は RPC 内の
//     get_allowed_location_ids 再導出（070/071 と同一）。フロント再フィルタ不要。
//   - 070/071 を温存し、店舗別×日別を返す追加 RPC（categories は含まない＝軽量）。
//   - fail-closed: enabled=false / セッション無し / エラー時は空集合
//     （locationSeries=[]・totalsSeries=[]・allDates=[]）。
//   - stale クリア: fetch 開始時に raw=null（B2/B17 と同方式。period/店舗切替直後の
//     旧期間データが 1 フレーム見える残存を解消）。
//
// 客数の母数（2026-05-31 母数不整合バグ再発防止）:
//   各 day の客数は 4(5) セグの個別フィールドをそのまま DailySegmentPoint に載せる
//   （dayMetricsToTrendPoint）。RPC が返す customer_count（ユニーク ID 系）は使わない。
//   売上は new/repeat/regular/staff/unlisted の各 *_sales をそのまま載せる（open 込みの
//   合計はトレンド系列のセグ売上合算で構成）。
// =============================================================================

export interface UseSalesByLocationDailyArgs {
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

export interface LocationDailySeries {
  locationId: string;
  locationName: string;
  /** 系列色（location_id 由来の安定色）。 */
  color: string;
  points: DailySegmentPoint[];
}

export interface UseSalesByLocationDailyResult {
  locationSeries: LocationDailySeries[];
  /** allDates ごとに全店 points をフィールド合算した日別合計系列。 */
  totalsSeries: DailySegmentPoint[];
  /** 全店横断の日付キー集合（昇順 distinct）。 */
  allDates: string[];
  /** location_id → 色のマップ（B13 衝突回避版）。 */
  colorMap: Record<string, string>;
  loading: boolean;
  error: string | null;
}

/** RPC byLocationDaily の per-day 生型（070 byDate の per-day と同型。categories 除く）。 */
interface RawDay {
  total_amount?: number;
  open_total_amount?: number;
  new_customer_count?: number;
  repeat_customer_count?: number;
  regular_customer_count?: number;
  staff_customer_count?: number;
  unlisted_customer_count?: number;
  new_sales?: number;
  repeat_sales?: number;
  regular_sales?: number;
  staff_sales?: number;
  unlisted_sales?: number;
  transaction_count?: number;
  customer_count?: number;
  open_order_count?: number;
}

/** RPC byLocationDaily の店舗行の生型。すべて optional 防御で受ける。 */
interface RawLocationDaily {
  location_id?: string;
  location_name?: string;
  days?: Record<string, RawDay> | null;
}

const EMPTY_RESULT = {
  locationSeries: [] as LocationDailySeries[],
  totalsSeries: [] as DailySegmentPoint[],
  allDates: [] as string[],
  colorMap: {} as Record<string, string>,
};

/**
 * RawDay を toFiniteNumber 経由で SalesRangeDay 化する（B18: NaN 伝播防止）。
 * categories は byLocationDaily に含まれないため省略。
 */
function rawDayToSalesRangeDay(raw: RawDay): SalesRangeDay {
  return {
    total_amount: toFiniteNumber(raw.total_amount),
    transaction_count: toFiniteNumber(raw.transaction_count),
    customer_count: toFiniteNumber(raw.customer_count),
    new_customer_count: toFiniteNumber(raw.new_customer_count),
    repeat_customer_count: toFiniteNumber(raw.repeat_customer_count),
    regular_customer_count: toFiniteNumber(raw.regular_customer_count),
    staff_customer_count: toFiniteNumber(raw.staff_customer_count),
    unlisted_customer_count: toFiniteNumber(raw.unlisted_customer_count),
    new_sales: toFiniteNumber(raw.new_sales),
    repeat_sales: toFiniteNumber(raw.repeat_sales),
    regular_sales: toFiniteNumber(raw.regular_sales),
    staff_sales: toFiniteNumber(raw.staff_sales),
    unlisted_sales: toFiniteNumber(raw.unlisted_sales),
    open_total_amount: toFiniteNumber(raw.open_total_amount),
    open_order_count: toFiniteNumber(raw.open_order_count),
  };
}

/**
 * RPC の返り jsonb を `{ locationSeries, totalsSeries, allDates, colorMap }` に
 * 正規化する純関数。React 非依存。テストと hook 本体から共有する。
 *
 *   - 各店の days を date 昇順に並べ、各 day を dayMetricsToTrendPoint で
 *     DailySegmentPoint 化 → points（数値は toFiniteNumber 経由で NaN 防止）。
 *   - totalsSeries = allDates ごとに全店 points をフィールド合算（new..unlistedSales）。
 *   - allDates は RPC の allDates を尊重しつつ、欠落時は全店 days のキー和集合を昇順 distinct。
 *   - colorMap = getLocationColors(byLocationDaily の location_id 配列)（B13 衝突回避）。
 */
export function normalizeByLocationDaily(raw: unknown): {
  locationSeries: LocationDailySeries[];
  totalsSeries: DailySegmentPoint[];
  allDates: string[];
  colorMap: Record<string, string>;
} {
  const obj = (raw ?? {}) as {
    byLocationDaily?: unknown;
    allDates?: unknown;
  };
  const list = Array.isArray(obj.byLocationDaily)
    ? (obj.byLocationDaily as RawLocationDaily[])
    : [];

  if (list.length === 0) {
    return { ...EMPTY_RESULT };
  }

  // B13: 表示 location 全体に getLocationColors を 1 回適用（djb2 hash 衝突を相異化）。
  const ids = list.map((r) => (typeof r.location_id === 'string' ? r.location_id : ''));
  const colorMap = getLocationColors(ids);

  // allDates: RPC 値を尊重。欠落時は全店 days キーの和集合を昇順 distinct で再構築。
  let allDates: string[];
  if (Array.isArray(obj.allDates) && obj.allDates.every((d) => typeof d === 'string')) {
    allDates = [...new Set(obj.allDates as string[])].sort();
  } else {
    const dateSet = new Set<string>();
    for (const r of list) {
      const days = r.days ?? {};
      for (const d of Object.keys(days)) dateSet.add(d);
    }
    allDates = [...dateSet].sort();
  }

  const locationSeries: LocationDailySeries[] = list.map((r) => {
    const locationId = typeof r.location_id === 'string' ? r.location_id : '';
    const days = r.days ?? {};
    const sortedDates = Object.keys(days).sort();
    const points: DailySegmentPoint[] = sortedDates.map((date) =>
      dayMetricsToTrendPoint(date, rawDayToSalesRangeDay(days[date] ?? {})),
    );
    return {
      locationId,
      locationName: typeof r.location_name === 'string' ? r.location_name : '',
      color: colorMap[locationId],
      points,
    };
  });

  // totalsSeries: allDates ごとに全店 points をフィールド合算。
  // 日付→DailySegmentPoint の索引を店舗ごとに作って高速合算。
  const perLocationByDate = locationSeries.map((s) => {
    const m = new Map<string, DailySegmentPoint>();
    for (const p of s.points) m.set(p.date, p);
    return m;
  });

  const totalsSeries: DailySegmentPoint[] = allDates.map((date) => {
    const acc: DailySegmentPoint = {
      date,
      new: 0,
      repeat: 0,
      regular: 0,
      staff: 0,
      unlisted: 0,
      newSales: 0,
      repeatSales: 0,
      regularSales: 0,
      staffSales: 0,
      unlistedSales: 0,
    };
    for (const m of perLocationByDate) {
      const p = m.get(date);
      if (!p) continue;
      acc.new += p.new;
      acc.repeat += p.repeat;
      acc.regular += p.regular;
      acc.staff += p.staff;
      acc.unlisted += p.unlisted;
      acc.newSales += p.newSales;
      acc.repeatSales += p.repeatSales;
      acc.regularSales += p.regularSales;
      acc.staffSales += p.staffSales;
      acc.unlistedSales += p.unlistedSales;
    }
    return acc;
  });

  return { locationSeries, totalsSeries, allDates, colorMap };
}

export function useSalesByLocationDaily(
  args: UseSalesByLocationDailyArgs,
): UseSalesByLocationDailyResult {
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
      // stale クリア。派生（error||raw==null→空）に null で即追従。
      setRaw(null);
      setError(null);
      return;
    }

    const run = async () => {
      setLoading(true);
      // B17: fetch 開始時に旧 raw を即クリア（period/店舗切替直後の stale 解消）。
      setRaw(null);
      setError(null);
      try {
        const { data: rpcData, error: rpcError } = await withSquareSession(
          async () =>
            await supabaseSquare.rpc('get_sales_by_location_daily_scoped', {
              p_from: from,
              p_to: to,
              // ALL は NULL 相当（RPC が許可全店を集計）。
              p_location_names: locationNames,
            }),
        );
        if (rpcError) throw rpcError;
        if (cancelled) return;
        setRaw(rpcData);
      } catch (err) {
        if (!cancelled) {
          const friendly = formatSupabaseError(err);
          logger.error('useSalesByLocationDaily RPC failed:', friendly);
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

  const { locationSeries, totalsSeries, allDates, colorMap } = useMemo(() => {
    // fail-closed: エラー時 / フェッチ前は空集合。
    if (error || raw == null) return { ...EMPTY_RESULT };
    return normalizeByLocationDaily(raw);
  }, [raw, error]);

  return { locationSeries, totalsSeries, allDates, colorMap, loading, error };
}
