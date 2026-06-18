'use client';

import React, { memo } from 'react';
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
import { formatYen, formatYenCompact } from '../utils';
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

/** SP（≤640px）判定。matchMedia を購読し、PC/SP 切替時に再レンダーする。 */
function useIsSP(): boolean {
  const query = '(max-width: 640px)';
  const [isSP, setIsSP] = React.useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setIsSP(mql.matches);
    onChange();
    // Safari 旧版は addEventListener('change') 非対応 → addListener フォールバック
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  return isSP;
}

const LocationBarChart: React.FC<Props> = ({ rows }) => {
  const isSP = useIsSP();

  if (rows.length === 0) {
    return <EmptyState title={MSG.empty.location} minHeight={chartTheme.heightPreset.standard} />;
  }

  // 売上ラベル：0 は空、負値（返金）も短縮表示する
  const salesLabelFormatter = (v: number) =>
    typeof v === 'number' && Number.isFinite(v) && v !== 0 ? formatYenCompact(v) : '';
  // 客数ラベル：0 は空、負値も表示する
  const customerLabelFormatter = (v: number) =>
    typeof v === 'number' && Number.isFinite(v) && v !== 0 ? `${v}人` : '';

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="w-full min-w-0">
        <h3 className="text-sm font-semibold text-text mb-2">総売上</h3>
        <ChartFigure label="棒グラフ：店舗別の総売上および総客数比較">
          <ResponsiveContainer width="100%" height={chartTheme.heightPreset.standard}>
            <BarChart
              data={rows}
              layout={isSP ? 'vertical' : 'horizontal'}
              margin={isSP ? chartTheme.marginVerticalLayout : chartTheme.defaultMargin}
            >
              <CartesianGrid {...chartTheme.grid} />
              {isSP ? (
                <>
                  <XAxis
                    type="number"
                    tickFormatter={(value: number) => formatYenCompact(value)}
                    tick={chartTheme.axis.tickStyle}
                    tickLine={chartTheme.axis.tickLine}
                    axisLine={chartTheme.axis.axisLine}
                    stroke={chartTheme.axis.stroke}
                  />
                  <YAxis
                    type="category"
                    dataKey="locationName"
                    tick={chartTheme.axis.tickStyle}
                    tickLine={chartTheme.axis.tickLine}
                    axisLine={chartTheme.axis.axisLine}
                    stroke={chartTheme.axis.stroke}
                    width={96}
                  />
                </>
              ) : (
                <>
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
                    tickFormatter={(value: number) => formatYenCompact(value)}
                    tick={chartTheme.axis.tickStyle}
                    tickLine={chartTheme.axis.tickLine}
                    axisLine={chartTheme.axis.axisLine}
                    stroke={chartTheme.axis.stroke}
                    width={72}
                  />
                </>
              )}
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
              <Bar dataKey="totalSales" name="売上" barSize={isSP ? 16 : 20} isAnimationActive={false}>
                {rows.map((r, i) => (
                  <Cell key={r.locationName + i} fill={r.color} />
                ))}
                <LabelList
                  position={isSP ? 'right' : 'top'}
                  fontSize={10}
                  fill="#111827"
                  formatter={salesLabelFormatter}
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
            <BarChart
              data={rows}
              layout={isSP ? 'vertical' : 'horizontal'}
              margin={isSP ? chartTheme.marginVerticalLayout : chartTheme.defaultMargin}
            >
              <CartesianGrid {...chartTheme.grid} />
              {isSP ? (
                <>
                  <XAxis
                    type="number"
                    tickFormatter={(value: number) => `${value}人`}
                    tick={chartTheme.axis.tickStyle}
                    tickLine={chartTheme.axis.tickLine}
                    axisLine={chartTheme.axis.axisLine}
                    stroke={chartTheme.axis.stroke}
                  />
                  <YAxis
                    type="category"
                    dataKey="locationName"
                    tick={chartTheme.axis.tickStyle}
                    tickLine={chartTheme.axis.tickLine}
                    axisLine={chartTheme.axis.axisLine}
                    stroke={chartTheme.axis.stroke}
                    width={96}
                  />
                </>
              ) : (
                <>
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
                    width={48}
                  />
                </>
              )}
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
              <Bar dataKey="totalCustomers" name="客数" barSize={isSP ? 16 : 20} isAnimationActive={false}>
                {rows.map((r, i) => (
                  <Cell key={r.locationName + i} fill={r.color} />
                ))}
                <LabelList
                  position={isSP ? 'right' : 'top'}
                  fontSize={10}
                  fill="#111827"
                  formatter={customerLabelFormatter}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartFigure>
      </div>
    </div>
  );
};

export default memo(LocationBarChart);
