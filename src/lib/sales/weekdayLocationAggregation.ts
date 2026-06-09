import type { DailySegmentPoint } from './types';

export interface LocationWeekdayCell {
  locationId: string;
  customers: number;  // unlisted を含まない (new+repeat+regular+staff)
  sales: number;      // unlisted を含む
}

export interface WeekdayLocationAggregate {
  weekday: number; // 0=月..6=日
  label: string;
  perLocation: LocationWeekdayCell[]; // 入力順で保持
  totalCustomers: number; // 全店合算(unlisted除外)
  totalSales: number;     // 全店合算(unlisted含む)
  sampleCount: number;    // 当該曜日が出現した日付のユニーク数
}

export interface LocationSeriesInput {
  locationId: string;
  locationName: string;
  points: DailySegmentPoint[];
}

const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];

function parseDateToWeekday(dateStr: string): number {
  const parts = dateStr.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (dow === 0) return 6;
  return dow - 1;
}

export function aggregateByWeekdayPerLocation(
  locationSeries: LocationSeriesInput[],
  mode: 'average' | 'sum',
): WeekdayLocationAggregate[] {
  const locationIds = locationSeries.map(l => l.locationId);

  const accCustomers = new Map<string, number[]>();
  const accSales = new Map<string, number[]>();
  const sampleDates = Array.from({ length: 7 }, () => new Set<string>());

  locationIds.forEach(id => {
    accCustomers.set(id, new Array(7).fill(0));
    accSales.set(id, new Array(7).fill(0));
  });

  for (const location of locationSeries) {
    const cArr = accCustomers.get(location.locationId)!;
    const sArr = accSales.get(location.locationId)!;

    for (const p of location.points) {
      const w = parseDateToWeekday(p.date);
      cArr[w] += (p.new || 0) + (p.repeat || 0) + (p.regular || 0) + (p.staff || 0);
      sArr[w] += (p.newSales || 0) + (p.repeatSales || 0) + (p.regularSales || 0) + (p.staffSales || 0) + (p.unlistedSales || 0);
      sampleDates[w].add(p.date);
    }
  }

  const results: WeekdayLocationAggregate[] = [];

  for (let w = 0; w < 7; w++) {
    const sampleCount = sampleDates[w].size;
    const divisor = mode === 'average' ? Math.max(1, sampleCount) : 1;

    const perLocation: LocationWeekdayCell[] = locationIds.map(id => {
      const c = (accCustomers.get(id)![w]) / divisor;
      const s = (accSales.get(id)![w]) / divisor;
      return {
        locationId: id,
        customers: c,
        sales: s,
      };
    });

    const totalCustomers = perLocation.reduce((sum, loc) => sum + loc.customers, 0);
    const totalSales = perLocation.reduce((sum, loc) => sum + loc.sales, 0);

    results.push({
      weekday: w,
      label: WEEKDAY_LABELS[w],
      perLocation,
      totalCustomers,
      totalSales,
      sampleCount,
    });
  }

  return results;
}
