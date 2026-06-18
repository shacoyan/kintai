'use client';

import { memo, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import {
  WEEKDAY_COUNT,
  WEEKDAY_LABELS,
  getLineChartData,
  type OccupancyMatrix,
} from '../../../lib/sales/occupancyAggregation';
import { ChartLegend, ChartTooltip, ChartFigure, EmptyState, type ChartLegendItem, type ChartTooltipPayloadItem } from '../ui';
import { chartTheme } from '../../../lib/sales/chartTheme';

interface Props {
  matrix: OccupancyMatrix;
  activeSlots: number[];
}

type Mode = 'average' | 'sum';

const THRESHOLD_PERSONS = 8;
const COLOR_NORMAL = '#3b82f6';   // blue-500
const COLOR_ALERT  = '#ef4444';   // red-500

// 既存 kintai チャート（WeekdayLocationAnalysisSection）の mode トグルに合わせる
const toggleBase =
  'px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1';
const toggleActive = 'bg-primary text-white';
const toggleInactive =
  'bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700';

function formatVal(v: number | string | Array<number | string> | undefined, mode: Mode): string {
  const raw = Array.isArray(v) ? v[0] : v;
  const n = typeof raw === 'number' ? raw : Number(raw ?? 0);
  return mode === 'average' ? n.toFixed(2) : Math.round(n).toLocaleString();
}

function OccupancyLineChart({ matrix, activeSlots }: Props) {
  const [mode, setMode] = useState<Mode>('average');
  const [weekdayFilter, setWeekdayFilter] = useState<boolean[]>(
    () => Array.from({ length: WEEKDAY_COUNT }, () => true),
  );

  const data = useMemo(
    () => getLineChartData(matrix, weekdayFilter, mode, activeSlots),
    [matrix, weekdayFilter, mode, activeSlots],
  );

  const splitData = useMemo(() => {
    if (mode !== 'average') {
      return data.map((d) => ({ ...d, personsNormal: d.persons, personsAlert: null as number | null }));
    }
    const flagged = data.map((d) => d.persons >= THRESHOLD_PERSONS);
    const expanded = flagged.map((f, i) =>
      f || flagged[i - 1] || flagged[i + 1]
    );
    return data.map((d, i) => ({
      ...d,
      personsNormal: flagged[i] ? null : d.persons,
      personsAlert:  expanded[i] ? d.persons : null,
    }));
  }, [data, mode]);

  const hasAnyChecked = weekdayFilter.some((b) => b);
  const hasNonZero = data.some((d) => d.groups > 0 || d.persons > 0);

  const toggleWeekday = (w: number) => {
    setWeekdayFilter((prev) => prev.map((b, i) => (i === w ? !b : b)));
  };

  const unit = '人';
  const metricLabel = '同時滞在人数';
  const modeLabel = mode === 'average' ? '平均' : '合計';

  const dataMaxPersons = useMemo(() => data.reduce((m,d) => (d.persons > m ? d.persons : m), 0), [data]);
  const yDomain: [number, number] = mode === 'average' ? [0, Math.max(10, dataMaxPersons)] : [0, dataMaxPersons];

  const legendItems: ChartLegendItem[] = useMemo(() => {
    const items: ChartLegendItem[] = [
      { id: 'normal', label: `${modeLabel}${metricLabel}（${unit}）`, color: COLOR_NORMAL }
    ];
    if (mode === 'average') {
      items.push({ id: 'alert', label: `${THRESHOLD_PERSONS}人以上`, color: COLOR_ALERT });
    }
    return items;
  }, [mode, modeLabel, metricLabel, unit]);

  return (
    <div className="w-full min-w-0">
      {/* コントロール行 */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        {/* mode toggle */}
        <div role="group" aria-label="集計モード切替" className="inline-flex rounded-md overflow-hidden border border-stone-200 dark:border-stone-700">
          <button
            type="button"
            onClick={() => setMode('average')}
            aria-pressed={mode === 'average'}
            className={`${toggleBase} ${mode === 'average' ? toggleActive : toggleInactive}`}
          >
            平均
          </button>
          <button
            type="button"
            onClick={() => setMode('sum')}
            aria-pressed={mode === 'sum'}
            className={`${toggleBase} ${mode === 'sum' ? toggleActive : toggleInactive}`}
          >
            合計
          </button>
        </div>

        {/* weekday checkboxes */}
        <fieldset className="flex flex-wrap items-center gap-2 border-0 p-0 m-0">
          <legend className="sr-only">曜日選択</legend>
          {WEEKDAY_LABELS.map((lbl, w) => (
            <label key={`wf-${w}`} className="inline-flex items-center gap-1 text-sm text-stone-700 dark:text-stone-200 cursor-pointer">
              <input
                type="checkbox"
                checked={weekdayFilter[w]}
                onChange={() => toggleWeekday(w)}
                className="accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
              />
              <span>{lbl}</span>
            </label>
          ))}
        </fieldset>
      </div>

      {/* chart */}
      {!hasAnyChecked || !hasNonZero ? (
        <EmptyState
          title={hasAnyChecked ? 'データがありません' : '曜日を 1 つ以上選択してください'}
          minHeight={chartTheme.heightPreset.compact}
        />
      ) : (
        <ChartFigure label="折れ線グラフ：曜日 × 時間帯 平均/合計 同時滞在人数推移" className="w-full min-w-0">
          <ResponsiveContainer width="100%" height={chartTheme.heightPreset.compact}>
            <LineChart data={splitData} margin={chartTheme.defaultMargin}>
              <CartesianGrid {...chartTheme.grid} />
              <XAxis
                dataKey="label"
                tick={chartTheme.axis.tickStyle}
                tickLine={chartTheme.axis.tickLine}
                axisLine={chartTheme.axis.axisLine}
                interval={5}
              />
              <YAxis
                tick={chartTheme.axis.tickStyle}
                tickLine={chartTheme.axis.tickLine}
                axisLine={chartTheme.axis.axisLine}
                allowDecimals={mode === 'average'}
                domain={yDomain}
              />
              <Tooltip
                content={(p) => {
                  // personsNormal / personsAlert のうち value 非 null を 1 つだけ「人数」として表示し、
                  // 8 人閾値超えなら赤系色を保持（payload[].color が COLOR_ALERT/COLOR_NORMAL のため自然に反映）。
                  const rawPayload = (p.payload ?? []) as ChartTooltipPayloadItem[];
                  const active = rawPayload.find((it) => {
                    const v = it.value;
                    if (v === null || v === undefined) return false;
                    if (Array.isArray(v)) return v.length > 0;
                    return true;
                  });
                  const merged: ChartTooltipPayloadItem[] = [];
                  if (active) {
                    merged.push({
                      ...active,
                      name: `${modeLabel}${metricLabel}`,
                      dataKey: 'persons',
                    });
                  }
                  // 元データの groups も 1 行追加（同モードフォーマット）
                  const row = (rawPayload[0]?.payload ?? {}) as { groups?: number };
                  if (typeof row.groups === 'number') {
                    merged.push({
                      dataKey: 'groups',
                      name: `${modeLabel}組数`,
                      value: row.groups,
                      color: '#94a3b8',
                    });
                  }
                  return (
                    <ChartTooltip
                      active={p.active}
                      payload={merged}
                      label={p.label as string | number | undefined}
                      formatters={{
                        persons: (v) => `${formatVal(v, mode)} ${unit}`,
                        groups: (v) => `${formatVal(v, mode)} 組`,
                      }}
                    />
                  );
                }}
              />
              {mode === 'average' && (
                <ReferenceLine
                  y={THRESHOLD_PERSONS}
                  stroke={COLOR_ALERT}
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  label={{
                    value: `${THRESHOLD_PERSONS}人`,
                    position: 'right',
                    fill: COLOR_ALERT,
                    fontSize: 11,
                  }}
                  ifOverflow="extendDomain"
                />
              )}
              <Line
                type="monotone"
                dataKey="personsNormal"
                stroke={COLOR_NORMAL}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                name={`${modeLabel}${metricLabel}`}
                connectNulls={false}
              />
              {mode === 'average' && (
                <Line
                  type="monotone"
                  dataKey="personsAlert"
                  stroke={COLOR_ALERT}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  name={`${THRESHOLD_PERSONS}人以上`}
                  connectNulls={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
          <ChartLegend items={legendItems} size="sm" align="center" className="mt-2" />
        </ChartFigure>
      )}
    </div>
  );
}

export default memo(OccupancyLineChart);
