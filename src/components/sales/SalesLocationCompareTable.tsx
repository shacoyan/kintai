import { Card } from '../ui';
import { formatYen } from './utils';
import { formatYoY } from '../../lib/sales/yoy';
import type { LocationCompareRow, LocationCompareTableData } from '../../lib/sales/locationCompareTable';
import type { YoYClassification, YoYDelta } from '../../lib/sales/yoy';

// =============================================================================
// SalesLocationCompareTable — 全店舗比較テーブル（表示専用・設計書 §6-D）
// -----------------------------------------------------------------------------
// buildLocationCompareTable（Engineer C）の出力をそのまま描画する。データ算出は
// 一切行わない（丸め・null 判定のみ表示側の責務）。
//
//   - 列: 店舗名 | 期間売上 | 平均日売上 | 客単価 | 合計客数 | 新規 | リピート |
//     常連 | スタッフ | 記載なし売上 | Google | 口コミ | 看板 | SNS | 不明。
//   - 先頭 4 数値列の下に YoY 小行（formatYoY compact）。no_data / delta なしは
//     描画しない（D6）。色は StatCard TREND_TONE 準拠のローカル map
//     （yoyClassToColorClass は使わない = kintai に無い CSS クラスを返すため）。
//   - 店舗名列 sticky left-0（不透過背景・dark 両対応）。overflow-x-auto。
//   - null は `--`。金額は formatYen 固定（K/M/Compact 禁止）。
// =============================================================================

/** YoY 小行の色トーン（StatCard TREND_TONE 準拠。yoyClassToColorClass は不使用）。 */
const YOY_TONE: Record<'up' | 'down' | 'flat', string> = {
  up: 'text-emerald-600 dark:text-emerald-400',
  down: 'text-red-600 dark:text-red-400',
  flat: 'text-stone-500 dark:text-stone-400',
};

function yoyToneClass(classification: YoYClassification): string {
  if (classification === 'no_data') return '';
  return YOY_TONE[classification];
}

/** null → '--'。0 も正しく表示する（0 は有効値）。 */
function fmtYenOrDash(v: number | null): string {
  return v === null ? '--' : formatYen(Math.round(v));
}

function fmtCountOrDash(v: number | null): string {
  return v === null ? '--' : v.toLocaleString('ja-JP');
}

/** YoY 小行を描画する。no_data・delta なしは何も描かない（D6）。 */
function YoYSubRow({
  delta,
  formatLastYear,
}: {
  delta: YoYDelta | undefined;
  formatLastYear: (v: number) => string;
}) {
  if (!delta || delta.classification === 'no_data' || delta.deltaPercent === null) {
    return null;
  }
  return (
    <div className={`mt-0.5 text-xs ${yoyToneClass(delta.classification)}`}>
      {formatYoY(delta, { compact: true, formatLastYear })}
    </div>
  );
}

interface SalesLocationCompareTableProps {
  data: LocationCompareTableData;
  /** month/quarter/year のみ true（week/指定日は YoY 小行を出さない）。 */
  showYoY: boolean;
  /** 期間表示用。 */
  from: string;
  to: string;
  elapsedDays: number;
  /** 獲得経路 92 日クランプが効いた場合 true。 */
  acquisitionClamped: boolean;
  /** 獲得経路の取得に失敗した店舗名（該当 5 列のみ `--`）。 */
  acquisitionFailedStores: string[];
  /** 獲得経路 hook 取得中フラグ（取得中は 5 列 `--` + 注記）。 */
  acquisitionLoading: boolean;
  /** /api/locations 失敗等・獲得経路の全文エラー。 */
  acquisitionError: string | null;
  /** 前年同期 071 取得のエラー（全文）。 */
  lastYearError: string | null;
}

const STICKY_CELL = 'sticky left-0 bg-white dark:bg-stone-900';
const STICKY_TOTALS_CELL = 'sticky left-0 bg-stone-50 dark:bg-stone-800';

