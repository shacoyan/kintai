'use client';

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import type { SegmentBreakdown } from '../../../lib/sales/types';
import { ChartLegend, ChartTooltip, ChartFigure } from '../ui';
import { chartTheme } from '../../../lib/sales/chartTheme';
import { segmentColors, segmentEmptyColor } from '../../../lib/sales/segmentColors';
import { MSG } from '../../../lib/sales/messages';

interface Props {
  sales: SegmentBreakdown;
}

const SEGMENT_ORDER: (keyof SegmentBreakdown)[] = ['new', 'repeat', 'regular', 'staff', 'unlisted'];

const LABELS: Record<keyof SegmentBreakdown, string> = {
  new: '新規',
  repeat: 'リピート',
  regular: '常連',
  staff: 'スタッフ',
  unlisted: '記載なし',
};

export default function SegmentPieChart({ sales }: Props) {
  const total = sales.new + sales.repeat + sales.regular + sales.staff + sales.unlisted;

  const data = total === 0
    ? [{ name: 'データなし', value: 1, segment: 'new' as const }]
    : SEGMENT_ORDER.map((segment) => ({ name: LABELS[segment], value: sales[segment], segment }));

  const legendItems = SEGMENT_ORDER.map(s => ({ id: s, label: LABELS[s], color: segmentColors[s] }));

  return (
    <div className="w-full min-w-0 space-y-3">
      <div className="w-full min-w-0">
        <ChartFigure label="円グラフ：セグメント別売上構成（新規・リピート・常連・スタッフ・記載なし）">
          <ResponsiveContainer width="100%" height={chartTheme.heightPreset.standard}>
            <PieChart margin={chartTheme.marginPie}>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={110}
                paddingAngle={total === 0 ? 0 : 2}
                dataKey="value"
              >
                {data.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={total === 0 ? segmentEmptyColor : segmentColors[entry.segment]}
                    stroke="none"
                  />
                ))}
              </Pie>
              {total > 0 && (
                <Tooltip
                  cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                  content={(p) => (
                    <ChartTooltip
                      active={p.active}
                      payload={p.payload as never}
                      label={p.label as string | number | undefined}
                      formatters={{
                        value: (value: number | string | Array<number | string>) => {
                          const num = Number(value);
                          const percent = total === 0 ? 0 : num / total;
                          return `¥${num.toLocaleString()}（${(percent * 100).toFixed(1)}%）`;
                        },
                      }}
                    />
                  )}
                />
              )}
            </PieChart>
          </ResponsiveContainer>
        </ChartFigure>
      </div>
      {total > 0 && (
        <ChartLegend items={legendItems} size="sm" align="center" />
      )}
      {total === 0 && (
        <p className="text-center text-text-muted text-sm">{MSG.empty.sales}</p>
      )}
    </div>
  );
}
