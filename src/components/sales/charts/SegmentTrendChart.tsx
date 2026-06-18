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
} from 'recharts';
import type { DailySegmentPoint, PeriodPreset } from '../../../lib/sales/types';
import { ChartTooltip, ChartFigure, type ChartTooltipPayloadItem } from '../ui';
import { chartTheme } from '../../../lib/sales/chartTheme';
import SeriesCheckboxGroup, { type SeriesCheckboxItem } from './SeriesCheckboxGroup';
import { granularityFor, formatDateLabel } from '../../../lib/sales/trendAggregation';
import { MSG } from '../../../lib/sales/messages';
import { shiftDateOneYearForward, type DailyTotalPoint } from '../../../lib/sales/yoy';

const LAST_YEAR_TOTAL_KEY = '__last_year_total__';

interface Props {
  data: DailySegmentPoint[];
  /**
   * 期間プリセット。X 軸ラベルの粒度切替に使用。
   * 集約自体は hook 側で実施済み（このコンポーネントでは再集約しない）。
   * 省略時は 'month'（既存挙動 = daily ラベル）。
   */
  period?: PeriodPreset;
  /**
   * 前年同期の合計系列 (date は前年日付 'YYYY-MM-DD', total は人数 or 売上)。
   * 合計線のみ重ね描き (セグメント別 YoY は初版抑制、設計書 §6.6)。
   */
  lastYearTotalsSeries?: DailyTotalPoint[];
  /** 前年系列を表示するか。false / period='week' / 'today' のとき抑制。 */
  showYoY?: boolean;
}

type CountKey = 'new' | 'repeat' | 'regular' | 'staff' | 'unlisted';
type SalesKey = 'newSales' | 'repeatSales' | 'regularSales' | 'staffSales' | 'unlistedSales';

interface SeriesDef {
  key: CountKey;
  salesKey: SalesKey;
  color: string;
  label: string;
}

const SERIES: SeriesDef[] = [
  { key: 'new', salesKey: 'newSales', color: '#3b82f6', label: '新規' },
  { key: 'repeat', salesKey: 'repeatSales', color: '#eab308', label: 'リピート' },
  { key: 'regular', salesKey: 'regularSales', color: '#ef4444', label: '常連' },
  { key: 'staff', salesKey: 'staffSales', color: '#a855f7', label: 'スタッフ' },
  { key: 'unlisted', salesKey: 'unlistedSales', color: '#6b7280', label: '記載なし' },
];

const COUNT_KEYS: ReadonlySet<string> = new Set<string>(SERIES.map(s => s.key));

const INITIAL_VISIBLE_KEYS: Record<CountKey, boolean> = {
  new: true,
  repeat: true,
  regular: true,
  staff: true,
  unlisted: true,
};

const ALL_ON_VISIBLE_KEYS: Record<CountKey, boolean> = {
  new: true,
  repeat: true,
  regular: true,
  staff: true,
  unlisted: true,
};

const ALL_OFF_VISIBLE_KEYS: Record<CountKey, boolean> = {
  new: false,
  repeat: false,
  regular: false,
  staff: false,
  unlisted: false,
};

