'use client';

import { memo } from 'react';
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

function SegmentPieChart({ sales }: Props) {
  // 返金等で個別セグメントが負になり得る。負スライスは円が歪む/白紙化するため 0 にクランプし、
  // クランプ後合計 positiveTotal を空状態・割合計算の基準にする（B9）。
  const positiveTotal = SEGMENT_ORDER.reduce((sum, segment) => sum + Math.max(0, sales[segment]), 0);
  const isEmpty = positiveTotal <= 0;

  const data = isEmpty
    ? [{ name: 'データなし', value: 1, segment: 'new' as const }]
    : SEGMENT_ORDER.map((segment) => ({ name: LABELS[segment], value: Math.max(0, sales[segment]), segment }));

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
                paddingAngle={isEmpty ? 0 : 2}
                dataKey="value"
                isAnimationActive={false}
              >
                {data.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={isEmpty ? segmentEmptyColor : segmentColors[entry.segment]}
                    stroke="none"
                  />
                ))}
              </Pie>
              {!isEmpty && (
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
                          const percent = num / positiveTotal;
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
      {!isEmpty && (
        <ChartLegend items={legendItems} size="sm" align="center" />
      )}
      {isEmpty && (
        <p className="text-center text-text-muted text-sm">{MSG.empty.sales}</p>
      )}
    </div>
  );
}

export default memo(SegmentPieChart);
