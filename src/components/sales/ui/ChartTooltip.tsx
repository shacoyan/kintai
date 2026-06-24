'use client';

import type { CSSProperties, ReactElement } from 'react';

/**
 * ChartTooltip — Recharts `<Tooltip content={...}>` 用の統一プリミティブ。
 *
 * 設計: `.company/engineering/docs/2026-05-05-square-dashboard-l13-techdesign.md`
 *
 * 使い方:
 * ```tsx
 * <Tooltip content={(p) => <ChartTooltip {...p} formatters={{ sales: (v) => `¥${Number(v).toLocaleString()}` }} />} />
 * ```
 *
 * 注意:
 *   - `active === false` または `payload?.length === 0` は必ず `null` を return（Recharts の表示制御）。
 *   - 数値は `tabular-nums` で等幅表示。
 *   - dataKey ごとに `formatters` があればそれ、なければ `valueSuffix` 付きデフォルト整形。
 */

export interface ChartTooltipPayloadItem {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string | Array<number | string>;
  color?: string;
  payload?: Record<string, unknown>;
}

export interface ChartTooltipProps {
  /** Recharts から流れてくる active フラグ */
  active?: boolean;
  /** Recharts から流れてくる payload */
  payload?: ChartTooltipPayloadItem[];
  /** Recharts から流れてくる label（X 軸値） */
  label?: string | number;

  /** dataKey 別フォーマッタ。値整形（円・%・人など） */
  formatters?: Record<
    string,
    (value: number | string | Array<number | string>, name?: string | number, item?: ChartTooltipPayloadItem) => string
  >;
  /** 単一 suffix を全項目に付与（formatters 未指定時のフォールバック） */
  valueSuffix?: string;
  /** ラベル整形（曜日・日付など）。Recharts 互換のため第2引数 payload も受け取れる。 */
  labelFormatter?: (label: string | number, payload?: ChartTooltipPayloadItem[]) => string;
  /** 追加クラス */
  className?: string;
  /** name 列を非表示（Pie 等で凡例＝ name 自明な場合） */
  hideName?: boolean;
}

const formatDefault = (value: number | string | Array<number | string>, suffix?: string): string => {
  if (Array.isArray(value)) {
    return `${value.join(', ')}${suffix ?? ''}`;
  }
  if (typeof value === 'number') {
    return `${value.toLocaleString()}${suffix ?? ''}`;
  }
  return `${value}${suffix ?? ''}`;
};

export function ChartTooltip({
  active,
  payload,
  label,
  formatters,
  valueSuffix,
  labelFormatter,
  className,
  hideName = false,
}: ChartTooltipProps): ReactElement | null {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const rootClass = [
    'rounded-lg bg-stone-900 px-3 py-2 text-xs text-white shadow-lg',
    'ring-1 ring-white/10 dark:bg-stone-800 dark:ring-white/20',
    '[font-variant-numeric:tabular-nums]',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const labelText =
    label !== undefined && label !== null
      ? labelFormatter
        ? labelFormatter(label, payload)
        : String(label)
      : null;

  return (
    <div className={rootClass}>
      {labelText !== null && labelText !== '' && (
        <div className="text-[11px] font-medium text-stone-300 mb-1">{labelText}</div>
      )}
      <div className="flex flex-col gap-1">
        {payload.map((item, idx) => {
          const key = item.dataKey != null ? String(item.dataKey) : `item-${idx}`;
          const value = item.value ?? '';
          const fn = formatters?.[key];
          const formatted = fn
            ? fn(value, item.name, item)
            : formatDefault(value, valueSuffix);
          const dotStyle: CSSProperties = item.color
            ? { background: item.color }
            : { background: '#94a3b8' };
          return (
            <div key={`${key}-${idx}`} className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={dotStyle}
                aria-hidden="true"
              />
              {!hideName && item.name != null && (
                <span className="text-stone-200">{item.name}</span>
              )}
              <span className="ml-auto font-semibold tabular-nums">{formatted}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ChartTooltip;
