import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useUrlState } from '../hooks/useUrlState';
import { useSalesScope } from '../hooks/useSalesScope';
import { useSalesSegment } from '../hooks/useSalesSegment';
import { useSalesYoY } from '../hooks/useSalesYoY';
import { useSalesByLocation } from '../hooks/useSalesByLocation';
import { useSalesByLocationDaily } from '../hooks/useSalesByLocationDaily';
import { useSquareLiveSales } from '../hooks/useSquareLiveSales';
import { useSquareOpenOrders } from '../hooks/useSquareOpenOrders';
import { useSquareLiveAllStores } from '../hooks/useSquareLiveAllStores';
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
import { PeriodSelector, StoreSelector } from '../components/sales/ui';
import DailyLiveSection from '../components/sales/DailyLiveSection';
import SalesSummary from '../components/sales/SalesSummary';
import StoreTodayBreakdown from '../components/sales/StoreTodayBreakdown';
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

// 要件1: 最後に選んだ店舗を記憶（localStorage・tenant 非依存グローバルキー）。
// 採用は「options（=許可店）に含まれる値のみ」ガードで fail-closed（別テナント店名等は破棄）。
const STORE_LS_KEY = 'kintai_sales_store';

/** localStorage 読取（try/catch + typeof guard・SSR/プライベートモードで白画面にしない）。 */
function readStoredStore(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(STORE_LS_KEY);
  } catch {
    return null;
  }
}

/** localStorage 書込（try/catch・例外は無視＝白画面防止）。 */
function writeStoredStore(value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_LS_KEY, value);
  } catch {
    /* SSR / Safari プライベート / quota 超過などは無視（既定動作を継続） */
  }
}

