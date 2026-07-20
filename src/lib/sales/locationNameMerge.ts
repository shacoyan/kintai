import { getLocationColors } from './locationColors';
import type { DailySegmentPoint } from './types';
import type { SalesByLocationRow } from '../../hooks/useSalesByLocation';
import type { LocationDailySeries } from '../../hooks/useSalesByLocationDaily';

// =============================================================================
// locationNameMerge — 071/077 の location_name 単位マージ純関数（React 非依存）
// -----------------------------------------------------------------------------
// 設計書 2026-07-21 kintai-sales-dedupe-compare §5 D2〜D4 / §6-B。
//
// 背景: square_dashboard.locations_meta に D-01 移行 Phase A（07-17）で新 Square
// アカウントの 7 店が追加され、旧アカウント 7 店と合わせ同名 14 行が
// is_active=true で並存する。071/077 RPC は location_id GROUP のため、7/25
// 切替を跨ぐ期間では同一店舗が旧 ID 行 + 新 ID 行の 2 行に割れる。DB 側
// （migration/RPC）は無改変のまま、フロントの正規化最終段で location_name を
// キーにマージし、全下流（バー・積上・トレンド・曜日・比較テーブル・YoY 取得）
// が自動的にマージ済みデータを受けるようにする。
//
// D3（色と colorMap キー）: 色の導出キーは locationName に統一する（切替前後で
// 同色）。`getLocationColors([...uniqueNames].sort())` で name→色を決定的に
// 割当てる（sort により 071/077 間の割当を一致させる）。出力契約は温存し、
// 各 row/series の `color` は name 由来色、`colorMap` はマージ後の代表
// locationId をキーに同色を写像する（LocationTrendChart 等の
// `colorMap[loc.locationId]` 参照を無改変で成立させる）。
//
// D4（代表 locationId）: マージ後の locationId は初出行の id（代表 ID）。代表
// ID は 071/077 間で一致を保証しないため、下流での id 突合は禁止（呼び出し側は
// locationName 突合に統一する）。locationName が空文字 '' の行は '' キーで
// 1 グループに畳み、色は FALLBACK（getLocationColors の既存挙動）。
// =============================================================================

/** DailySegmentPoint の date を除く数値フィールド（全 10 個）。 */
const DAILY_SEGMENT_NUMERIC_KEYS = [
  'new',
  'repeat',
  'regular',
  'staff',
  'unlisted',
  'newSales',
  'repeatSales',
  'regularSales',
  'staffSales',
  'unlistedSales',
] as const satisfies readonly (keyof Omit<DailySegmentPoint, 'date'>)[];

function addDailySegmentPoint(
  acc: DailySegmentPoint,
  p: DailySegmentPoint,
): DailySegmentPoint {
  const merged: DailySegmentPoint = { ...acc };
  for (const key of DAILY_SEGMENT_NUMERIC_KEYS) {
    merged[key] = acc[key] + p[key];
  }
  return merged;
}

function emptyDailySegmentPoint(date: string): DailySegmentPoint {
  return {
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
}

/**
 * 071 の店舗別合計行 `SalesByLocationRow[]` を location_name でマージする。
 *
 *   - name group（初出順維持・代表 locationId=初出行の id）。
 *   - totalSales / totalCustomers はグループ内で加算（分配の付け替えであり
 *     全体合計は不変）。
 *   - color は D3 方式（name 由来・sort 済み unique name 集合で決定的に割当）。
 */
export function mergeSalesByLocationRowsByName(
  rows: SalesByLocationRow[],
): SalesByLocationRow[] {
  const order: string[] = [];
  const groups = new Map<
    string,
    { locationId: string; locationName: string; totalSales: number; totalCustomers: number }
  >();

  for (const r of rows) {
    const key = r.locationName;
    const existing = groups.get(key);
    if (existing) {
      existing.totalSales += r.totalSales;
      existing.totalCustomers += r.totalCustomers;
    } else {
      groups.set(key, {
        locationId: r.locationId,
        locationName: r.locationName,
        totalSales: r.totalSales,
        totalCustomers: r.totalCustomers,
      });
      order.push(key);
    }
  }

  const uniqueNames = [...groups.keys()].sort();
  const colorByName = getLocationColors(uniqueNames);

  return order.map((key) => {
    const g = groups.get(key)!;
    return {
      locationId: g.locationId,
      locationName: g.locationName,
      totalSales: g.totalSales,
      totalCustomers: g.totalCustomers,
      color: colorByName[g.locationName],
    };
  });
}

/**
 * 077 の店舗別×日別系列 `LocationDailySeries[]` を location_name でマージする。
 *
 *   - name group（初出順維持・代表 locationId=初出行の id）。
 *   - points は date キーで DailySegmentPoint 全 10 数値フィールドを
 *     フィールド毎加算（同日重複＝切替当日も正しく合算）。date 昇順で返す。
 *   - color / colorMap は D3/D4 方式（colorMap は代表 locationId キー）。
 */
export function mergeLocationDailySeriesByName(
  series: LocationDailySeries[],
): { locationSeries: LocationDailySeries[]; colorMap: Record<string, string> } {
  const order: string[] = [];
  const groups = new Map<
    string,
    { locationId: string; locationName: string; pointsByDate: Map<string, DailySegmentPoint> }
  >();

  for (const s of series) {
    const key = s.locationName;
    let g = groups.get(key);
    if (!g) {
      g = { locationId: s.locationId, locationName: s.locationName, pointsByDate: new Map() };
      groups.set(key, g);
      order.push(key);
    }
    for (const p of s.points) {
      const cur = g.pointsByDate.get(p.date) ?? emptyDailySegmentPoint(p.date);
      g.pointsByDate.set(p.date, addDailySegmentPoint(cur, p));
    }
  }

  const uniqueNames = [...groups.keys()].sort();
  const colorByName = getLocationColors(uniqueNames);
  const colorMap: Record<string, string> = {};

  const locationSeries: LocationDailySeries[] = order.map((key) => {
    const g = groups.get(key)!;
    const color = colorByName[g.locationName];
    colorMap[g.locationId] = color;
    const points = [...g.pointsByDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return {
      locationId: g.locationId,
      locationName: g.locationName,
      color,
      points,
    };
  });

  return { locationSeries, colorMap };
}
