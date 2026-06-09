export type YoYClassification = 'up' | 'down' | 'flat' | 'no_data';

export interface YoYDelta {
  current: number;
  lastYear: number | null;
  deltaPercent: number | null;
  classification: YoYClassification;
}

/**
 * 前年データが事実上空とみなす客数閾値 (4 セグメント合計)。
 *
 * SABABA は Square 本格運用が 2025-03 開始のため、2024 年度以前は
 * 集計テーブルがほぼ空 → 当年と比較すると YoY が +99,999% 等の異常値になる。
 * 前年 4 セグメント (新規/リピート/常連/スタッフ) 客数合計が
 * この閾値未満の場合、YoY 全フィールドを no_data に強制する。
 */
export const MIN_LASTYEAR_CUSTOMERS = 10;

/**
 * 前年 SalesRangeTotal が「実質データなし」とみなせるかを判定する。
 *
 * 4 セグメント客数 (new/repeat/regular/staff) の合計が
 * MIN_LASTYEAR_CUSTOMERS 未満なら true。lastYearTotals が null の場合も true。
 */
export function isLastYearDataInsufficient(
  lastYearTotals: SalesRangeTotal | null
): boolean {
  if (!lastYearTotals) return true;
  const fourSegSum =
    lastYearTotals.new_customer_count +
    lastYearTotals.repeat_customer_count +
    lastYearTotals.regular_customer_count +
    lastYearTotals.staff_customer_count;
  return fourSegSum < MIN_LASTYEAR_CUSTOMERS;
}

export function calculateYoY(current: number, lastYear: number | null): YoYDelta {
  if (lastYear === null || lastYear === 0) {
    return { current, lastYear, deltaPercent: null, classification: 'no_data' };
  }
  const deltaPercent = ((current - lastYear) / lastYear) * 100;
  let classification: YoYClassification;
  if (Math.abs(deltaPercent) <= 2) {
    classification = 'flat';
  } else if (deltaPercent > 0) {
    classification = 'up';
  } else {
    classification = 'down';
  }
  return { current, lastYear, deltaPercent, classification };
}

export function shiftDateOneYearBack(dateStr: string): string {
  const [yStr, mStr, dStr] = dateStr.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);

  if (m === 2 && d === 29) {
    return `${y - 1}-02-28`;
  }

  const utcMs = Date.UTC(y - 1, m - 1, d);
  const date = new Date(utcMs);

  if (date.getUTCMonth() !== m - 1) {
    // overflow が発生した場合 (例: 平年の 2/29 を作ろうとした場合) → 前月末にクランプ
    date.setUTCDate(0);
  }

  const outY = date.getUTCFullYear();
  const outM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const outD = String(date.getUTCDate()).padStart(2, '0');

  return `${outY}-${outM}-${outD}`;
}

export function shiftDateOneYearForward(dateStr: string): string {
  const [yStr, mStr, dStr] = dateStr.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);

  if (m === 2 && d === 29) {
    return `${y + 1}-02-28`;
  }

  const utcMs = Date.UTC(y + 1, m - 1, d);
  const date = new Date(utcMs);

  if (date.getUTCMonth() !== m - 1) {
    date.setUTCDate(0);
  }

  const outY = date.getUTCFullYear();
  const outM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const outD = String(date.getUTCDate()).padStart(2, '0');

  return `${outY}-${outM}-${outD}`;
}

export function shiftRangeOneYearBack(args: { start_date: string; end_date: string }): { start_date: string; end_date: string } {
  return {
    start_date: shiftDateOneYearBack(args.start_date),
    end_date: shiftDateOneYearBack(args.end_date),
  };
}

export function formatYoY(
  delta: YoYDelta,
  opts?: {
    compact?: boolean;
    formatLastYear?: (value: number) => string;
  }
): string {
  const suffix = opts?.compact ? '' : ' vs 前年';
  const lastYearSuffix =
    opts?.formatLastYear && delta.lastYear !== null
      ? ` (前年: ${opts.formatLastYear(delta.lastYear)})`
      : '';

  switch (delta.classification) {
    case 'up':
      return `↑ +${delta.deltaPercent!.toFixed(1)}%${suffix}${lastYearSuffix}`;
    case 'down':
      return `↓ ${delta.deltaPercent!.toFixed(1)}%${suffix}${lastYearSuffix}`;
    case 'flat': {
      const flatSuffix = opts?.compact ? '' : ' 変化なし';
      return `±0.0%${flatSuffix}${lastYearSuffix}`;
    }
    case 'no_data':
      return `前年データなし`;
  }
}

