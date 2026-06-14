'use client';

import { useMemo } from 'react';
import type { Transaction } from '../../lib/sales/types';
import { buildOccupancyMatrix, getActiveSlots } from '../../lib/sales/occupancyAggregation';
import OccupancyHeatmap from './charts/OccupancyHeatmap';
import OccupancyLineChart from './charts/OccupancyLineChart';
import { EmptyState } from './ui';
import { MSG } from '../../lib/sales/messages';

interface Props {
  transactions: Transaction[];
  startHour?: number;
  endHour?: number;
}

/**
 * 時間帯別混雑分析セクション（中身のみ）。
 * Card + 見出しは SalesPage 側が持つ（既存の曜日別分析カードと同形）。
 * 呼び出し側で flat 化済みの transactions を受け取り `buildOccupancyMatrix` で 7×48 集計。
 * - ヒートマップ: 平均同時滞在人数（曜日 × 時間帯、tooltip で組数も併記）
 * - 折れ線: 平均/合計 トグル + 曜日フィルタ
 */
export default function OccupancyAnalysisSection({ transactions, startHour, endHour }: Props) {
  // OPEN（未決済伝票）は created_at が滞在開始を表さず「開始時刻不明」として
  // skippedCount を水増しするため、混雑分析の入力からは決済済のみに絞る。
  const paidTransactions = useMemo(
    () =>
      transactions.filter(
        (t) => t.status !== 'OPEN' && t.source !== 'OPEN_TICKET',
      ),
    [transactions],
  );
  const matrix = useMemo(
    () => buildOccupancyMatrix(paidTransactions),
    [paidTransactions],
  );
  const activeSlots = useMemo(() => getActiveSlots(startHour, endHour), [startHour, endHour]);

  const hasAnyData = matrix.totalSpans > 0;

  return (
    <div className="space-y-4">
      {!hasAnyData ? (
        <EmptyState title={MSG.empty.generic} minHeight={160} />
      ) : (
        <>
          <div className="bg-stone-50 dark:bg-stone-800/40 rounded-md border border-stone-200 dark:border-stone-700 p-3">
            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-2">
              曜日 × 時間帯ヒートマップ（平均）
            </h3>
            <OccupancyHeatmap matrix={matrix} activeSlots={activeSlots} />
          </div>

          <div className="bg-stone-50 dark:bg-stone-800/40 rounded-md border border-stone-200 dark:border-stone-700 p-1.5 md:p-3">
            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-2">
              時間帯別推移（折れ線）
            </h3>
            <OccupancyLineChart matrix={matrix} activeSlots={activeSlots} />
          </div>
        </>
      )}

      {matrix.skippedCount > 0 && (
        <div className="text-xs text-stone-500 dark:text-stone-400 tabular-nums">
          ※ 開始時刻不明 {matrix.skippedCount.toLocaleString()} 件をスキップ
        </div>
      )}
    </div>
  );
}
