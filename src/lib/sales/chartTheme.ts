/**
 * chartTheme — Recharts 軸 / グリッド / 余白 / 高さの一元定義。
 *
 * 設計: `.company/engineering/docs/2026-05-05-square-dashboard-l13-techdesign.md`
 *
 * 方針:
 *   - 色（系列色）はここでは持たない。系列色は locationColors / customerSegment 由来のまま。
 *   - `as const` で readonly 化。各 chart は破壊的代入禁止。
 *   - 高さ 3 段階（compact / standard / detail）に正規化。
 *   - 余白は用途別バリアントを提供（Pie / Vertical layout / Legend 付き）。
 */

export const chartTheme = {
  axis: {
    /** XAxis / YAxis の tick fontSize（数値での参照用） */
    fontSize: 11,
    /** XAxis / YAxis の軸線 stroke 色 */
    stroke: '#94a3b8', // slate-400
    /** XAxis / YAxis の tick={} に直接 spread する style */
    tickStyle: { fontSize: 11, fill: '#6b7280' } as const, // gray-500
    /** XAxis / YAxis の tickLine 既定値 */
    tickLine: false,
    /** XAxis / YAxis の axisLine 既定値 */
    axisLine: { stroke: '#cbd5e1' } as const, // slate-300
  },

  /** CartesianGrid に spread して使う既定値 */
  grid: {
    stroke: '#e5e7eb', // gray-200
    strokeDasharray: '3 3',
    vertical: false,
  },

  /** トップレベルの grid stroke（個別指定したい場合の参照用） */
  gridStroke: '#e5e7eb',

  /** 余白プリセット */
  defaultMargin:        { top: 8,  right: 16, left: 8,  bottom: 8 },
  marginWithLegend:     { top: 8,  right: 16, left: 8,  bottom: 24 },
  marginVerticalLayout: { top: 8,  right: 24, left: 8,  bottom: 8 },
  marginPie:            { top: 8,  right: 8,  left: 8,  bottom: 8 },

  /** 高さプリセット（px） */
  heightPreset: {
    compact: 240,
    standard: 320,
    detail: 400,
  },
} as const;

export type ChartHeightPreset = keyof typeof chartTheme.heightPreset;
