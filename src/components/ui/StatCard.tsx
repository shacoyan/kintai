import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { Card } from './Card';
import { cn } from '../../lib/cn';

export type StatTrendDirection = 'up' | 'down' | 'flat';

export interface StatCardTrend {
  direction: StatTrendDirection;
  value: string;
  label?: string;
}

export interface StatCardProps {
  label: string;
  value: string | number | null | undefined;
  unit?: string;
  dashWhenZero?: boolean;
  trend?: StatCardTrend;
  hint?: string;
  icon?: React.ReactNode;
  className?: string;
}

const TREND_TONE: Record<StatTrendDirection, string> = {
  up: 'text-emerald-500 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/20',
  down: 'text-red-500 bg-red-50 dark:text-red-400 dark:bg-red-900/20',
  flat: 'text-stone-700 bg-stone-100 dark:text-stone-300 dark:bg-stone-700/40',
};

function TrendIcon({ direction }: { direction: StatTrendDirection }): JSX.Element {
  const props = { size: 12, 'aria-hidden': true } as const;
  if (direction === 'up') return <TrendingUp {...props} />;
  if (direction === 'down') return <TrendingDown {...props} />;
  return <Minus {...props} />;
}

export function StatCard(props: StatCardProps): JSX.Element {
  const { label, value, unit, dashWhenZero, trend, hint, icon, className } = props;
  const isDash =
    value === null ||
    value === undefined ||
    (dashWhenZero === true && value === 0);
  const displayValue = isDash ? '-' : value;
  const showUnit = !isDash && Boolean(unit);

  return (
    <Card padding="md" className={className}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-label text-stone-500 dark:text-stone-400">{label}</p>
        {icon ? (
          <span className="text-stone-500 dark:text-stone-400" aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-kpi-lg num tabular-nums text-stone-900 dark:text-stone-50">
        {displayValue}
        {showUnit ? (
          <span className="ml-1 text-[18px] font-semibold text-stone-500 dark:text-stone-400">
            {unit}
          </span>
        ) : null}
      </p>

      {(trend || hint) && (
        <div className="mt-3 flex items-center gap-2">
          {trend ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold num tabular-nums',
                TREND_TONE[trend.direction],
              )}
            >
              <TrendIcon direction={trend.direction} />
              <span>{trend.value}</span>
              {trend.label ? (
                <span className="font-normal opacity-80">{trend.label}</span>
              ) : null}
            </span>
          ) : null}
          {hint ? (
            <span className="text-sm text-stone-500 dark:text-stone-400">{hint}</span>
          ) : null}
        </div>
      )}
    </Card>
  );
}