export function yoyClassToColorClass(c: YoYClassification): string {
  switch (c) {
    case 'up':
      return 'text-success';
    case 'down':
      return 'text-danger';
    case 'flat':
      return 'text-text-muted';
    case 'no_data':
      return 'text-text-muted';
  }
}

export interface SalesRangeTotal {
  total_amount: number;
  open_total_amount: number;
  transaction_count: number;
  /**
   * ユニーク顧客ID系の客数 (Square payment.customer_id の distinct 数)。
   * 画面表示・客数 YoY・客数チャートで使う「4 セグメント合計
   * (new+repeat+regular+staff)」とは別母数なので注意。後方互換のため温存。
   * 客数 YoY は yoy.customer_count (= 4 セグメント合計) を参照すること。
   */
  customer_count: number;
  new_customer_count: number;
  repeat_customer_count: number;
  regular_customer_count: number;
  staff_customer_count: number;
  unlisted_customer_count: number;
}

export function aggregateSalesRangeTotals(
  byDate: Record<string, {
    total_amount: number;
    open_total_amount?: number;
    transaction_count: number;
    customer_count: number;
    new_customer_count?: number;
    repeat_customer_count?: number;
    regular_customer_count?: number;
    staff_customer_count?: number;
    unlisted_customer_count?: number;
  }>
): SalesRangeTotal {
  const result: SalesRangeTotal = {
    total_amount: 0,
    open_total_amount: 0,
    transaction_count: 0,
    customer_count: 0,
    new_customer_count: 0,
    repeat_customer_count: 0,
    regular_customer_count: 0,
    staff_customer_count: 0,
    unlisted_customer_count: 0,
  };
  for (const val of Object.values(byDate)) {
    result.total_amount += val.total_amount;
    result.open_total_amount += val.open_total_amount ?? 0;
    result.transaction_count += val.transaction_count;
    result.customer_count += val.customer_count;
    result.new_customer_count += val.new_customer_count ?? 0;
    result.repeat_customer_count += val.repeat_customer_count ?? 0;
    result.regular_customer_count += val.regular_customer_count ?? 0;
    result.staff_customer_count += val.staff_customer_count ?? 0;
    result.unlisted_customer_count += val.unlisted_customer_count ?? 0;
  }
  return result;
}

/**
 * 前年系列描画用の最小データ型 (設計書 §6.8)。
 * セグメント別フィールドを持たず、合計値のみ保持する。
 *
 * @property date         前年実日付 ('YYYY-MM-DD')。
 * @property total        当該日の前年実績値。
 * @property currentDate  対応する当年日付 ('YYYY-MM-DD')。chart 側で前年→当年軸マッピングに使用。
 *                        うるう年 (2/29) で shiftDateOneYearForward が日付をずらしてしまう
 *                        ケースを避けるため、生成側で当年実日付を渡す。オプショナルで後方互換。
 */
export interface DailyTotalPoint {
  date: string;
  total: number;
  currentDate?: string;
}

/**
 * YoY 計算結果の集約型 (KPI 3 指標 + セグメント別 4 指標 + 日別比較)。
 * Team B (SalesSummary) / Team C (chart) がこの型を受け取って表示する。
 */
