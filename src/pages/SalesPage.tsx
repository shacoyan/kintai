import React, { useEffect, useMemo, useState } from 'react';
import { useSalesScope } from '../hooks/useSalesScope';
import { useSalesSegment } from '../hooks/useSalesSegment';
import { useSalesYoY } from '../hooks/useSalesYoY';
import { useSalesByLocation } from '../hooks/useSalesByLocation';
import { useSalesByLocationDaily } from '../hooks/useSalesByLocationDaily';
import { useSquareLiveSales } from '../hooks/useSquareLiveSales';
import { useSquareOpenOrders } from '../hooks/useSquareOpenOrders';
import { useSalesAcquisitionLive } from '../hooks/useSalesAcquisitionLive';
import { squareFetch } from '../lib/sales/squareLiveClient';
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
import DailyLiveSection from '../components/sales/DailyLiveSection';
import {
  SegmentPieChart,
  SegmentTrendChart,
  AcquisitionChart,
  WeekdayBarChart,
} from '../components/sales/charts';
import SalesLocationComparison from '../components/sales/SalesLocationComparison';
import OccupancyAnalysisSection from '../components/sales/OccupancyAnalysisSection';
import SegmentBreakdownList from '../components/sales/SegmentBreakdownList';
import { formatYen } from '../components/sales/utils';
import { getBusinessDate } from '../lib/sales/businessDate';
import { calculatePeriodDates, getMonthWeekCount, currentWeekIndex } from '../lib/sales/periodDates';
import { granularityFor, cardTitleByGranularity } from '../lib/sales/trendAggregation';
import { aggregateByWeekday } from '../lib/sales/weekdayAggregation';
import type { PeriodPreset } from '../lib/sales/types';
import { calculateYoY } from '../lib/sales/yoy';
import type { YoYDelta, DailyTotalPoint, SalesRangeYoYResult } from '../lib/sales/yoy';
import { computeAvgDailyYoY } from '../lib/sales/avgDailyYoY';

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

