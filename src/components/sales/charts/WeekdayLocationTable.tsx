import { memo } from 'react';
import type { WeekdayLocationAggregate } from '../../../lib/sales/weekdayLocationAggregation';
import { formatYen } from '../utils';

interface LocationMeta {
  locationId: string;
  locationName: string;
}

interface Props {
  data: WeekdayLocationAggregate[];
  locationSeries: LocationMeta[];
  metric: 'customers' | 'sales';
}

function formatVal(v: number, metric: 'customers' | 'sales'): string {
  const safe = Number.isFinite(v) ? v : 0;
  if (metric === 'customers') {
    const guarded = safe < 0 ? 0 : safe;
    return `${(Math.round(guarded * 10) / 10).toFixed(1)}人`;
  }
  return formatYen(Math.round(safe));
}

function WeekdayLocationTable({ data, locationSeries, metric }: Props) {
  // 列合計 (店舗ごと) ＋ 全体合計 ＋ サンプル累計
  const locationTotals = new Map<string, number>();
  locationSeries.forEach((l) => locationTotals.set(l.locationId, 0));
  let grandTotal = 0;
  let sampleTotal = 0;

  for (const d of data) {
    for (const cell of d.perLocation) {
      const raw = metric === 'customers' ? cell.customers : cell.sales;
      const v = Number.isFinite(raw) ? raw : 0;
      locationTotals.set(cell.locationId, (locationTotals.get(cell.locationId) ?? 0) + v);
    }
    const rowTotal = metric === 'customers' ? d.totalCustomers : d.totalSales;
    grandTotal += Number.isFinite(rowTotal) ? rowTotal : 0;
    sampleTotal += d.sampleCount;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-xs sm:text-sm">
        <thead>
          <tr className="bg-stone-50 dark:bg-stone-800">
            <th className="border border-stone-200 dark:border-stone-700 px-3 py-2 text-left font-medium text-stone-500 dark:text-stone-400">
              曜日
            </th>
            {locationSeries.map((loc) => (
              <th
                key={loc.locationId}
                className="border border-stone-200 dark:border-stone-700 px-3 py-2 text-right font-medium text-stone-500 dark:text-stone-400 whitespace-nowrap"
              >
                {loc.locationName}
              </th>
            ))}
            <th className="border border-stone-200 dark:border-stone-700 px-3 py-2 text-right font-medium text-stone-500 dark:text-stone-400">
              合計
            </th>
            <th className="border border-stone-200 dark:border-stone-700 px-3 py-2 text-right font-medium text-stone-500 dark:text-stone-400">
              サンプル(日数)
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => {
            const isZeroSample = d.sampleCount === 0;
            const rowTotal = metric === 'customers' ? d.totalCustomers : d.totalSales;

            return (
              <tr key={d.label} className={isZeroSample ? 'text-stone-400 dark:text-stone-500' : 'text-stone-700 dark:text-stone-300'}>
                <td className="border border-stone-200 dark:border-stone-700 px-3 py-2 font-medium">{d.label}</td>
                {locationSeries.map((loc) => {
                  const cell = d.perLocation.find((c) => c.locationId === loc.locationId);
                  const v = cell ? (metric === 'customers' ? cell.customers : cell.sales) : 0;
                  return (
                    <td
                      key={loc.locationId}
                      className="border border-stone-200 dark:border-stone-700 px-3 py-2 text-right tabular-nums"
                    >
                      {isZeroSample ? '--' : formatVal(v, metric)}
                    </td>
                  );
                })}
                <td className="border border-stone-200 dark:border-stone-700 px-3 py-2 text-right tabular-nums">
                  {isZeroSample ? '--' : formatVal(rowTotal, metric)}
                </td>
                <td className="border border-stone-200 dark:border-stone-700 px-3 py-2 text-right tabular-nums">
                  {isZeroSample ? '--' : d.sampleCount}
                </td>
              </tr>
            );
          })}

          <tr className="bg-stone-50 dark:bg-stone-800 font-medium text-stone-700 dark:text-stone-300">
            <td className="border border-stone-200 dark:border-stone-700 px-3 py-2">合計</td>
            {locationSeries.map((loc) => {
              const v = locationTotals.get(loc.locationId) ?? 0;
              return (
                <td
                  key={loc.locationId}
                  className="border border-stone-200 dark:border-stone-700 px-3 py-2 text-right tabular-nums"
                >
                  {formatVal(v, metric)}
                </td>
              );
            })}
            <td className="border border-stone-200 dark:border-stone-700 px-3 py-2 text-right tabular-nums">
              {formatVal(grandTotal, metric)}
            </td>
            <td className="border border-stone-200 dark:border-stone-700 px-3 py-2 text-right tabular-nums">
              {sampleTotal}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default memo(WeekdayLocationTable);
