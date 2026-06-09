import type { DailySegmentPoint } from './types';

export const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'] as const;

export interface WeekdayAggregate {
  weekday: number;
  label: string;
  new: number;
  repeat: number;
  regular: number;
  staff: number;
  unlisted: number;
  totalCustomers: number;
  newSales: number;
  repeatSales: number;
  regularSales: number;
  staffSales: number;
  unlistedSales: number;
  totalSales: number;
  sampleCount: number;
}

type SegmentKey = 'new' | 'repeat' | 'regular' | 'staff' | 'unlisted';
type SalesKey = 'newSales' | 'repeatSales' | 'regularSales' | 'staffSales' | 'unlistedSales';

const SEGMENT_KEYS: readonly SegmentKey[] = ['new', 'repeat', 'regular', 'staff', 'unlisted'];
const SALES_KEYS: readonly SalesKey[] = ['newSales', 'repeatSales', 'regularSales', 'staffSales', 'unlistedSales'];

interface Accumulator {
  new: number;
  repeat: number;
  regular: number;
  staff: number;
  unlisted: number;
  newSales: number;
  repeatSales: number;
  regularSales: number;
  staffSales: number;
  unlistedSales: number;
  count: number;
}

const INITIAL_ACCUMULATOR: Readonly<Accumulator> = {
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
  count: 0,
};

const createInitialAccumulators = (): Accumulator[] =>
  Array.from<Accumulator>({ length: 7 }).map(() => ({ ...INITIAL_ACCUMULATOR }));

const toMondayBasedWeekday = (jsDay: number): number => (jsDay === 0 ? 6 : jsDay - 1);

const parseDateToWeekday = (dateString: string): number => {
  const [year, month, day] = dateString.split('-').map(Number);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return toMondayBasedWeekday(jsDay);
};

const accumulatePoint = (accs: Accumulator[], point: DailySegmentPoint): void => {
  const weekday = parseDateToWeekday(point.date);
  const acc = accs[weekday];

  for (const key of SEGMENT_KEYS) {
    acc[key] += point[key];
  }

  for (const key of SALES_KEYS) {
    acc[key] += point[key];
  }

  acc.count += 1;
};

const buildWeekdayAggregate = (
  acc: Accumulator,
  weekday: number,
  mode: 'average' | 'sum',
): WeekdayAggregate => {
  const divisor = mode === 'average' && acc.count > 0 ? acc.count : 1;

  if (mode === 'average' && acc.count === 0) {
    return {
      weekday,
      label: WEEKDAY_LABELS[weekday],
      new: 0,
      repeat: 0,
      regular: 0,
      staff: 0,
      unlisted: 0,
      totalCustomers: 0,
      newSales: 0,
      repeatSales: 0,
      regularSales: 0,
      staffSales: 0,
      unlistedSales: 0,
      totalSales: 0,
      sampleCount: 0,
    };
  }

  const newCustomers = acc.new / divisor;
  const repeatCustomers = acc.repeat / divisor;
  const regularCustomers = acc.regular / divisor;
  const staffCustomers = acc.staff / divisor;
  const unlistedCustomers = acc.unlisted / divisor;

  const newSales = acc.newSales / divisor;
  const repeatSales = acc.repeatSales / divisor;
  const regularSales = acc.regularSales / divisor;
  const staffSales = acc.staffSales / divisor;
  const unlistedSales = acc.unlistedSales / divisor;

  return {
    weekday,
    label: WEEKDAY_LABELS[weekday],
    new: newCustomers,
    repeat: repeatCustomers,
    regular: regularCustomers,
    staff: staffCustomers,
    unlisted: unlistedCustomers,
    totalCustomers: newCustomers + repeatCustomers + regularCustomers + staffCustomers,
    newSales,
    repeatSales,
    regularSales,
    staffSales,
    unlistedSales,
    totalSales: newSales + repeatSales + regularSales + staffSales + unlistedSales,
    sampleCount: acc.count,
  };
};

export const aggregateByWeekday = (
  points: DailySegmentPoint[],
  mode: 'average' | 'sum' = 'average',
): WeekdayAggregate[] => {
  const accs = createInitialAccumulators();

  for (const point of points) {
    accumulatePoint(accs, point);
  }

  return accs.map((acc, weekday) => buildWeekdayAggregate(acc, weekday, mode));
};
