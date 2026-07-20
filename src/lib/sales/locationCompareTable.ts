import { calculateYoY, MIN_LASTYEAR_CUSTOMERS } from './yoy';
import type { YoYDelta } from './yoy';
import type { SalesByLocationRow } from '../../hooks/useSalesByLocation';
import type { AcquisitionBreakdown, DailySegmentPoint } from './types';

// =============================================================================
// locationCompareTable — 全店舗比較テーブルの行構築純関数（設計書 §6-C / D5-D8）
// -----------------------------------------------------------------------------
// React 非依存。071(SalesByLocationRow)・077(DailySegmentPoint 期間合算)・獲得経路
// (AcquisitionBreakdown by name)・前年同名突合の YoY を 1 行に束ねる。
//
//   - 並び: totalSales DESC（比較セクションのバーと同順）+ 合計行を別フィールドで付与。
//   - 客単価 = totalSales/totalCustomers（0 客は null）。
//   - 平均日売上 = totalSales/elapsedDays（当年）・totalSales/lastYearDays（前年、対称化）。
//   - YoY は必ず calculateYoY 経由。前年行なし or 前年 4 セグ客数 < MIN_LASTYEAR_CUSTOMERS(10)
//     はその店（合計行含む）の YoY 全メトリクスを no_data（lastYear=null を calculateYoY に渡す
//     ことで自然に no_data 分類にする。自前で % 計算しない）。
//   - totals.acquisition は 1 店でも null なら null（過少表示禁止）。
//   - 数値は丸めずに返す（丸めは表示側 = formatYen(Math.round())/formatYoY の toFixed(1)）。
// =============================================================================

/** 077 由来のセグ 4 列 + 記載なし売上（期間合算・生値）。 */
export interface LocationCompareSeg {
  new: number;
  repeat: number;
  regular: number;
  staff: number;
  unlistedSales: number;
}

export interface LocationCompareRow {
  locationName: string;
  /** 期間売上（open 込み。071 totalSales）。 */
  totalSales: number;
  /** 平均日売上 = totalSales / elapsedDays。elapsedDays=0 は null。 */
  averageDailySales: number | null;
  /** 客単価 = totalSales / totalCustomers。0 客は null。 */
  perCustomer: number | null;
  /** 4 セグメント合計客数（071 totalCustomers）。 */
  totalCustomers: number;
  /** 077 セグ 4 列 + 記載なし売上（期間合算）。dailySeries が null、または該当店が無い場合 null。 */
  seg: LocationCompareSeg | null;
  /** 獲得経路 5 列（live 集計）。取得未実施/失敗店は null。 */
  acquisition: AcquisitionBreakdown | null;
  /** YoY 4 メトリクス。非適用期間（week/指定日等・lastYearRows=null）は null。 */
  yoy: {
    totalSales: YoYDelta;
    avgDailySales: YoYDelta;
    perCustomer: YoYDelta;
    totalCustomers: YoYDelta;
  } | null;
}

export interface LocationCompareTableData {
  rows: LocationCompareRow[];
  totals: LocationCompareRow;
}

export interface BuildLocationCompareTableArgs {
  /** name-unique 前提（Engineer B のマージ済み 071 rows）。 */
  currentRows: SalesByLocationRow[];
  /** null = YoY 非適用/未取得。取得済みなら前年同期の 071 rows（同じく name-unique）。 */
  lastYearRows: SalesByLocationRow[] | null;
  /** 077 マージ済み locationSeries からの射影。null = 077 未取得/エラー。 */
  dailySeries: { locationName: string; points: DailySegmentPoint[] }[] | null;
  /** 獲得経路 hook の byName。null = 未取得/非対象期間。 */
  acquisitionByName: Record<string, AcquisitionBreakdown | null> | null;
  /** 当年の経過日数 = inclusiveDaySpan(from,to)。 */
  elapsedDays: number;
  /** 前年の経過日数 = inclusiveDaySpan(lyFrom,lyTo)（当年と対称化した分母）。 */
  lastYearDays: number;
}

const EMPTY_SEG: LocationCompareSeg = {
  new: 0,
  repeat: 0,
  regular: 0,
  staff: 0,
  unlistedSales: 0,
};

/** DailySegmentPoint[] を期間合算し、セグ 4 列 + 記載なし売上のみ抽出する。 */
function sumSeg(points: DailySegmentPoint[]): LocationCompareSeg {
  return points.reduce<LocationCompareSeg>(
    (acc, p) => ({
      new: acc.new + p.new,
      repeat: acc.repeat + p.repeat,
      regular: acc.regular + p.regular,
      staff: acc.staff + p.staff,
      unlistedSales: acc.unlistedSales + p.unlistedSales,
    }),
    { ...EMPTY_SEG },
  );
}

function addSeg(a: LocationCompareSeg, b: LocationCompareSeg): LocationCompareSeg {
  return {
    new: a.new + b.new,
    repeat: a.repeat + b.repeat,
    regular: a.regular + b.regular,
    staff: a.staff + b.staff,
    unlistedSales: a.unlistedSales + b.unlistedSales,
  };
}

const EMPTY_ACQUISITION: AcquisitionBreakdown = {
  google: 0,
  review: 0,
  signboard: 0,
  sns: 0,
  unknown: 0,
};

function addAcquisition(
  a: AcquisitionBreakdown,
  b: AcquisitionBreakdown,
): AcquisitionBreakdown {
  return {
    google: a.google + b.google,
    review: a.review + b.review,
    signboard: a.signboard + b.signboard,
    sns: a.sns + b.sns,
    unknown: a.unknown + b.unknown,
  };
}

