import React, { useEffect, useMemo, useState } from 'react';
import { useSalesScope } from '../hooks/useSalesScope';
import { useSalesSegment } from '../hooks/useSalesSegment';
import { useSalesYoY } from '../hooks/useSalesYoY';
import { useSalesByLocation } from '../hooks/useSalesByLocation';
import {
  Card,
  PageLoader,
  EmptyState,
  ErrorBanner,
  StatCard,
  type StatCardTrend,
  DashboardSkeleton,
} from '../components/ui';
import { PeriodSelector } from '../components/sales/ui';
import {
  SegmentPieChart,
  SegmentTrendChart,
  AcquisitionChart,
  LocationBarChart,
} from '../components/sales/charts';
import { formatYen } from '../components/sales/utils';
import { getBusinessDate } from '../lib/sales/businessDate';
import { calculatePeriodDates, getMonthWeekCount } from '../lib/sales/periodDates';
import type { PeriodPreset } from '../lib/sales/types';
import type { YoYDelta, DailyTotalPoint, SalesRangeYoYResult } from '../lib/sales/yoy';

// =============================================================================
// SalesPage — Square 売上ダッシュボード（Loop2 本体配線 / 設計書 §4.2 + 追補E）
// -----------------------------------------------------------------------------
// useSalesScope() で閲覧スコープ（許可 location 名集合 / 全店可否）を取得し、
// 期間セレクタと店舗セレクタの選択から from/to/baseDate を一度算出して 3 hook
// （useSalesSegment / useSalesYoY / useSalesByLocation）に共有する。
//
//   - canViewAll（owner / manager）→「全店（ALL）」+ allowedLocationNames
//   - staff（canViewAll=false）   → allowedLocationNames（自店）のみ。
//     セレクタの選択肢も allowedLocationNames に限定（他店が出ない fail-closed）。
//   - 店舗別比較（LocationBarChart）は owner/manager かつ ALL 選択時のみ表示。
//   - YoY（前年比）は前年データ十分時のみ系列を描く（no_data は「—」表示）。
//   - error は全文表示（短縮禁止＝MEMORY ルール）。
// =============================================================================

const ALL_VALUE = '__ALL__';
// SABABA 全 7 店は営業開始 11:00（営業日区切り 11 時）。
const STORE_START_HOUR = 11;

/**
 * YoY 系列を描いてよいか（前年データが十分にあるとき）。
 * 前年が no_data（buildYoYResultFromResponses が lastYear=null 化）なら false。
 * SegmentTrendChart 側でも period='week'/'today' は内部抑制されるため二重防御。
 */
function canShowYoY(yoy: SalesRangeYoYResult | null): boolean {
  return !!yoy && yoy.lastYear !== null;
}

/** YoYDelta → StatCardTrend（no_data はバッジ非表示＝undefined）。 */
function toTrend(delta: YoYDelta | undefined): StatCardTrend | undefined {
  if (!delta) return undefined;
  switch (delta.classification) {
    case 'up':
      return { direction: 'up', value: `+${delta.deltaPercent!.toFixed(1)}%`, label: '前年比' };
    case 'down':
      return { direction: 'down', value: `${delta.deltaPercent!.toFixed(1)}%`, label: '前年比' };
    case 'flat':
      return { direction: 'flat', value: '±0.0%', label: '前年比' };
    case 'no_data':
    default:
      // 前年データなし → バッジ非表示（KPI 値はそのまま出す）。
      return undefined;
  }
}

/**
 * YoY 結果の byDate（前年セグメント別客数）から SegmentTrendChart 用の
 * 前年合計系列（人数 = 新規+リピート+常連+スタッフ）を組む。
 * total は表示客数と同母数の 4 セグ合計（customer_count ユニーク ID は使わない）。
 * currentDate を持たせるので、チャート側は前年日付ではなく当年日付に重ねる。
 */
function buildLastYearHeadcountSeries(yoy: SalesRangeYoYResult | null): DailyTotalPoint[] {
  if (!yoy || yoy.lastYear === null) return [];
  const series: DailyTotalPoint[] = [];
  for (const row of yoy.byDate) {
    if (!row.lastYear) continue;
    const ly = row.lastYear;
    const total =
      (ly.new_customer_count ?? 0) +
      (ly.repeat_customer_count ?? 0) +
      (ly.regular_customer_count ?? 0) +
      (ly.staff_customer_count ?? 0);
    series.push({ date: row.lastYearDate, currentDate: row.business_date, total });
  }
  return series;
}

