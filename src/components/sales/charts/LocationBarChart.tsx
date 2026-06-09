'use client';

import React from 'react';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from 'recharts';
import { formatYen } from '../utils';
import { chartTheme } from '../../../lib/sales/chartTheme';
import { ChartTooltip, EmptyState, ChartFigure } from '../ui';
import { MSG } from '../../../lib/sales/messages';

interface RowData {
  locationName: string;
  totalSales: number;
  totalCustomers: number;
  color: string;
}

interface Props {
  rows: RowData[];
}

const LocationBarChart: React.FC<Props> = ({ rows }) => {
  if (rows.length === 0) {
    return <EmptyState title={MSG.empty.location} minHeight={chartTheme.heightPreset.standard} />;
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="w-full min-w-0">
        <h3 className="text-sm font-semibold text-text mb-2">総売上</h3>
        <ChartFigure label="棒グラフ：店舗別の総売上および総客数比較">
          <ResponsiveContainer width="100%" height={chartTheme.heightPreset.standard}>
            <BarChart data={rows} margin={chartTheme.defaultMargin}>
              <CartesianGrid {...chartTheme.grid} />
              <XAxis
                dataKey="locationName"
                tick={chartTheme.axis.tickStyle}
                tickLine={chartTheme.axis.tickLine}
                axisLine={chartTheme.axis.axisLine}
                stroke={chartTheme.axis.stroke}
                angle={rows.length > 5 ? -20 : 0}
                textAnchor={rows.length > 5 ? 'end' : 'middle'}
                height={60}
              />
              <YAxis
                tickFormatter={(value: number) => formatYen(value)}
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
                    hideName
                    formatters={{
                      totalSales: (v) => formatYen(Number(v) || 0),
                    }}
                  />
                )}
              />
              <Bar dataKey="totalSales" name="売上" barSize={20}>
                {rows.map((r, i) => (
                  <Cell key={r.locationName + i} fill={r.color} />
                ))}
                <LabelList
                  position="top"
                  fontSize={10}
                  fill="#111827"
                  formatter={(v: number) => (typeof v === 'number' && v > 0 ? formatYen(v) : '')}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartFigure>
      </div>

      <div className="w-full min-w-0">
        <h3 className="text-sm font-semibold text-text mb-2">総客数</h3>
        <ChartFigure label="棒グラフ：店舗別の総売上および総客数比較">
          <ResponsiveContainer width="100%" height={chartTheme.heightPreset.standard}>
            <BarChart data={rows} margin={chartTheme.defaultMargin}>
              <CartesianGrid {...chartTheme.grid} />
              <XAxis
                dataKey="locationName"
                tick={chartTheme.axis.tickStyle}
                tickLine={chartTheme.axis.tickLine}
                axisLine={chartTheme.axis.axisLine}
                stroke={chartTheme.axis.stroke}
                angle={rows.length > 5 ? -20 : 0}
                textAnchor={rows.length > 5 ? 'end' : 'middle'}
                height={60}
              />
              <YAxis
                tickFormatter={(value: number) => `${value}人`}
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
                    hideName
                    formatters={{
                      totalCustomers: (v) => `${Number(v) || 0}人`,
                    }}
                  />
                )}
              />
              <Bar dataKey="totalCustomers" name="客数" barSize={20}>
                {rows.map((r, i) => (
                  <Cell key={r.locationName + i} fill={r.color} />
                ))}
                <LabelList
                  position="top"
                  fontSize={10}
                  fill="#111827"
                  formatter={(v: number) => (typeof v === 'number' && v > 0 ? `${v}人` : '')}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartFigure>
      </div>
    </div>
  );
};

export default LocationBarChart;
