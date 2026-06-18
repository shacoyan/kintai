'use client';

import { memo } from 'react';
import type { WeekdayAggregate } from '../../../lib/sales/weekdayAggregation';
import { formatYen } from '../utils';
import { ChartFigure, ChartLegend, ChartTooltip, type ChartLegendItem, EmptyState } from '../ui';
import { chartTheme } from '../../../lib/sales/chartTheme';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { FALLBACK_LOCATION_COLOR } from '../../../lib/sales/locationColors';
import { MSG } from '../../../lib/sales/messages';

interface Props {
  data: WeekdayAggregate[];
  metric: 'customers' | 'sales';
  stacked?: boolean;
}

const SEGMENT_CONFIG = [
  { key: 'new', label: '新規', color: '#3b82f6' },
  { key: 'repeat', label: 'リピート', color: '#eab308' },
  { key: 'regular', label: '常連', color: '#ef4444' },
  { key: 'staff', label: 'スタッフ', color: '#a855f7' },
  { key: 'unlisted', label: '記載なし', color: FALLBACK_LOCATION_COLOR },
] as const;

type SegmentKey = (typeof SEGMENT_CONFIG)[number]['key'];

function getSegmentKeys(): SegmentKey[] {
  return SEGMENT_CONFIG.map((s) => s.key);
}

function getDataKey(segmentKey: SegmentKey, metric: Props['metric']): string {
  if (metric === 'customers') return segmentKey;
  return `${segmentKey}Sales`;
}

function getSegmentLabel(segmentKey: SegmentKey): string {
  const config = SEGMENT_CONFIG.find((s) => s.key === segmentKey);
  return config ? config.label : segmentKey;
}

function getSegmentColor(segmentKey: SegmentKey): string {
  const config = SEGMENT_CONFIG.find((s) => s.key === segmentKey);
  return config ? config.color : FALLBACK_LOCATION_COLOR;
}

const WEEKDAY_NAMES: Record<string, string> = {
  月: '月曜日',
  火: '火曜日',
  水: '水曜日',
  木: '木曜日',
  金: '金曜日',
  土: '土曜日',
  日: '日曜日',
};

// 値整形ヘルパー（旧ロジック踏襲、設計書 §242）
function formatByMetric(val: number | string | Array<number | string>, metric: Props['metric']): string {
  const n = typeof val === 'number' ? val : Number(val) || 0;
  if (metric === 'customers') {
    return (Math.round(n * 10) / 10).toFixed(1);
  }
  return formatYen(Math.round(n));
}

function WeekdayBarChart({ data, metric, stacked = true }: Props) {
  const hasData = data.some((d) => d.sampleCount > 0);

  if (!hasData) {
    return (
      <EmptyState title={MSG.empty.weekday} minHeight={chartTheme.heightPreset.compact} />
    );
  }

  const segmentKeys = getSegmentKeys();

  const legendItems: ChartLegendItem[] = SEGMENT_CONFIG.map((s) => ({
    id: s.key,
    label: s.label,
    color: s.color,
  }));

  // dataKey 別 formatter: customers なら "new"/"repeat"/..., sales なら "newSales"/...
  const formatters: Record<string, (v: number | string | Array<number | string>) => string> = {};
  for (const key of segmentKeys) {
    const dk = getDataKey(key, metric);
    formatters[dk] = (v) => formatByMetric(v, metric);
  }

  return (
    <div className="w-full min-w-0">
      <ChartFigure label="積み上げ棒グラフ：曜日別の客数または売上をセグメント別に集計">
        <ResponsiveContainer width="100%" height={chartTheme.heightPreset.compact}>
          <BarChart data={data} margin={chartTheme.defaultMargin}>
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
                  labelFormatter={(l) => WEEKDAY_NAMES[String(l)] ?? String(l)}
                />
              )}
            />
            {segmentKeys.map((key) => {
              const dataKey = getDataKey(key, metric);
              return (
                <Bar
                  key={key}
                  dataKey={dataKey}
                  name={getSegmentLabel(key)}
                  stackId={stacked ? 'a' : undefined}
                  fill={getSegmentColor(key)}
                  isAnimationActive={false}
                />
              );
            })}
          </BarChart>
        </ResponsiveContainer>
      </ChartFigure>
      <ChartLegend size="sm" items={legendItems} />
    </div>
  );
}

export default memo(WeekdayBarChart);