export interface SalesRangeYoYResult {
  period: { start: string; end: string };
  lastYearPeriod: { start: string; end: string };
  current: SalesRangeTotal;
  lastYear: SalesRangeTotal | null;
  yoy: {
    total_amount: YoYDelta;
    transaction_count: YoYDelta;
    customer_count: YoYDelta;
    new_customer_count: YoYDelta;
    repeat_customer_count: YoYDelta;
    regular_customer_count: YoYDelta;
    staff_customer_count: YoYDelta;
  };
  /** 期間内 N 日中、前年同日にデータが存在する日数 M を / N */
  dataCoverage: number;
  byDate: Array<{
    business_date: string;
    lastYearDate: string;
    /**
     * current/lastYear の客数系フィールドについて:
     * - customer_count は「ユニーク顧客ID系」(SalesRangeTotal.customer_count と同母数)。
     *   客数 YoY・客数チャートでは参照しない (別母数)。後方互換のため温存。
     * - new/repeat/regular/staff_customer_count は 4 セグメント別客数。
     *   客数チャート前年系列は total = new+repeat+regular+staff (= 表示客数と同母数) で算出する。
     *   optional なのは旧形式 byDate (セグメント未付与) との後方互換のため。
     */
    current: {
      total_amount: number;
      transaction_count: number;
      customer_count: number;
      new_customer_count?: number;
      repeat_customer_count?: number;
      regular_customer_count?: number;
      staff_customer_count?: number;
    };
    lastYear: {
      total_amount: number;
      transaction_count: number;
      customer_count: number;
      new_customer_count?: number;
      repeat_customer_count?: number;
      regular_customer_count?: number;
      staff_customer_count?: number;
    } | null;
  }>;
}

// =============================================================================
// buildYoYResultFromResponses — current/前年同期の SalesRange から YoY を組む純関数
// -----------------------------------------------------------------------------
// 設計書 追補D（2026-06-09 Loop2）。移植元 square-dashboard
// `useYoYCompare.ts` の純粋関数部分（HTTP 非依存）を kintai に移植。
//
//   - React/HTTP 非依存。current/lastYear の SalesRange レスポンスを引数で受け、
//     `SalesRangeYoYResult` を返す（fetch は呼び側 hook = useSalesYoY が担当）。
//   - 客数 YoY 母数は必ず 4 セグメント合計（new+repeat+regular+staff）に統一。
//     `SalesRangeTotal.customer_count`（ユニーク ID 系）は母数に使わない。
//     → 2026-05-31 の吸暮 誤+40%→正+117.3% 母数不整合バグ再発防止。
//   - 前年 4 セグ合計 < MIN_LASTYEAR_CUSTOMERS（=10）なら前年を null 化し
//     yoy.* を no_data にする（SABABA は Square 本格運用 2025-03 開始のため、
//     2024 期と比較する期間は「実態のない急増」を出さない）。current は維持＝部分成功。
//
// 引数型は salesRangeAdapter への循環 import を避けるため `{ byDate: Record<...> }`
// に構造的に緩める（SalesRangeResponse 互換だが import 不要）。
// =============================================================================

/** buildYoYResultFromResponses が要求する SalesRange の最小構造（循環 import 回避用）。 */
export interface SalesRangeLike {
  byDate: Record<
    string,
    {
      total_amount: number;
      transaction_count: number;
      customer_count: number;
      new_customer_count?: number;
      repeat_customer_count?: number;
      regular_customer_count?: number;
      staff_customer_count?: number;
      unlisted_customer_count?: number;
      open_total_amount?: number;
    }
  >;
}

