import React, { useMemo } from 'react';
import { Card, ErrorBanner, DashboardSkeleton } from '../ui';
import {
  LocationBarChart,
  LocationStackChart,
  LocationTrendChart,
} from './charts';
import WeekdayLocationAnalysisSection from './WeekdayLocationAnalysisSection';
import type { SalesByLocationRow } from '../../hooks/useSalesByLocation';
import type { DailySegmentPoint, PeriodPreset } from '../../lib/sales/types';

// =============================================================================
// SalesLocationComparison — 店舗別比較セクション（Wave3 B22）
// -----------------------------------------------------------------------------
// owner/manager かつ ALL 選択時のみ SalesPage から配線される統合コンポーネント。
// 見本 square-dashboard/LocationComparisonSection は YoY 行・着座・獲得経路を
// 含む巨大版だが、kintai はデータ源が無いものを描かない「スリム版」を新規作成。
//
// 構成（上から）:
//   1. 店舗別 売上・客数バー   … 071 hook の rows（period 合算・open 込み再ソート）
//   2. 店舗別 お客様構成（積上）… 077 daily の各店 points を全期間合算したセグ別客数
//   3. トレンド（客数）        … 077 daily locationSeries / totalsSeries（showYoY=false 固定）
//   4. トレンド（売上）        … 同上 metric="sales"
//   5. 曜日別分析（店舗別）    … WeekdayLocationAnalysisSection（Engineer C 移植）
//
// daily.loading 中は各チャート枠に Skeleton、daily.error は ErrorBanner（全文表示）。
// LocationBarChart（071）と トレンド/構成/曜日（077）は loading/error を別管理する。
// =============================================================================

// セグメント系列定義（見本同様コンポーネント内に定義）。
// segmentColors と同一値（new#3b82f6 / repeat#eab308 / regular#ef4444 /
// staff#a855f7 / unlisted#6b7280）。
const SEGMENT_SERIES: { key: string; label: string; color: string }[] = [
  { key: 'new', label: '新規', color: '#3b82f6' },
  { key: 'repeat', label: 'リピート', color: '#eab308' },
  { key: 'regular', label: '常連', color: '#ef4444' },
  { key: 'staff', label: 'スタッフ', color: '#a855f7' },
  { key: 'unlisted', label: '記載なし', color: '#6b7280' },
];

interface DailyResult {
  locationSeries: { locationId: string; locationName: string; points: DailySegmentPoint[] }[];
  totalsSeries: DailySegmentPoint[];
  allDates: string[];
  colorMap: Record<string, string>;
  loading: boolean;
  error: string | null;
}

interface Props {
  /** 071 hook の rows（期間合算・既存）。バー＋構成の母数。 */
  byLocRows: SalesByLocationRow[];
  /** 077 hook の返り（日次・トレンド/曜日/構成セグの源）。 */
  daily: DailyResult;
  period: PeriodPreset;
}

const SalesLocationComparison: React.FC<Props> = ({ byLocRows, daily, period }) => {
  // バーは表示棒の高さ（totalSales=決済済+未決済）で再ソート（SalesPage 既存契約と一致）。
  const sortedByLocRows = useMemo(
    () => [...byLocRows].sort((a, b) => b.totalSales - a.totalSales),
    [byLocRows],
  );

  // お客様構成（積み上げ）の rows: 071 rows は 4 セグ合計の totalCustomers しか持たない
  // ため、セグメント別客数は 077 daily の各店 points を全期間合算して作る。
  // 並びはバーと同じく totalSales DESC に寄せる（sortedByLocRows の順）。
  // 突合は locationId で行う（両 RPC とも location_id を契約に含むため、
  // 店舗改名・同名追加でも壊れない）。表示ラベルは locationName のまま。
  const stackRows = useMemo(() => {
    const byId = new Map<string, { new: number; repeat: number; regular: number; staff: number; unlisted: number }>();
    for (const loc of daily.locationSeries) {
      const acc = { new: 0, repeat: 0, regular: 0, staff: 0, unlisted: 0 };
      for (const p of loc.points) {
        acc.new += p.new;
        acc.repeat += p.repeat;
        acc.regular += p.regular;
        acc.staff += p.staff;
        acc.unlisted += p.unlisted;
      }
      byId.set(loc.locationId, acc);
    }
    return sortedByLocRows
      .filter((r) => byId.has(r.locationId))
      .map((r) => {
        const acc = byId.get(r.locationId)!;
        return { locationName: r.locationName, ...acc };
      });
  }, [daily.locationSeries, sortedByLocRows]);

  // 曜日別分析用に locationSeries を { locationId, locationName, dailyTrend } へ詰め替え。
  const weekdayLocationSeries = useMemo(
    () =>
      daily.locationSeries.map((loc) => ({
        locationId: loc.locationId,
        locationName: loc.locationName,
        dailyTrend: loc.points,
      })),
    [daily.locationSeries],
  );

  const dailyError = daily.error;
  const dailyLoading = daily.loading;

  return (
    <div className="space-y-5">
      {/* 1. 店舗別 売上・客数（071 rows・常に表示） */}
      <Card>
        <h2 className="mb-2 text-sm font-semibold text-stone-700 dark:text-stone-200">
          店舗別 売上・客数
        </h2>
        <LocationBarChart rows={sortedByLocRows} />
      </Card>

      {/* 2〜5 は 077 daily 由来。loading/error を束ねて 1 度だけ分岐する。 */}
      {dailyError ? (
        <Card>
          <ErrorBanner message={dailyError} />
        </Card>
      ) : dailyLoading ? (
        <Card>
          <DashboardSkeleton />
        </Card>
      ) : (
        <>
          {/* 2. 店舗別 お客様構成（積み上げ） */}
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-stone-700 dark:text-stone-200">
              店舗別 お客様構成
            </h2>
            <LocationStackChart
              rows={stackRows}
              series={SEGMENT_SERIES}
              valueUnit="人"
              emptyMessage="この期間の店舗別客数データがありません"
            />
          </Card>

          {/* 3. トレンド（客数）。店舗別前年系列は持たないため showYoY=false 固定。 */}
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-stone-700 dark:text-stone-200">
              店舗別トレンド（客数）
            </h2>
            <LocationTrendChart
              locationSeries={daily.locationSeries}
              totalsSeries={daily.totalsSeries}
              allDates={daily.allDates}
              metric="customers"
              colorMap={daily.colorMap}
              period={period}
              showYoY={false}
            />
          </Card>

          {/* 4. トレンド（売上） */}
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-stone-700 dark:text-stone-200">
              店舗別トレンド（売上）
            </h2>
            <LocationTrendChart
              locationSeries={daily.locationSeries}
              totalsSeries={daily.totalsSeries}
              allDates={daily.allDates}
              metric="sales"
              colorMap={daily.colorMap}
              period={period}
              showYoY={false}
            />
          </Card>

          {/* 5. 曜日別分析（店舗別・平均/合計トグル内蔵） */}
          <WeekdayLocationAnalysisSection
            locationSeries={weekdayLocationSeries}
            colorMap={daily.colorMap}
          />
        </>
      )}
    </div>
  );
};

export default SalesLocationComparison;