function CompareRow({
  row,
  showYoY,
  isTotals,
}: {
  row: LocationCompareRow;
  showYoY: boolean;
  isTotals: boolean;
}) {
  const stickyCls = isTotals ? STICKY_TOTALS_CELL : STICKY_CELL;
  const rowCls = isTotals
    ? 'font-semibold bg-stone-50 dark:bg-stone-800'
    : 'border-b border-stone-100 dark:border-stone-800';

  return (
    <tr className={rowCls}>
      <td className={`px-3 py-2.5 text-left whitespace-nowrap ${stickyCls} ${isTotals ? 'font-semibold' : ''}`}>
        {row.locationName}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {fmtYenOrDash(row.totalSales)}
        {showYoY && <YoYSubRow delta={row.yoy?.totalSales} formatLastYear={(v) => formatYen(Math.round(v))} />}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {fmtYenOrDash(row.averageDailySales)}
        {showYoY && (
          <YoYSubRow delta={row.yoy?.avgDailySales} formatLastYear={(v) => formatYen(Math.round(v))} />
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {fmtYenOrDash(row.perCustomer)}
        {showYoY && (
          <YoYSubRow delta={row.yoy?.perCustomer} formatLastYear={(v) => formatYen(Math.round(v))} />
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {fmtCountOrDash(row.totalCustomers)}
        {showYoY && (
          <YoYSubRow
            delta={row.yoy?.totalCustomers}
            formatLastYear={(v) => v.toLocaleString('ja-JP')}
          />
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {row.seg === null ? '--' : fmtCountOrDash(row.seg.new)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {row.seg === null ? '--' : fmtCountOrDash(row.seg.repeat)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {row.seg === null ? '--' : fmtCountOrDash(row.seg.regular)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {row.seg === null ? '--' : fmtCountOrDash(row.seg.staff)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {row.seg === null ? '--' : fmtYenOrDash(row.seg.unlistedSales)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {row.acquisition === null ? '--' : fmtCountOrDash(row.acquisition.google)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {row.acquisition === null ? '--' : fmtCountOrDash(row.acquisition.review)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {row.acquisition === null ? '--' : fmtCountOrDash(row.acquisition.signboard)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {row.acquisition === null ? '--' : fmtCountOrDash(row.acquisition.sns)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {row.acquisition === null ? '--' : fmtCountOrDash(row.acquisition.unknown)}
      </td>
    </tr>
  );
}

const HEADER_COLUMNS = [
  { key: 'name', label: '店舗名', align: 'text-left' },
  { key: 'totalSales', label: '期間売上', align: 'text-right' },
  { key: 'avgDaily', label: '平均日売上', align: 'text-right' },
  { key: 'perCustomer', label: '客単価', align: 'text-right' },
  { key: 'totalCustomers', label: '合計客数', align: 'text-right' },
  { key: 'new', label: '新規', align: 'text-right' },
  { key: 'repeat', label: 'リピート', align: 'text-right' },
  { key: 'regular', label: '常連', align: 'text-right' },
  { key: 'staff', label: 'スタッフ', align: 'text-right' },
  { key: 'unlistedSales', label: '記載なし売上', align: 'text-right' },
  { key: 'google', label: 'Google', align: 'text-right' },
  { key: 'review', label: '口コミ', align: 'text-right' },
  { key: 'signboard', label: '看板', align: 'text-right' },
  { key: 'sns', label: 'SNS', align: 'text-right' },
  { key: 'unknown', label: '不明', align: 'text-right' },
] as const;

export default function SalesLocationCompareTable({
  data,
  showYoY,
  from,
  to,
  elapsedDays,
  acquisitionClamped,
  acquisitionFailedStores,
  acquisitionLoading,
  acquisitionError,
  lastYearError,
}: SalesLocationCompareTableProps) {
  return (
    <Card>
      <h2 className="mb-2 text-sm font-semibold text-stone-700 dark:text-stone-200">
        全店舗比較
      </h2>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <caption className="sr-only">店舗別の売上・客数・獲得経路の比較一覧</caption>
          <thead>
            <tr className="border-b border-stone-200 text-xs text-stone-500 dark:border-stone-700 dark:text-stone-400">
              {HEADER_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`px-3 py-2 font-medium whitespace-nowrap ${col.align} ${
                    col.key === 'name' ? STICKY_CELL : ''
                  }`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <CompareRow key={row.locationName} row={row} showYoY={showYoY} isTotals={false} />
            ))}
            <CompareRow row={data.totals} showYoY={showYoY} isTotals />
          </tbody>
        </table>
      </div>

      <div className="mt-2 space-y-0.5 text-xs text-stone-500 dark:text-stone-400">
        <p>
          期間: {from} 〜 {to}（{elapsedDays}日間）
        </p>
        {acquisitionLoading && <p>獲得経路を集計中…</p>}
        {acquisitionClamped && <p>獲得経路5列は直近約3ヶ月の新規客内訳</p>}
        {acquisitionFailedStores.length > 0 && (
          <p>
            獲得経路の取得に失敗した店舗: {acquisitionFailedStores.join('、')}（該当5列のみ --。売上・客数には影響していません）
          </p>
        )}
        {acquisitionError && <p>獲得経路の取得エラー: {acquisitionError}</p>}
        {lastYearError && <p>前年同期データの取得エラー: {lastYearError}</p>}
      </div>
    </Card>
  );
}