function SegmentTrendChart({
  data,
  period = 'month',
  lastYearTotalsSeries,
  showYoY = false,
}: Props) {
  const [visibleKeys, setVisibleKeys] = useState<Record<CountKey, boolean>>(INITIAL_VISIBLE_KEYS);

  const granularity = granularityFor(period);

  const isEmpty = !data || data.length === 0;
  // 全系列 OFF で軸のみの白紙になる（「壊れてる？」感）のを防ぐ（B14）。
  // データはあるが allHidden のときのみオーバーレイ表示（isEmpty 優先・併存しない）。
  const allHidden = SERIES.every(s => !visibleKeys[s.key]);

  // 前年系列を current 日付軸にマッピング (lastYear 'YYYY-MM-DD' → current 'YYYY+1-MM-DD')。
  // period='week'/'today' は UI 過密回避のため抑制 (設計書 §1.3 / §6.6)。
  const yoyEnabled = showYoY && period !== 'week' && period !== 'today';
  const lastYearByCurrentDate = useMemo(() => {
    const m = new Map<string, number>();
    if (!yoyEnabled || !lastYearTotalsSeries || lastYearTotalsSeries.length === 0) {
      return m;
    }
    for (const p of lastYearTotalsSeries) {
      // currentDate (当年実日付) があれば優先。なければ shift にフォールバック (後方互換)。
      // 設計書 §6.8 — うるう年 (2/29) などで shift が日付をずらしてしまうケースを回避する。
      m.set(p.currentDate ?? shiftDateOneYearForward(p.date), p.total);
    }
    return m;
  }, [yoyEnabled, lastYearTotalsSeries]);

  const hasLastYearData = yoyEnabled && lastYearByCurrentDate.size > 0;

  type ChartRow = DailySegmentPoint & { [LAST_YEAR_TOTAL_KEY]?: number | null };
  const chartData: ChartRow[] = isEmpty
    ? [{
        date: '',
        new: 0, repeat: 0, regular: 0, staff: 0, unlisted: 0,
        newSales: 0, repeatSales: 0, regularSales: 0, staffSales: 0, unlistedSales: 0,
      }]
    : data.map(p => {
        if (!hasLastYearData) return p;
        const ly = lastYearByCurrentDate.get(p.date);
        return { ...p, [LAST_YEAR_TOTAL_KEY]: ly !== undefined ? ly : null };
      });

  const checkboxItems: SeriesCheckboxItem[] = SERIES.map(s => ({
    key: s.key,
    label: s.label,
    color: s.color,
  }));

  const handleVisibleChange = (key: string, next: boolean) => {
    if (COUNT_KEYS.has(key)) {
      const k = key as CountKey;
      setVisibleKeys(prev => ({ ...prev, [k]: next }));
    }
  };

  const handleAllOn = () => setVisibleKeys(ALL_ON_VISIBLE_KEYS);
  const handleAllOff = () => setVisibleKeys(ALL_OFF_VISIBLE_KEYS);

  // dataKey 別 formatter（人数表示）。設計書 §97 により合計表示は L14 以降へ送り、L13 では個別系列のみ。
  const formatters: Record<string, (v: number | string | Array<number | string>) => string> = {};
  for (const s of SERIES) {
    formatters[s.key] = (v) => {
      const n = typeof v === 'number' ? v : Number(v) || 0;
      return `${n.toLocaleString()}人`;
    };
  }
  formatters[LAST_YEAR_TOTAL_KEY] = (v) => {
    const n = typeof v === 'number' ? v : Number(v) || 0;
    return `${n.toLocaleString()}人 (前年合計)`;
  };

  return (
    <div className="w-full min-w-0">
      <SeriesCheckboxGroup
        items={checkboxItems}
        visible={visibleKeys as Record<string, boolean>}
        onChange={handleVisibleChange}
        onAllOn={handleAllOn}
        onAllOff={handleAllOff}
        className="mb-2"
      />
      <div className="relative w-full min-w-0" style={{ height: chartTheme.heightPreset.detail }}>
        {!isEmpty && allHidden && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <p className="text-text-muted text-sm">{MSG.empty.series}</p>
          </div>
        )}
        <ChartFigure label="折れ線グラフ：日次の客数または売上をセグメント別（新規・リピート・常連・スタッフ・記載なし）に表示">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={chartTheme.defaultMargin}>
              <CartesianGrid {...chartTheme.grid} />
              <XAxis
                dataKey="date"
                tickFormatter={(value) => {
                  if (!value) return '--';
                  return formatDateLabel(String(value), granularity);
                }}
                tick={chartTheme.axis.tickStyle}
                axisLine={chartTheme.axis.axisLine}
                tickLine={chartTheme.axis.tickLine}
              />
              <YAxis
                tick={chartTheme.axis.tickStyle}
                axisLine={chartTheme.axis.axisLine}
                tickLine={chartTheme.axis.tickLine}
                allowDecimals={false}
              />
              <Tooltip
                content={(p) => {
                  // hide 系列が Recharts の payload に残るバージョン互換のため visibleKeys でフィルタ。
                  // 前年系列 (LAST_YEAR_TOTAL_KEY) は visibleKeys 管理外なので常時通す。
                  const filtered = (p.payload as ChartTooltipPayloadItem[] | undefined)?.filter(
                    (it) => {
                      const k = it.dataKey != null ? String(it.dataKey) : '';
                      if (k === LAST_YEAR_TOTAL_KEY) return hasLastYearData;
                      if (!COUNT_KEYS.has(k)) return false;
                      return visibleKeys[k as CountKey];
                    },
                  );
                  return (
                    <ChartTooltip
                      active={p.active}
                      payload={filtered as never}
                      label={p.label as string | number | undefined}
                      formatters={formatters}
                      labelFormatter={(l) => formatDateLabel(l, granularity)}
                    />
                  );
                }}
              />
              {SERIES.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={{ r: 3, fill: s.color }}
                  activeDot={{ r: 5 }}
                  connectNulls
                  isAnimationActive={false}
                  hide={!visibleKeys[s.key]}
                />
              ))}
              {hasLastYearData && (
                <Line
                  type="monotone"
                  dataKey={LAST_YEAR_TOTAL_KEY}
                  name="合計 (前年)"
                  stroke="#6b7280"
                  strokeWidth={2}
                  strokeOpacity={0.3}
                  strokeDasharray="4 4"
                  dot={false}
                  activeDot={{ r: 4, strokeOpacity: 0.5 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </ChartFigure>
        {isEmpty && (
          <p className="text-center text-text-muted text-sm -mt-4">{MSG.empty.trend}</p>
        )}
      </div>
    </div>
  );
}

export default memo(SegmentTrendChart);
