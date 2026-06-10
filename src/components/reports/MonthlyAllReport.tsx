import React, { useMemo } from 'react';
import { Card, Badge, Heading, ErrorBanner, EmptyState, Spinner } from '../ui';
import type { MonthlyReportAll, MonthlyReport } from '../../lib/reports/types';
import { formatYen, formatCount } from './reportFormat';
import { LockedValue, formatRate, formatYenOrDash } from './monthlyDisplay';

// =============================================================================
// MonthlyAllReport — 総合月報（全店比較＋総合 P&L）（Loop E §5.5）
// -----------------------------------------------------------------------------
//   - managerial のみ呼ばれる前提（呼び出し側がサブタブ自体を staff に出さない）。
//     さらに RPC が利益額 null を返すため LockedValue で二層防御。
//   - stores[] を sales.total 降順で店舗比較テーブル（売上/客数/客単価/暫定利益）。
//   - totals を総合 P&L カード（売上→原価→粗利→人件費[変動+固定]→
//     販管費[変動+固定]→営業利益・率）。
//   - labor_source==='unavailable' なら「人件費は集計待ちを含む」注記。
//   - グラフは作らない（テーブル＋カードのみ）。金額は円カンマ区切り。
// =============================================================================

export interface MonthlyAllReportProps {
  data: MonthlyReportAll | null;
  loading: boolean;
  error: string | null;
  isManagerial: boolean;
  onReload: () => void;
}

/** P&L 1 行（ラベル + 値）。emphasize で小計を強調。 */
const PnlRow: React.FC<{
  label: string;
  children: React.ReactNode;
  emphasize?: boolean;
  indent?: boolean;
}> = ({ label, children, emphasize, indent }) => (
  <div
    className={`flex items-center justify-between py-1.5 text-sm ${
      emphasize ? 'border-t border-stone-200 dark:border-stone-700 pt-2 mt-1' : ''
    }`}
  >
    <span
      className={
        emphasize
          ? 'font-semibold text-stone-800 dark:text-stone-100'
          : `text-stone-600 dark:text-stone-300 ${indent ? 'pl-3' : ''}`
      }
    >
      {label}
    </span>
    <span
      className={`tabular-nums ${
        emphasize
          ? 'font-semibold text-stone-900 dark:text-stone-50'
          : 'font-medium text-stone-900 dark:text-stone-100'
      }`}
    >
      {children}
    </span>
  </div>
);

export const MonthlyAllReport: React.FC<MonthlyAllReportProps> = ({
  data,
  loading,
  error,
  isManagerial,
  onReload,
}) => {
  const sortedStores = useMemo<MonthlyReport[]>(() => {
    if (!data) return [];
    return [...data.stores].sort((a, b) => b.sales.total - a.sales.total);
  }, [data]);

  if (error) {
    return <ErrorBanner message={error} onRetry={onReload} />;
  }
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-stone-400">
        <Spinner size="md" />
      </div>
    );
  }
  if (!data) {
    return <EmptyState title="総合データがありません" description="年月を選択してください。" />;
  }

  const { totals } = data;
  const laborWaiting = data.labor_source === 'unavailable';
  const laborTotalFixed = totals.labor_employee_fixed;
  const laborTotal =
    laborTotalFixed == null ? null : totals.labor_parttime + laborTotalFixed;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Heading level={3}>
          総合（{data.year}年{data.month}月）
        </Heading>
        {laborWaiting && <Badge tone="warning">人件費は集計待ちを含む</Badge>}
      </div>

      {/* 店舗比較テーブル */}
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 dark:border-stone-700 text-stone-500">
                <th className="text-left font-medium px-4 py-3">店舗</th>
                <th className="text-right font-medium px-4 py-3">売上</th>
                <th className="text-right font-medium px-4 py-3">客数</th>
                <th className="text-right font-medium px-4 py-3">客単価</th>
                <th className="text-right font-medium px-4 py-3">暫定利益</th>
                <th className="text-right font-medium px-4 py-3">達成率</th>
              </tr>
            </thead>
            <tbody>
              {sortedStores.map((s) => (
                <tr
                  key={s.store_id}
                  className="border-b border-stone-100 dark:border-stone-800 last:border-0"
                >
                  <td className="px-4 py-3 text-stone-800 dark:text-stone-100">{s.store_name}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatYen(s.sales.total)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCount(s.customers.total)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatYen(s.customers.avg_spend)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <LockedValue value={s.provisional_profit} isManagerial={isManagerial} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatRate(s.target.achievement_rate)}
                  </td>
                </tr>
              ))}
              {sortedStores.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
                    店舗データがありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 総合 P&L カード */}
      <Card>
        <Card.Header>
          <Heading level={4}>総合 P&amp;L</Heading>
        </Card.Header>
        <Card.Body>
          <PnlRow label="売上合計">{formatYen(totals.sales_total)}</PnlRow>
          <PnlRow label="原価（変動）" indent>
            {formatYen(totals.cogs_variable)}
          </PnlRow>
          <PnlRow label="粗利" emphasize>
            <LockedValue value={totals.gross_profit} isManagerial={isManagerial} />
          </PnlRow>

          <PnlRow label="人件費（バイト）" indent>
            {laborWaiting ? (
              <span className="text-stone-400">集計待ち</span>
            ) : (
              formatYen(totals.labor_parttime)
            )}
          </PnlRow>
          <PnlRow label="人件費（社員・固定）" indent>
            <LockedValue value={totals.labor_employee_fixed} isManagerial={isManagerial} />
          </PnlRow>
          <PnlRow label="人件費計" emphasize>
            <LockedValue value={laborTotal} isManagerial={isManagerial} />
          </PnlRow>

          <PnlRow label="販管費（変動）" indent>
            {formatYen(totals.sga_variable)}
          </PnlRow>
          <PnlRow label="販管費（固定）" indent>
            <LockedValue value={totals.sga_fixed} isManagerial={isManagerial} />
          </PnlRow>

          <PnlRow label="営業利益" emphasize>
            <LockedValue value={totals.operating_profit} isManagerial={isManagerial} />
          </PnlRow>
          <PnlRow label="営業利益率">
            <LockedValue
              value={totals.operating_profit_rate}
              format={(n) => formatRate(n)}
              isManagerial={isManagerial}
            />
          </PnlRow>

          <div className="mt-3 pt-3 border-t border-stone-200 dark:border-stone-700 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-stone-500 mb-0.5">総客数</div>
              <div className="font-medium tabular-nums">{formatCount(totals.customers_total)}</div>
            </div>
            <div>
              <div className="text-xs text-stone-500 mb-0.5">平均客単価</div>
              <div className="font-medium tabular-nums">{formatYenOrDash(totals.avg_spend)}</div>
            </div>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
};

export default MonthlyAllReport;
