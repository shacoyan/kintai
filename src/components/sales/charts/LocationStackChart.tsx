'use client';

import { memo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
} from 'recharts';
import { ChartLegend, ChartTooltip, ChartFigure, type ChartLegendItem, EmptyState } from '../ui';
import { chartTheme } from '../../../lib/sales/chartTheme';
import { MSG } from '../../../lib/sales/messages';

interface Props {
  rows: Array<{ locationName: string; [key: string]: string | number }>;
  series: { key: string; label: string; color: string }[];
  valueUnit?: '人' | '件';
  emptyMessage?: string;
}

function LocationStackChart({ rows, series, valueUnit, emptyMessage }: Props) {
  const isEmpty =
    rows.length === 0 ||
    rows.every((row) =>
      series.every((s) => {
        const v = row[s.key];
        return typeof v !== 'number' || v === 0;
      })
    );

  if (isEmpty) {
    return (
      <EmptyState title={emptyMessage ?? MSG.empty.generic} minHeight={chartTheme.heightPreset.compact} />
    );
  }

  // 行数に応じて伸びるが、detail (400) を最低値として担保
  const chartHeight = Math.max(chartTheme.heightPreset.detail, rows.length * 48 + 80);
  const unit = valueUnit ?? '人';

  // dataKey 別に value + % 表示。payload (= 同一 X 軸上の全系列) から合計を再計算
  const formatters: Record<
    string,
    (
      value: number | string | Array<number | string>,
      name?: string | number,
      item?: { payload?: Record<string, unknown> }
    ) => string
  > = {};
  for (const s of series) {
    formatters[s.key] = (value, _name, item) => {
      const num = typeof value === 'number' ? value : Number(value) || 0;
      const rowPayload = (item?.payload ?? {}) as Record<string, unknown>;
      let sum = 0;
      for (const ss of series) {
        const v = rowPayload[ss.key];
        if (typeof v === 'number') sum += v;
      }
      const pct = sum > 0 ? Math.round((num / sum) * 100) : null;
      return pct !== null ? `${num}${unit} (${pct}%)` : `${num}${unit}`;
    };
  }

  const legendItems: ChartLegendItem[] = series.map((s) => ({
    id: s.key,
    label: s.label,
    color: s.color,
  }));

  return (
    <div className="w-full min-w-0">
      <ChartLegend items={legendItems} size="sm" align="center" className="mb-2" />
      <div className="w-full min-w-0" style={{ height: `${chartHeight}px` }}>
        <ChartFigure label="積み上げ棒グラフ：店舗別の構成内訳">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={chartTheme.marginVerticalLayout}>
              <CartesianGrid {...chartTheme.grid} />
              <XAxis
                type="number"
                tick={chartTheme.axis.tickStyle}
                tickLine={chartTheme.axis.tickLine}
                axisLine={chartTheme.axis.axisLine}
                stroke={chartTheme.axis.stroke}
              />
              <YAxis
                type="category"
                dataKey="locationName"
                width={140}
                tick={chartTheme.axis.tickStyle}
                tickLine={chartTheme.axis.tickLine}
                axisLine={chartTheme.axis.axisLine}
                stroke={chartTheme.axis.stroke}
              />
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                content={(p) => (
                  <ChartTooltip
                    active={p.active}
                    payload={p.payload as never}
                    label={p.label as string | number | undefined}
                    formatters={formatters}
                  />
                )}
              />
              {series.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stackId="a"
                  fill={s.color}
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey={s.key}
                    position="insideRight"
                    fill="#fff"
                    fontSize={10}
                    formatter={(v: number) => (typeof v === 'number' && v > 0 ? String(v) : '')}
                  />
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartFigure>
      </div>
    </div>
  );
}

export default memo(LocationStackChart);