export const SalesPage: React.FC = () => {
  const { allowedLocationNames, canViewAll, loading: scopeLoading } = useSalesScope();

  // --- 店舗セレクタ（選択肢は許可店舗に限定。staff は自店のみ＝他店が出ない）---
  const options = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    if (canViewAll) {
      opts.push({ value: ALL_VALUE, label: '全店（ALL）' });
    }
    for (const name of allowedLocationNames) {
      opts.push({ value: name, label: name });
    }
    return opts;
  }, [canViewAll, allowedLocationNames]);

  const [selected, setSelected] = useState<string>('');

  useEffect(() => {
    if (scopeLoading) return;
    if (options.length === 0) {
      setSelected('');
      return;
    }
    if (!options.some((o) => o.value === selected)) {
      setSelected(canViewAll ? ALL_VALUE : options[0].value);
    }
  }, [scopeLoading, options, selected, canViewAll]);

  // --- 期間セレクタ ---
  const [period, setPeriod] = useState<PeriodPreset>('month');
  const [weekIndex, setWeekIndex] = useState<number>(1);
  const [quarterIndex, setQuarterIndex] = useState<number>(1);

  // 営業日基準の「今日」（getBusinessDate(11)）。elapsedDays・期間上限の基準。
  const baseDate = useMemo(() => getBusinessDate(STORE_START_HOUR), []);

  // week 選択肢数（baseDate の年月内の月曜起算週数）。
  const availableWeeks = useMemo(() => {
    const [by, bm] = baseDate.split('-').map(Number);
    return getMonthWeekCount(by, bm);
  }, [baseDate]);

  // --- dates（from/to）を一度だけ算出して 3 hook に共有（二重計算・期間ズレ防止）---
  const { from, to } = useMemo(() => {
    const dates = calculatePeriodDates(
      period,
      baseDate,
      period === 'week' ? weekIndex : undefined,
      period === 'quarter' ? quarterIndex : undefined,
      STORE_START_HOUR,
    );
    if (dates.length === 0) return { from: baseDate, to: baseDate };
    return { from: dates[0], to: dates[dates.length - 1] };
  }, [period, baseDate, weekIndex, quarterIndex]);

  // locationNames: ALL=null（許可全店合算）/ 単店=[name]。
  const locationNames = useMemo<string[] | null>(
    () => (selected === ALL_VALUE ? null : selected ? [selected] : null),
    [selected],
  );

  // スコープ確定かつ選択あり、のときだけフェッチ（無駄打ち・誤「データなし」防止）。
  const scopeReady =
    !scopeLoading && allowedLocationNames.length > 0 && selected !== '';

  // 店舗別比較は owner/manager かつ ALL 選択時のみ（複数店を全店で見るときだけ意味）。
  const showLocationCompare = canViewAll && locationNames === null;

  // --- 3 hook（from/to/baseDate を共有）---
  const segment = useSalesSegment({
    from,
    to,
    period,
    baseDate,
    locationNames,
    enabled: scopeReady,
  });

  // YoY を描くのは month/quarter/year のみ（week/today は SegmentTrendChart 側でも抑制）。
  // それ以外の period では前年同期 RPC を投げない（無駄フェッチ抑止）。
  const yoyApplicable = period === 'month' || period === 'quarter' || period === 'year';

  const yoy = useSalesYoY({
    from,
    to,
    locationNames,
    enabled: scopeReady && yoyApplicable,
  });

  const byLoc = useSalesByLocation({
    from,
    to,
    locationNames: null,
    enabled: scopeReady && showLocationCompare,
  });

  // --- 前年比バッジ・YoY 系列の導出 ---
  // yoy.loading 中は stale な前年値を出さない（前年比バッジ・前年系列を抑制）。
  // loading が明けて新範囲の data が確定してから表示する。
  const yoyReady = !yoy.loading;
  const yoyData = yoyReady ? yoy.data : null;
  // yoyApplicable を唯一のゲートにする単一情報源。week/today では確実に null となり、
  // 前回 month の前年比が KPI バッジに残存するのを防ぐ。
  const effectiveYoY = yoyApplicable ? yoyData : null;
  const showYoY = canShowYoY(effectiveYoY);
  const lastYearSeries = useMemo(() => buildLastYearHeadcountSeries(effectiveYoY), [effectiveYoY]);

  const salesTrend = toTrend(effectiveYoY?.yoy.total_amount);
  const customerTrend = toTrend(effectiveYoY?.yoy.customer_count);

  // 店舗別比較は表示棒の高さ（totalSales=決済済+未決済）と並びを一致させる。
  // RPC は total_amount(決済済)のみ DESC で返すため、open 込みの totalSales で再ソートする。
  // normalizeByLocation の契約（再ソートしない）は保持し、表示直前でのみ並べ替える。
  const sortedLocationRows = useMemo(
    () => [...byLoc.rows].sort((a, b) => b.totalSales - a.totalSales),
    [byLoc.rows],
  );

  if (scopeLoading) {
    return <PageLoader variant="screen" label="読み込み中" />;
  }

  const data = segment.data;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-stone-900 dark:text-stone-100">売上</h1>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Square 売上ダッシュボード（前日まで集計）
            </p>
          </div>

          {allowedLocationNames.length > 0 && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="sales-store-select"
                className="text-sm text-stone-600 dark:text-stone-300"
              >
                店舗
              </label>
              <select
                id="sales-store-select"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {allowedLocationNames.length > 0 && (
          <PeriodSelector
            period={period}
            onPeriodChange={setPeriod}
            weekIndex={weekIndex}
            onWeekIndexChange={setWeekIndex}
            availableWeeks={availableWeeks}
            quarterIndex={quarterIndex}
            onQuarterIndexChange={setQuarterIndex}
          />
        )}
      </header>

      {allowedLocationNames.length === 0 ? (
        <EmptyState
          title="対象店舗の売上データがありません"
          description="閲覧可能な Square 店舗が見つかりませんでした。"
        />
      ) : segment.error ? (
        // error は全文表示（短縮しない＝MEMORY ルール）。
        <ErrorBanner message={segment.error} />
      ) : segment.loading ? (
        <DashboardSkeleton />
      ) : !data || segment.meta?.empty === true || segment.meta?.source === 'empty' ? (
        <EmptyState
          title="この期間の売上データがありません"
          description="選択した期間・店舗に集計済みの売上が見つかりませんでした。"
        />
      ) : (
        <div className="space-y-5">
          {/* KPI 行（前年比バッジ付き） */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="合計売上" value={formatYen(data.totalSales)} trend={salesTrend} />
            <StatCard label="客数" value={data.totalCustomers} unit="人" trend={customerTrend} />
            <StatCard
              label="客単価"
              value={
                data.overallAveragePerCustomer === null
                  ? null
                  : formatYen(Math.round(data.overallAveragePerCustomer))
              }
            />
            <StatCard
              label="1日平均売上"
              value={
                data.averageDailySales === null
                  ? null
                  : formatYen(Math.round(data.averageDailySales))
              }
            />
          </div>

          {/* セグメント（売上構成の円） */}
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-stone-700 dark:text-stone-200">
              売上構成（セグメント別）
            </h2>
            <SegmentPieChart sales={data.salesBySegment} />
          </Card>

          {/* トレンド（前年系列は十分時のみ） */}
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-stone-700 dark:text-stone-200">
              日次推移
            </h2>
            <SegmentTrendChart
              data={data.dailyTrend}
              period={period}
              showYoY={showYoY}
              lastYearTotalsSeries={lastYearSeries}
            />
          </Card>

          {/* 獲得経路（新規客） */}
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-stone-700 dark:text-stone-200">
              新規客の獲得経路
            </h2>
            <AcquisitionChart data={data.acquisitionBreakdown} />
          </Card>

          {/* 店舗別比較（owner/manager かつ ALL 選択時のみ） */}
          {showLocationCompare && (
            <Card>
              <h2 className="mb-2 text-sm font-semibold text-stone-700 dark:text-stone-200">
                店舗別比較
              </h2>
              {byLoc.error ? (
                <ErrorBanner message={byLoc.error} />
              ) : byLoc.loading ? (
                <DashboardSkeleton />
              ) : (
                <LocationBarChart rows={sortedLocationRows} />
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
};

export default SalesPage;
