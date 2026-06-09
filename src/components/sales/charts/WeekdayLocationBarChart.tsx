'use client';

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { formatYen } from '../utils';
import type { WeekdayLocationAggregate } from '../../../lib/sales/weekdayLocationAggregation';
import { ChartLegend, ChartTooltip, ChartFigure, type ChartLegendItem, EmptyState } from '../ui';
import { chartTheme } from '../../../lib/sales/chartTheme';
import { FALLBACK_LOCATION_COLOR } from '../../../lib/sales/locationColors';
import { MSG } from '../../../lib/sales/messages';

interface LocationMeta {
  locationId: string;
  locationName: string;
}

interface Props {
  data: WeekdayLocationAggregate[];
  locationSeries: LocationMeta[];
  colorMap: Record<string, string>;
  metric: 'customers' | 'sales';
}

const WEEKDAY_FULL_NAMES: Record<string, string> = {
  月: '月曜日',
  火: '火曜日',
  水: '水曜日',
  木: '木曜日',
  金: '金曜日',
  土: '土曜日',
  日: '日曜日',
};

function formatByMetric(v: number | string | Array<number | string>, metric: 'customers' | 'sales'): string {
  const n = typeof v === 'number' ? v : Number(v) || 0;
  if (metric === 'customers') {
    return (Math.round(n * 10) / 10).toFixed(1);
  }
  return formatYen(Math.round(n));
}

export default function WeekdayLocationBarChart({
  data,
  locationSeries,
  colorMap,
  metric,
}: Props) {
  const hasData = data.some((d) => d.sampleCount > 0);

  if (!hasData) {
    return (
      <EmptyState title={MSG.empty.weekday} minHeight={chartTheme.heightPreset.compact} />
    );
  }

  const chartData = data.map((d) => {
    const row: Record<string, string | number> = {
      label: d.label,
      sampleCount: d.sampleCount,
    };
    for (const loc of locationSeries) {
      const cell = d.perLocation.find((c) => c.locationId === loc.locationId);
      const v = cell ? (metric === 'customers' ? cell.customers : cell.sales) : 0;
      row[loc.locationId] = v;
    }
    return row;
  });

  const legendItems: ChartLegendItem[] = locationSeries.map((loc) => ({
    id: loc.locationId,
    label: loc.locationName,
    color: colorMap[loc.locationId] ?? FALLBACK_LOCATION_COLOR,
  }));

  // dataKey (locationId) 別 formatter
  const formatters: Record<string, (v: number | string | Array<number | string>) => string> = {};
  for (const loc of locationSeries) {
    formatters[loc.locationId] = (v) => formatByMetric(v, metric);
  }

  return (
    <div className="w-full min-w-0">
      <ChartFigure label="積み上げ棒グラフ：曜日別の客数または売上を店舗別に集計">
        <ResponsiveContainer width="100%" height={chartTheme.heightPreset.detail}>
          <BarChart data={chartData} margin={chartTheme.defaultMargin}>
            <CartesianGrid {...chartTheme.grid} />
            <XAxis
              dataKey="label"
              tick={chartTheme.axis.tickStyle}
              axisLine={chartTheme.axis.axisLine}
              tickLine={chartTheme.axis.tickLine}
            />
            <YAxis
              tick={chartTheme.axis.tickStyle}
              axisLine={chartTheme.axis.axisLine}
              tickLine={chartTheme.axis.tickLine}
              allowDecimals={metric === 'customers' ? false : true}
              tickFormatter={metric === 'sales' ? (v: number) => formatYen(v) : undefined}
            />
            <Tooltip
              content={(p) => (
                <ChartTooltip
                  active={p.active}
                  payload={p.payload as never}
                  label={p.label as string | number | undefined}
                  formatters={formatters}
                  labelFormatter={(l) => WEEKDAY_FULL_NAMES[String(l)] ?? String(l)}
                />
              )}
            />
            {locationSeries.map((loc) => (
              <Bar
                key={loc.locationId}
                dataKey={loc.locationId}
                name={loc.locationName}
                stackId="a"
                fill={colorMap[loc.locationId] ?? FALLBACK_LOCATION_COLOR}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartFigure>
      <ChartLegend size="sm" items={legendItems} />
    </div>
  );
}