/** YYYY-MM-DD 形式判定（URL ?date= 復元の妥当性チェック用）。 */
function isYmd(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

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

  // T7/T11（2026-06-18 監査 §4-9）: 店舗選択を URL ?store= へ双方向同期。
  // 店舗値は動的（許可店舗名 or ALL_VALUE）のため useUrlState（固定 allowed）は使えず、
  // inline パターンで実装する。初期 ?store= はマウント時 1 回だけ読み（遅延初期化）、
  // options 確定後に「存在する値のみ採用」ガードで適用、未知 ID は無視して既定へフォールバック。
  // 書き戻しは functional updater + { replace: true } で他クエリ（period 等）を温存し履歴も汚さない。
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStoreRef = useRef<string | null>(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    searchParams.get('store'),
  );

  useEffect(() => {
    if (scopeLoading) return;
    if (options.length === 0) {
      setSelected('');
      return;
    }
    if (!options.some((o) => o.value === selected)) {
      // 初回シード優先度（fail-closed・いずれも options 内のみ採用）:
      //   ① URL ?store=（共有/リロード復元を最優先）
      //   ② localStorage（要件1: 最後に選んだ店舗を記憶）
      //   ③ 既定（canViewAll ? ALL : options[0]）
      const fromUrl = initialStoreRef.current;
      initialStoreRef.current = null; // 1 回限り（以後はユーザー操作のみが state を動かす）
      const fromStore = readStoredStore();
      if (fromUrl !== null && options.some((o) => o.value === fromUrl)) {
        setSelected(fromUrl);
      } else if (fromStore !== null && options.some((o) => o.value === fromStore)) {
        setSelected(fromStore);
      } else {
        setSelected(canViewAll ? ALL_VALUE : options[0].value);
      }
    }
  }, [scopeLoading, options, selected, canViewAll]);

  // selected -> URL: 確定済みかつ差分があるときだけ ?store= を書き戻す。
  useEffect(() => {
    if (selected === '') return;
    if (searchParams.get('store') === selected) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('store', selected);
        return next;
      },
      { replace: true },
    );
  }, [selected, searchParams, setSearchParams]);

  // selected -> localStorage: 確定値に変わるたび記憶（次回起動時に復元・要件1）。
  // '' は保存しない（未確定）。ALL_VALUE も保存対象（owner の ALL 常用を記憶）。
  useEffect(() => {
    if (selected === '') return;
    writeStoredStore(selected);
  }, [selected]);

  // --- 期間セレクタ ---
  // 営業日基準の「今日」（getBusinessDate(11)）。elapsedDays・期間上限の基準。
  // マウント時 1 回確定（週/四半期の初期選択にも使うため useState より前に算出）。
  const baseDate = useMemo(() => getBusinessDate(STORE_START_HOUR), []);

  // week 選択肢数（baseDate の年月内の月曜起算週数）。
  const availableWeeks = useMemo(() => {
    const [by, bm] = baseDate.split('-').map(Number);
    return getMonthWeekCount(by, bm);
  }, [baseDate]);

  // T7（2026-06-18 監査 §4-9）: 期間プリセットを URL ?period= へ双方向同期。
  // /sales?period=week 直アクセスで週ビューに着地、リロード/戻るで復元、共有可。
  // weekIndex/quarterIndex は従属状態のため本バッチでは URL 化しない（Phase3b）。
  const PERIOD_PRESETS = ['today', 'week', 'month', 'quarter', 'year'] as const;
  const [period, setPeriod] = useUrlState<PeriodPreset>('period', PERIOD_PRESETS, 'month');
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

  // --- 指定日（要件2）: 期間タブ「指定日」（key='today' 温存）の対象日 ---
  // selectedDate（既定 baseDate=営業日today）。必ず <= baseDate にクランプ（未来日不可）。
  // URL ?date= は inline 双方向同期（?store= と同作法・date は自由値で useUrlState 不適）。
  const clampDate = (d: string): string => {
    if (!isYmd(d)) return baseDate; // 空/不正は今日へ正規化
    return d > baseDate ? baseDate : d; // 未来日は今日へクランプ
  };
  const initialDateRef = useRef<string | null>(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    searchParams.get('date'),
  );
  const [selectedDate, setSelectedDateRaw] = useState<string>(() => {
    const fromUrl = initialDateRef.current;
    if (isYmd(fromUrl) && fromUrl <= baseDate) return fromUrl; // 形式 OK かつ未来でない
    return baseDate;
  });
  // 全入口でクランプを通す setter（input onChange / 任意呼び出し）。
  const setSelectedDate = (d: string) => setSelectedDateRaw(clampDate(d));

  // selectedDate -> URL ?date=: baseDate と異なるときだけ set、同値なら delete（URL を汚さない）。
  useEffect(() => {
    const cur = searchParams.get('date');
    if (selectedDate === baseDate) {
      if (cur === null) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('date');
          return next;
        },
        { replace: true },
      );
    } else {
      if (cur === selectedDate) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('date', selectedDate);
          return next;
        },
        { replace: true },
      );
    }
  }, [selectedDate, baseDate, searchParams, setSearchParams]);

  // 指定日が今日（営業日today）か。未決済(open)は今日のみ＝過去日は !isPickedToday。
  const isPickedToday = selectedDate === baseDate;

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

  // ALL（全店）+ today は live が店舗単位 → 許可店すべてを取得して全店合計＋店舗別内訳を表示（要件B）。
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
  // Square location_id が要るのは (a) today live/open-orders（単店）と (b) 非 today 単店の
  // acquisition live 補完（§4.1.3）と (c) ALL×today の全店 live（要件B・許可店すべての id 解決）。
  // (c) のときは locations マップから許可店ぶんの id を一括解決する（スコープ外は引かない＝fail-closed）。
  const needLocationId =
    scopeReady && (selectedLocationName !== null || isAllToday);
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
    date: selectedDate,
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
    date: selectedDate,
    locationId: selectedLocationId ?? '',
    startHour: STORE_START_HOUR,
    endHour: (STORE_START_HOUR + 23) % 24,
    // 未決済は今日のみ取得（過去日は概念上存在しない＝isPickedToday を AND）。
    enabled: scopeReady && isToday && selectedLocationId !== null && isPickedToday,
  });

  // ALL×today の全店 live 対象（要件B）。許可店名すべてを渡す（スコープ＝許可店のみ＝fail-closed）。
  // id 未解決店も除外せず {locationId:''} のまま渡す → hook 側が「未解決＝失敗扱い（fetch せず
  // error 付き PerStoreResult）」にし、computeMultiStoreDailyTotals が complete=false で全店合計を
  // 不可知に倒す（過少表示禁止）。未解決店は内訳にも事由付きで明示される。canViewAll でないと
  // isAllToday は成立しない。
  const allStoresList = useMemo(
    () =>
      allowedLocationNames.map((name) => ({
        name,
        locationId: locationIdMap[name] ?? '',
      })),
    [allowedLocationNames, locationIdMap],
  );

  // 全店 live（決済済み + 未決済を許可店すべてで取得し全店合計＋店舗別内訳を算出）。
  // ALL×today かつ少なくとも 1 店の id が解決済みのときのみ起動（単店経路には無影響）。
  const allStores = useSquareLiveAllStores({
    date: selectedDate,
    stores: allStoresList,
    startHour: STORE_START_HOUR,
    endHour: (STORE_START_HOUR + 23) % 24,
    enabled: scopeReady && isAllToday && allStoresList.length > 0,
    // 未決済は今日のみ（過去日は各店 /api/open-orders を呼ばず open=0）。
    includeOpen: isPickedToday,
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
  // NOTE: avgDaily（1日平均売上）の YoY は computeAvgDailyYoY（avgDailyYoY.ts）に集約。
  // カードと同じ open 込み基準で、当年/前年とも「その年の合計 / その年の実在日数」で算出する。
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

  // 1日平均売上の YoY バッジ。純関数 computeAvgDailyYoY に集約（テスト容易化）。
  // カード averageDailySales と同一基準 = open 込み（total_amount + open_total_amount）。
  // 当年/前年とも「その年の open 込み合計 / その年の実在日数」で集合整合・符号正しさ担保。
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
              <span
                id="sales-store-label"
                className="text-sm text-stone-600 dark:text-stone-300"
              >
                店舗
              </span>
              {/* T7: 店舗選択を <select> からボタン型（WAI-ARIA tabs）へ（要件A）。
                  selected/setSelected と URL ?store= 同期は不変。onChange に値を渡すだけ。 */}
              <StoreSelector
                options={options}
                value={selected}
                onChange={setSelected}
                ariaLabel="店舗選択"
              />
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
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            maxDate={baseDate}
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
          // ALL+today: 許可店すべての当日 live を取得し、上=全店合計3カード／下=店舗別内訳を表示（要件B）。
          // /api/locations 自体が失敗し全体が不可知なら、まずそのエラーを全文表示（短縮しない）。
          locationsError ? (
            <ErrorBanner message={locationsError} />
          ) : (
            <div className="space-y-5">
              {/* 上: 全店合計の3カード（決済済+未決済）。失敗/未解決店があると aggregate.complete=false。
                  その場合は settledError/openError 双方に同じ不可知注記を渡し、決済済み・未決済・合計の
                  3カードすべてを「—」に倒す（全店として一貫した誠実な不可知表示・過少表示禁止）。
                  失敗/未解決店は computeMultiStoreDailyTotals が合計から除外済み（¥0 誤算入なし）。 */}
              <SalesSummary
                settledTotal={allStores.aggregate.settledTotal}
                settledCount={allStores.aggregate.settledCount}
                openTotal={allStores.aggregate.openTotal}
                openCount={allStores.aggregate.openCount}
                grandTotal={allStores.aggregate.grandTotal}
                grandCount={allStores.aggregate.grandCount}
                loading={allStores.loading}
                openLoading={allStores.loading}
                // complete=false（一部店舗の取得失敗 or ID 未解決）は不可知 → 決済済み・未決済・合計の
                // 3カードすべてを「—」に倒す。全文の対象店舗名を注記に載せる（過少表示禁止・短縮禁止）。
                settledError={
                  !allStores.loading && !allStores.aggregate.complete
                    ? `一部店舗の取得に失敗（または店舗ID未解決）のため全店合計は表示できません（対象店: ${allStores.aggregate.failedStores.join(
                        '、',
                      )}）。店舗別の内訳は下表でご確認ください。`
                    : null
                }
                openError={
                  !allStores.loading && !allStores.aggregate.complete
                    ? `一部店舗の取得に失敗（または店舗ID未解決）のため全店合計は表示できません（対象店: ${allStores.aggregate.failedStores.join(
                        '、',
                      )}）。店舗別の内訳は下表でご確認ください。`
                    : null
                }
                date={selectedDate}
                showOpen={isPickedToday}
              />

              {/* 下: 店舗別内訳。失敗/未解決店はその行に「—」+全文 error を表示。
                  過去日（showOpen=false）は未決済列を隠し決済済みのみ。 */}
              <StoreTodayBreakdown
                perStore={allStores.perStore}
                loading={allStores.loading}
                date={selectedDate}
                showOpen={isPickedToday}
              />
            </div>
          )
        ) : locationsError ? (
          // 店舗 ID 解決エラーは全文表示（短縮しない＝MEMORY ルール）。
          <ErrorBanner message={locationsError} />
        ) : (
          <DailyLiveSection
            sales={live.sales}
            transactions={live.transactions}
            loading={live.loading}
            error={live.error}
            date={selectedDate}
            lastUpdated={live.lastUpdated}
            refresh={live.refresh}
            openOrders={liveOpenOrders.orders}
            openOrdersLoading={liveOpenOrders.loading}
            openOrdersError={liveOpenOrders.error}
            showOpen={isPickedToday}
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
              // avgDaily YoY（open 込み・カード averageDailySales と同一基準）。符号逆転も解消済み。
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