/** 前年比較の入力メトリクス（当年側）。 */
interface CurrentMetrics {
  totalSales: number;
  averageDailySales: number | null;
  perCustomer: number | null;
  totalCustomers: number;
}

/**
 * 1 行（店舗 or 合計）ぶんの YoY 4 メトリクスを構築する。
 *
 * lyRow が null、または前年 4 セグ客数 < MIN_LASTYEAR_CUSTOMERS の場合、
 * 各メトリクスへ lastYear=null を渡して calculateYoY を呼ぶ（no_data に自然に倒れる。
 * 自前で % を計算しない）。
 */
function buildRowYoy(
  metrics: CurrentMetrics,
  lyRow: { totalSales: number; totalCustomers: number } | null,
  lastYearDays: number,
): {
  totalSales: YoYDelta;
  avgDailySales: YoYDelta;
  perCustomer: YoYDelta;
  totalCustomers: YoYDelta;
} {
  const insufficient = !lyRow || lyRow.totalCustomers < MIN_LASTYEAR_CUSTOMERS;
  const lySales = insufficient || !lyRow ? null : lyRow.totalSales;
  const lyCustomers = insufficient || !lyRow ? null : lyRow.totalCustomers;
  const lyPerCustomer =
    insufficient || !lyRow || lyRow.totalCustomers === 0
      ? null
      : lyRow.totalSales / lyRow.totalCustomers;
  const lyAvgDaily =
    insufficient || !lyRow || lastYearDays === 0 ? null : lyRow.totalSales / lastYearDays;

  return {
    totalSales: calculateYoY(metrics.totalSales, lySales),
    avgDailySales: calculateYoY(metrics.averageDailySales ?? 0, lyAvgDaily),
    perCustomer: calculateYoY(metrics.perCustomer ?? 0, lyPerCustomer),
    totalCustomers: calculateYoY(metrics.totalCustomers, lyCustomers),
  };
}

export function buildLocationCompareTable(
  args: BuildLocationCompareTableArgs,
): LocationCompareTableData {
  const {
    currentRows,
    lastYearRows,
    dailySeries,
    acquisitionByName,
    elapsedDays,
    lastYearDays,
  } = args;

  // 並び: totalSales DESC（比較セクションのバーと同順）。
  const sorted = [...currentRows].sort((a, b) => b.totalSales - a.totalSales);

  const rows: LocationCompareRow[] = sorted.map((r) => {
    const perCustomer = r.totalCustomers > 0 ? r.totalSales / r.totalCustomers : null;
    const averageDailySales = elapsedDays > 0 ? r.totalSales / elapsedDays : null;

    const segEntry =
      dailySeries === null
        ? null
        : (dailySeries.find((s) => s.locationName === r.locationName) ?? null);
    const seg = dailySeries === null ? null : segEntry ? sumSeg(segEntry.points) : null;

    const acquisition =
      acquisitionByName === null ? null : (acquisitionByName[r.locationName] ?? null);

    const lyRow =
      lastYearRows === null
        ? null
        : (lastYearRows.find((l) => l.locationName === r.locationName) ?? null);
    const yoy =
      lastYearRows === null
        ? null
        : buildRowYoy(
            { totalSales: r.totalSales, averageDailySales, perCustomer, totalCustomers: r.totalCustomers },
            lyRow,
            lastYearDays,
          );

    return {
      locationName: r.locationName,
      totalSales: r.totalSales,
      averageDailySales,
      perCustomer,
      totalCustomers: r.totalCustomers,
      seg,
      acquisition,
      yoy,
    };
  });

  const totalSales = rows.reduce((s, r) => s + r.totalSales, 0);
  const totalCustomers = rows.reduce((s, r) => s + r.totalCustomers, 0);
  const perCustomer = totalCustomers > 0 ? totalSales / totalCustomers : null;
  const averageDailySales = elapsedDays > 0 ? totalSales / elapsedDays : null;

  // seg: dailySeries 自体が null なら null。存在する店の分だけ合算（個店 null は 0 扱いでスキップ）。
  const seg =
    dailySeries === null
      ? null
      : rows.reduce<LocationCompareSeg>(
          (acc, r) => (r.seg ? addSeg(acc, r.seg) : acc),
          { ...EMPTY_SEG },
        );

  // acquisition: 1 店でも null なら合計も null（過少表示禁止）。
  const acquisition =
    acquisitionByName === null || rows.some((r) => r.acquisition === null)
      ? null
      : rows.reduce<AcquisitionBreakdown>(
          (acc, r) => addAcquisition(acc, r.acquisition as AcquisitionBreakdown),
          { ...EMPTY_ACQUISITION },
        );

  // 合計行 YoY: 前年合算客数に同一閾値(MIN_LASTYEAR_CUSTOMERS)を適用する。
  const lyTotalsRow =
    lastYearRows === null || lastYearRows.length === 0
      ? null
      : {
          totalSales: lastYearRows.reduce((s, l) => s + l.totalSales, 0),
          totalCustomers: lastYearRows.reduce((s, l) => s + l.totalCustomers, 0),
        };
  const yoy =
    lastYearRows === null
      ? null
      : buildRowYoy(
          { totalSales, averageDailySales, perCustomer, totalCustomers },
          lyTotalsRow,
          lastYearDays,
        );

  const totals: LocationCompareRow = {
    locationName: '合計',
    totalSales,
    averageDailySales,
    perCustomer,
    totalCustomers,
    seg,
    acquisition,
    yoy,
  };

  return { rows, totals };
}
