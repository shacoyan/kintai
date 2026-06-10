import React from 'react';
import type { SegmentBreakdown } from '../../lib/sales/types';
import { segmentColors } from '../../lib/sales/segmentColors';
import { formatYen } from './utils';

// =============================================================================
// SegmentBreakdownList — 売上構成（セグメント別）円グラフ横の内訳リスト（B24）
// -----------------------------------------------------------------------------
// 各セグメント（new/repeat/regular/staff/unlisted）について
//   色ドット + ラベル + ¥金額(formatYen) + 構成%
// を行表示する。% の分母は SegmentPieChart と同じ positiveTotal（負スライスを
// 0 にクランプした合計＝Wave2 B9 と整合）。positiveTotal<=0 のとき % は非表示
// （¥NaN / (Infinity%) を出さない fail-safe）。
// =============================================================================

const SEGMENT_ORDER: (keyof SegmentBreakdown)[] = ['new', 'repeat', 'regular', 'staff', 'unlisted'];

const LABELS: Record<keyof SegmentBreakdown, string> = {
  new: '新規',
  repeat: 'リピート',
  regular: '常連',
  staff: 'スタッフ',
  unlisted: '記載なし',
};

interface Props {
  sales: SegmentBreakdown;
}

/**
 * 各セグメントの ¥金額と構成%（positiveTotal 分母）を算出する純関数（テスト用に export）。
 * positiveTotal = 負スライスを 0 クランプした合計（SegmentPieChart / Wave2 B9 と整合）。
 * positiveTotal<=0 のとき share=null（% 非表示で ¥NaN/(Infinity%) を出さない）。
 */
export function computeSegmentBreakdown(
  sales: SegmentBreakdown,
): { segment: keyof SegmentBreakdown; amount: number; share: number | null }[] {
  const positiveTotal = SEGMENT_ORDER.reduce((sum, segment) => sum + Math.max(0, sales[segment]), 0);
  const hasShare = positiveTotal > 0;
  return SEGMENT_ORDER.map((segment) => {
    const amount = sales[segment];
    return {
      segment,
      amount,
      share: hasShare ? (Math.max(0, amount) / positiveTotal) * 100 : null,
    };
  });
}

const SegmentBreakdownList: React.FC<Props> = ({ sales }) => {
  const breakdown = computeSegmentBreakdown(sales);

  return (
    <ul className="flex flex-col justify-center gap-2">
      {breakdown.map(({ segment, amount, share }) => {
        return (
          <li
            key={segment}
            className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm"
          >
            <span className="flex items-center gap-2 text-stone-700 dark:text-stone-200">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: segmentColors[segment] }}
                aria-hidden="true"
              />
              {LABELS[segment]}
            </span>
            <span className="flex items-baseline gap-2 tabular-nums">
              <span className="font-medium text-stone-900 dark:text-stone-100">
                {formatYen(amount)}
              </span>
              {share !== null && (
                <span className="text-xs text-stone-500 dark:text-stone-400">
                  ({share.toFixed(1)}%)
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
};

export default SegmentBreakdownList;