// セグメント別 KPI カードのラベル定義（B7）。new/repeat/regular/staff=客数+YoY、
// unlisted=売上額のみ（YoY なし）。yoy.data に unlisted 客数 YoY が無いため出さない。
const SEGMENT_LABELS = [
  { key: 'new', label: '新規' },
  { key: 'repeat', label: 'リピート' },
  { key: 'regular', label: '常連' },
  { key: 'staff', label: 'スタッフ' },
  { key: 'unlisted', label: '記載なし' },
] as const;

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
  // 営業日基準の「今日」（getBusinessDate(11)）。elapsedDays・期間上限の基準。
  // マウント時 1 回確定（週/四半期の初期選択にも使うため useState より前に算出）。
  const baseDate = useMemo(() => getBusinessDate(STORE_START_HOUR), []);

  // week 選択肢数（baseDate の年月内の月曜起算週数）。
  const availableWeeks = useMemo(() => {
    const [by, bm] = baseDate.split('-').map(Number);
    return getMonthWeekCount(by, bm);
  }, [baseDate]);

  const [period, setPeriod] = useState<PeriodPreset>('month');
  // B4: 週/四半期の初期選択を baseDate（営業日 today）の現在週・現在四半期に lazy init。
  const [weekIndex, setWeekIndex] = useState<number>(() => {
    // 正本 calculatePeriodDates の week 省略時 effectiveIndex と同一式（B4）。
    const [by0, bm0, bd0] = baseDate.split('-').map(Number);
    return currentWeekIndex(by0, bm0, bd0);
  });
  const [quarterIndex, setQuarterIndex] = useState<number>(() => {
    const [, bm0] = baseDate.split('-').map(Number);
    return Math.floor((bm0 - 1) / 3) + 1;
  });

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

  // --- 当日 live（W4-P1 / 設計書 §4.3.3）---
  // period==='today' のとき RPC 集計（前日まで確定）の代わりに Square live を表示する。
  // RPC 経路は今日では enabled=false（無駄打ち停止）。他 period は完全に現状不変。
  const isToday = period === 'today';

  // ALL（全店）+ today は live が店舗単位のため未対応 → 単店選択を促す（P1 は合算しない）。
  const isAllToday = isToday && locationNames === null;
  // 単店選択時の Square location_name。live の location_id 解決キー。
  const selectedLocationName = useMemo<string | null>(
    () => (locationNames && locationNames.length === 1 ? locationNames[0] : null),
    [locationNames],
  );

  // /api/locations を 1 回呼んで name→id マップを作る（locations.js は P1 で移植済）。
  // today 表示かつ単店選択時のみ取得（owner ALL / 非 today では往復しない）。
  const [locationIdMap, setLocationIdMap] = useState<Record<string, string>>({});
  const [locationsError, setLocationsError] = useState<string | null>(null);
  // Square location_id が要るのは (a) today live/open-orders と (b) 非 today 単店の
  // acquisition live 補完（§4.1.3）。どちらも単店選択時のみ。ALL では往復しない。
  const needLocationId = scopeReady && selectedLocationName !== null;
  useEffect(() => {
    if (!needLocationId) return;
    let cancelled = false;
    setLocationsError(null);
    squareFetch<{ locations: { id: string; name: string }[] }>('/api/locations')
      .then((res) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const loc of res.locations ?? []) map[loc.name] = loc.id;
        setLocationIdMap(map);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // error は全文表示（短縮しない＝MEMORY ルール）。
        setLocationsError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [needLocationId]);

  const selectedLocationId = selectedLocationName
    ? locationIdMap[selectedLocationName] ?? null
    : null;

  // 当日 live（決済済み売上 + 取引一覧）。単店選択かつ id 解決済みのときのみ起動。
  const live = useSquareLiveSales({
    date: baseDate,
    // 契約は non-null。未解決時は空文字 + enabled=false で hook 側が「何もしない」。
    locationId: selectedLocationId ?? '',
    startHour: STORE_START_HOUR,
    // 営業日はフル 24h (11:00〜翌10:59)。api 側 parseTimeRange は endHour < startHour の
    // ときのみ翌日扱いになるため、endHour=STORE_START_HOUR(11) だと 11:00〜11:59 の
    // 59分しか取得できない。Dashboard.tsx と同式の (start+23)%24 (=10) で翌日 10:59 までを表現する。
    endHour: (STORE_START_HOUR + 23) % 24,
    enabled: scopeReady && isToday && selectedLocationId !== null,
  });

  // 当日 未会計伝票（OPEN orders）。today 単店選択かつ id 解決済みのときのみ起動（§4.3.4）。
  const liveOpenOrders = useSquareOpenOrders({
    date: baseDate,
    locationId: selectedLocationId ?? '',
    startHour: STORE_START_HOUR,
    endHour: (STORE_START_HOUR + 23) % 24,
    enabled: scopeReady && isToday && selectedLocationId !== null,
  });

  // 獲得経路 live 補完（§4.1.3）。非 today × 単店選択 × id 解決済みのときのみ起動。
  // ALL/today は従来どおり（acquisition は RPC の既定ゼロ or live セクション）。
  // acquisition だけを実数で上書きし、売上/客数/トレンドは RPC（segment.data）不変。
  const acquisitionLive = useSalesAcquisitionLive({
    startDate: from,
    endDate: to,
    locationId: selectedLocationId ?? '',
    startHour: STORE_START_HOUR,
    endHour: (STORE_START_HOUR + 23) % 24,
    enabled: scopeReady && !isToday && selectedLocationId !== null,
  });

  // --- 3 hook（from/to/baseDate を共有）---
  // today は live 経路へ切替えるため RPC 集計系を停止（enabled=false）。
  const segment = useSalesSegment({
    from,
    to,
    period,
    baseDate,
    locationNames,
    enabled: scopeReady && !isToday,
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
    enabled: scopeReady && !isToday && showLocationCompare,
  });

  // 077 RPC（店舗別日次）。owner ALL かつ比較セクション表示時のみフェッチ
  // （staff・単店選択では往復しない）。トレンド/曜日/構成セグの源。
  const byLocDaily = useSalesByLocationDaily({
    from,
    to,
    locationNames: null,
    enabled: scopeReady && !isToday && showLocationCompare,
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

  // B6: 客単価の YoY バッジ（表示値は据置・バッジのみ付与）。
  // 当年/前年の perCustomer を yoy.current / yoy.lastYear から算出する。
  // 売上は open 込み（total_amount + open_total_amount）でカード表示値（totalSales）と母数を
  // 揃える（B6）。客数母数は 4 セグ合計（new+repeat+regular+staff）に統一（unique customer_count
  // は使わない）。
  // NOTE: avgDaily（1日平均売上）の YoY は前年母数の集合整合（当年/前年で日数集合を揃える）が
  // 要るため、ここでは付与せず別Loop（displayMetrics 統一）で正しく再実装する。
  const derivedYoY = useMemo<{ perCustomer: YoYDelta | null }>(() => {
    const y = effectiveYoY;
    if (!y) return { perCustomer: null };
    const curTotal = y.current.total_amount + y.current.open_total_amount;
    const curSeg =
      y.current.new_customer_count +
      y.current.repeat_customer_count +
      y.current.regular_customer_count +
      y.current.staff_customer_count;
    const curPerCustomer = curSeg > 0 ? curTotal / curSeg : null;
    const lyTotal = y.lastYear
      ? y.lastYear.total_amount + y.lastYear.open_total_amount
      : null;
    const lySeg = y.lastYear
      ? y.lastYear.new_customer_count +
        y.lastYear.repeat_customer_count +
        y.lastYear.regular_customer_count +
        y.lastYear.staff_customer_count
      : null;
    const lyPerCustomer =
      lyTotal !== null && lySeg !== null && lySeg > 0 ? lyTotal / lySeg : null;
    return {
      perCustomer: curPerCustomer !== null ? calculateYoY(curPerCustomer, lyPerCustomer) : null,
    };
  }, [effectiveYoY]);

  // follow-up: 1日平均売上の YoY バッジ（前回の符号逆転を解消した形）。
  // 純関数 computeAvgDailyYoY に集約（テスト容易化）。open 抜き決済済ベース・当年/前年同定義。
  const avgDailyYoY = useMemo<YoYDelta | null>(
    () => computeAvgDailyYoY(effectiveYoY),
    [effectiveYoY],
  );

  // B7: セグメント別 KPI の客数 YoY を動的キーで型安全に引く固定マップ。
  // 以前は SEGMENT_LABELS.map のクロージャ内で毎反復生成していたが、effectiveYoY のみに
  // 依存する固定 Record なので map 外（useMemo）へ移し一度だけ生成する（挙動不変）。
  const segmentYoYMap = useMemo<
    Record<'new' | 'repeat' | 'regular' | 'staff', YoYDelta | undefined>
  >(
    () => ({
      new: effectiveYoY?.yoy.new_customer_count,
      repeat: effectiveYoY?.yoy.repeat_customer_count,
      regular: effectiveYoY?.yoy.regular_customer_count,
      staff: effectiveYoY?.yoy.staff_customer_count,
    }),
    [effectiveYoY],
  );

  // B8: 曜日別分析。日次粒度の rawDailyTrend を入力に month〜日の平均を集計。
  // dailyTrend は granularity 集約後で曜日が消えるため必ず rawDailyTrend を使う。mode=average 固定。
  const weekdayAggregates = useMemo(
    () => aggregateByWeekday(segment.data?.rawDailyTrend ?? [], 'average'),
    [segment.data?.rawDailyTrend],
  );

  // 店舗別の表示棒高さ（totalSales=決済済+未決済）での再ソートは
  // SalesLocationComparison 内（バー・構成）へ移譲（normalizeByLocation の契約は不変）。

  if (scopeLoading) {
    return <PageLoader variant="screen" label="読み込み中" />;
  }

  const data = segment.data;

  // 獲得経路だけを live 実数で上書き（§4.1.3）。取得成功時のみ差し替え、失敗時は
  // data の既定ゼロのまま（売上/客数/トレンド/セグメントは RPC=data を一切触らない）。
  const acquisitionBreakdown =
    data && acquisitionLive.acquisition
      ? acquisitionLive.acquisition
      : data?.acquisitionBreakdown ?? null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-stone-900 dark:text-stone-100">売上</h1>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Square 売上ダッシュボード（前日まで確定／当日はリアルタイム）
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
      ) : isToday ? (
        // 当日は Square live（決済済み売上 + 取引一覧）を表示する（W4-P1 / §4.3.3）。
        // RPC 集計系（前日まで確定）は today では停止済み。
        isAllToday ? (
          // ALL+today は live が店舗単位のため P1 では単店選択を促す（合算は P2 以降）。
          <EmptyState
            title="今日のデータは店舗を 1 つ選んでください"
            description="当日のリアルタイム売上は店舗ごとに表示します。上の店舗セレクタで店舗を選択してください。"
          />
        ) : locationsError ? (
          // 店舗 ID 解決エラーは全文表示（短縮しない＝MEMORY ルール）。
          <ErrorBanner message={locationsError} />
        ) : (
          <DailyLiveSection
            sales={live.sales}
            transactions={live.transactions}
            loading={live.loading}
            error={live.error}
            date={baseDate}
            lastUpdated={live.lastUpdated}
            refresh={live.refresh}
            openOrders={liveOpenOrders.orders}
            openOrdersLoading={liveOpenOrders.loading}
            openOrdersError={liveOpenOrders.error}
          />
        )
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
              trend={showYoY ? toTrend(derivedYoY.perCustomer ?? undefined) : undefined}
            />
            <StatCard
              label="1日平均売上"
              value={
                data.averageDailySales === null
                  ? null
                  : formatYen(Math.round(data.averageDailySales))
              }
              // avgDaily YoY（open 抜き決済済ベース・当年/前年同定義）。前回の符号逆転を解消済み。
              trend={showYoY ? toTrend(avgDailyYoY ?? undefined) : undefined}
            />
          </div>

          {/* セグメント別 KPI（B7）: new/repeat/regular/staff=客数+YoY、unlisted=売上額のみ。
              unlisted 客数 YoY と全セグメントの売上 YoY は yoy.data に無いため出さない。 */}
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-stone-700 dark:text-stone-200">
              セグメント別
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {SEGMENT_LABELS.map(({ key, label }) => {
                if (key === 'unlisted') {
                  return (
                    <StatCard
                      key={key}
                      label="記載なし売上"
                      value={formatYen(data.salesBySegment.unlisted)}
                    />
                  );
                }
                return (
                  <StatCard
                    key={key}
                    label={`${label}客数`}
                    value={data.customersBySegment[key]}
                    unit="人"
                    trend={showYoY ? toTrend(segmentYoYMap[key]) : undefined}
                  />
                );
              })}
            </div>
          </Card>

          {/* セグメント（売上構成の円） */}
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-stone-700 dark:text-stone-200">
              売上構成（セグメント別）
            </h2>
            {/* B24: 円グラフ（左/上）+ セグメント別 ¥金額・構成%リスト（右/下）。 */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SegmentPieChart sales={data.salesBySegment} />
              <SegmentBreakdownList sales={data.salesBySegment} />
            </div>
          </Card>

          {/* トレンド（前年系列は十分時のみ） */}
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-stone-700 dark:text-stone-200">
              {cardTitleByGranularity(granularityFor(period))}
            </h2>
            <SegmentTrendChart
              data={data.dailyTrend}
              period={period}
              showYoY={showYoY}
              lastYearTotalsSeries={lastYearSeries}
            />
          </Card>

          {/* 獲得経路（新規客）。単店選択時は live 実数で補完（§4.1.3/§4.1.4）。 */}
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-stone-700 dark:text-stone-200">
              新規客の獲得経路
            </h2>
            {locationNames === null ? (
              // ALL（全店）は acquisition live 補完スコープ外（§4.1.4）。
              <p className="mb-2 text-xs text-stone-500 dark:text-stone-400">
                店舗を 1 つ選ぶと獲得経路の内訳が表示されます。
              </p>
            ) : acquisitionLive.loading ? (
              <p className="mb-2 text-xs text-stone-400 dark:text-stone-500">
                獲得経路を集計中…
              </p>
            ) : acquisitionLive.clamped ? (
              <p className="mb-2 text-xs text-stone-500 dark:text-stone-400">
                （直近約 3 ヶ月の新規客内訳）
              </p>
            ) : null}
            {/* 店舗 id 解決失敗（locations 取得エラー）も無言の空表示にせず局所注記する。 */}
            {locationNames !== null && !isToday && locationsError ? (
              <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
                店舗情報の取得に失敗したため獲得経路を表示できません（売上・客数には影響していません）。
              </p>
            ) : null}
            {/* fail-soft: 取得失敗時も売上・客数には影響しない。獲得経路カード内に局所注意のみ。 */}
            {locationNames !== null && !isToday && acquisitionLive.error ? (
              <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
                獲得経路の取得に失敗しました（売上・客数には影響していません）。
              </p>
            ) : null}
            <AcquisitionChart data={acquisitionBreakdown ?? data.acquisitionBreakdown} />
          </Card>

          {/* 曜日別分析（B8）: 日次 rawDailyTrend を曜日平均に集計した客数・売上の棒グラフ。 */}
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-stone-700 dark:text-stone-200">
              曜日別分析
            </h2>
            <div className="space-y-4">
              <div>
                <h3 className="mb-1 text-xs font-medium text-stone-500 dark:text-stone-400">
                  客数（曜日別平均）
                </h3>
                <WeekdayBarChart data={weekdayAggregates} metric="customers" />
              </div>
              <div>
                <h3 className="mb-1 text-xs font-medium text-stone-500 dark:text-stone-400">
                  売上（曜日別平均）
                </h3>
                <WeekdayBarChart data={weekdayAggregates} metric="sales" />
              </div>
            </div>
          </Card>

          {/* 時間帯別混雑分析（B/P3）: 単店 × 非 today のみ。方式A で acquisitionLive の
              transactions（同一 fetch 結果）から派生＝新規 fetch ゼロ増。ALL/today では非表示。
              Section は Card を持たず中身だけ返す（§5.2）→ SalesPage が Card + 見出しを持つ。 */}
          {locationNames !== null && !isToday && (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-stone-700 dark:text-stone-200">
                時間帯別混雑分析
              </h2>
              {acquisitionLive.loading ? (
                <p className="mb-2 text-xs text-stone-400 dark:text-stone-500">
                  混雑分析を集計中…
                </p>
              ) : acquisitionLive.clamped ? (
                <p className="mb-2 text-xs text-stone-500 dark:text-stone-400">
                  （直近約 3 ヶ月の集計）
                </p>
              ) : null}
              {/* 店舗 id 解決失敗（locations 取得エラー）も無言の空表示にせず局所注記する。 */}
              {locationsError ? (
                <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
                  店舗情報の取得に失敗したため混雑分析を表示できません（売上・客数には影響していません）。
                </p>
              ) : null}
              {/* fail-soft: 取得失敗時もチャートは EmptyState のまま壊さない（局所注意のみ）。 */}
              {acquisitionLive.error ? (
                <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
                  混雑分析の取得に失敗しました（売上・客数には影響していません）。
                </p>
              ) : null}
              <OccupancyAnalysisSection
                transactions={acquisitionLive.transactions}
                startHour={STORE_START_HOUR}
                endHour={(STORE_START_HOUR + 23) % 24}
              />
            </Card>
          )}

          {/* 店舗別比較（owner/manager かつ ALL 選択時のみ）。
              071 バー（byLoc）と 077 トレンド/曜日/構成（byLocDaily）を別管理で配線。 */}
          {showLocationCompare &&
            (byLoc.error ? (
              <Card>
                <ErrorBanner message={byLoc.error} />
              </Card>
            ) : byLoc.loading ? (
              <Card>
                <DashboardSkeleton />
              </Card>
            ) : (
              <SalesLocationComparison
                byLocRows={byLoc.rows}
                daily={byLocDaily}
                period={period}
              />
            ))}
        </div>
      )}
    </div>
  );
};

export default SalesPage;