export function buildYoYResultFromResponses(args: {
  start_date: string;
  end_date: string;
  currentRes: SalesRangeLike;
  lastYearRes: SalesRangeLike | null;
}): SalesRangeYoYResult {
  const { start_date, end_date, currentRes } = args;
  const lastYearRange = shiftRangeOneYearBack({ start_date, end_date });

  const hasLastYear =
    !!args.lastYearRes && Object.keys(args.lastYearRes.byDate).length > 0;
  const lastYearRes = hasLastYear ? args.lastYearRes : null;

  const currentTotals: SalesRangeTotal = aggregateSalesRangeTotals(currentRes.byDate);
  const rawLastYearTotals: SalesRangeTotal | null = lastYearRes
    ? aggregateSalesRangeTotals(lastYearRes.byDate)
    : null;

  // 前年 4 セグメント客数合計が MIN_LASTYEAR_CUSTOMERS 未満なら
  // 事実上データなしとみなし、lastYear 全体を null 化 (YoY 全フィールド no_data)。
  // SABABA は Square 本格運用が 2025-03 開始のため 2024 年度以前は集計が空。
  const lastYearInsufficient = isLastYearDataInsufficient(rawLastYearTotals);
  const lastYearTotals: SalesRangeTotal | null = lastYearInsufficient
    ? null
    : rawLastYearTotals;
  const effectiveLastYearRes = lastYearInsufficient ? null : lastYearRes;

  const currentDates = Object.keys(currentRes.byDate).sort();
  let matchedDays = 0;

  const byDate: SalesRangeYoYResult['byDate'] = currentDates.map((date) => {
    const cur = currentRes.byDate[date];
    const lastYearDate = shiftDateOneYearBack(date);
    const lyDay = effectiveLastYearRes?.byDate[lastYearDate] ?? null;
    if (lyDay) matchedDays++;
    return {
      business_date: date,
      lastYearDate,
      current: {
        total_amount: cur.total_amount,
        transaction_count: cur.transaction_count,
        customer_count: cur.customer_count,
        new_customer_count: cur.new_customer_count ?? 0,
        repeat_customer_count: cur.repeat_customer_count ?? 0,
        regular_customer_count: cur.regular_customer_count ?? 0,
        staff_customer_count: cur.staff_customer_count ?? 0,
      },
      lastYear: lyDay
        ? {
            total_amount: lyDay.total_amount,
            transaction_count: lyDay.transaction_count,
            customer_count: lyDay.customer_count,
            new_customer_count: lyDay.new_customer_count ?? 0,
            repeat_customer_count: lyDay.repeat_customer_count ?? 0,
            regular_customer_count: lyDay.regular_customer_count ?? 0,
            staff_customer_count: lyDay.staff_customer_count ?? 0,
          }
        : null,
    };
  });

  const totalDays = currentDates.length;
  const dataCoverage = totalDays > 0 ? matchedDays / totalDays : 0;

  // 客数 YoY は表示客数と同じ「4 セグメント合計 (new+repeat+regular+staff)」を母数にする。
  // ユニークID系 currentTotals.customer_count (= SalesRangeTotal.customer_count) とは別母数。
  const currentCustomerTotal =
    currentTotals.new_customer_count +
    currentTotals.repeat_customer_count +
    currentTotals.regular_customer_count +
    currentTotals.staff_customer_count;
  const lastYearCustomerTotal =
    lastYearTotals != null
      ? lastYearTotals.new_customer_count +
        lastYearTotals.repeat_customer_count +
        lastYearTotals.regular_customer_count +
        lastYearTotals.staff_customer_count
      : null;

  // 売上 YoY は未決済 (open) 込みの母数を使う。
  // 決済済フィールド total_amount に open_total_amount を加えた値を当年・前年とも用いる。
  const currentSalesTotal =
    currentTotals.total_amount + currentTotals.open_total_amount;
  const lastYearSalesTotal =
    lastYearTotals != null
      ? lastYearTotals.total_amount + lastYearTotals.open_total_amount
      : null;

  const yoy = {
    total_amount: calculateYoY(currentSalesTotal, lastYearSalesTotal),
    transaction_count: calculateYoY(
      currentTotals.transaction_count,
      lastYearTotals?.transaction_count ?? null,
    ),
    // = 4 セグメント合計 (new+repeat+regular+staff)。ユニークID系 customer_count とは別母数。
    customer_count: calculateYoY(currentCustomerTotal, lastYearCustomerTotal),
    new_customer_count: calculateYoY(
      currentTotals.new_customer_count,
      lastYearTotals?.new_customer_count ?? null,
    ),
    repeat_customer_count: calculateYoY(
      currentTotals.repeat_customer_count,
      lastYearTotals?.repeat_customer_count ?? null,
    ),
    regular_customer_count: calculateYoY(
      currentTotals.regular_customer_count,
      lastYearTotals?.regular_customer_count ?? null,
    ),
    staff_customer_count: calculateYoY(
      currentTotals.staff_customer_count,
      lastYearTotals?.staff_customer_count ?? null,
    ),
  };

  return {
    period: { start: start_date, end: end_date },
    lastYearPeriod: { start: lastYearRange.start_date, end: lastYearRange.end_date },
    current: currentTotals,
    lastYear: lastYearTotals,
    yoy,
    dataCoverage,
    byDate,
  };
}
