// =============================================================================
// components/reports/DailySquareSummary.tsx — Square 売上/客数/人件費の読み取り表示（§4.3）
// -----------------------------------------------------------------------------
//   - get_daily_report の square / labor を StatCard / Card で表示（編集不可）。
//   - 人件費 labor.source==='unavailable' は「集計待ち」Badge（Loop C 未実装明示・R7）。
//   - report_exists で「未入力 / 入力済」Badge。
// =============================================================================

import { Card, StatCard, Badge } from '../ui';
import type { DailyReport } from '../../lib/reports/types';
import { formatYen, formatCount } from './reportFormat';

interface DailySquareSummaryProps {
  report: DailyReport;
}

export function DailySquareSummary({ report }: DailySquareSummaryProps): JSX.Element {
  const { square, labor, manual } = report;
  const laborUnavailable = labor.source === 'unavailable';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
          Square 自動集計（読み取り専用）
        </h3>
        {manual.report_exists ? (
          <Badge tone="success" withDot>
            入力済
          </Badge>
        ) : (
          <Badge tone="warning" withDot>
            未入力
          </Badge>
        )}
      </div>

      {/* 売上 KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="売上総額" value={formatYen(square.total_amount)} />
        <StatCard label="現金" value={formatYen(square.cash_amount)} />
        <StatCard label="カード" value={formatYen(square.card_amount)} />
        <StatCard label="PayPay" value={formatYen(square.external_amount)} />
      </div>

      {/* 客数内訳 + その他 + 人件費 */}
      <Card padding="md">
        <Card.Header>客数・その他</Card.Header>
        <Card.Body>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
            <SummaryRow label="新規" value={`${formatCount(square.new_customer_count)} 人`} />
            <SummaryRow label="リピート" value={`${formatCount(square.repeat_customer_count)} 人`} />
            <SummaryRow label="常連" value={`${formatCount(square.regular_customer_count)} 人`} />
            <SummaryRow label="スタッフ" value={`${formatCount(square.staff_customer_count)} 人`} />
            <SummaryRow
              label="客数合計"
              value={`${formatCount(square.customer_total)} 人`}
              emphasize
            />
            <SummaryRow label="その他売上" value={formatYen(square.other_amount)} />
            <SummaryRow label="取引件数" value={`${formatCount(square.transaction_count)} 件`} />
            <SummaryRow label="シーシャ本数" value={`${formatCount(square.shisha_count)} 本`} />
            <div>
              <dt className="text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
                人件費（バイト）
                {laborUnavailable ? <Badge tone="neutral">集計待ち</Badge> : null}
              </dt>
              <dd className="mt-0.5 font-medium text-stone-900 dark:text-stone-100 tabular-nums">
                {laborUnavailable ? '—' : formatYen(labor.parttime_labor)}
              </dd>
            </div>
          </dl>
        </Card.Body>
      </Card>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}): JSX.Element {
  return (
    <div>
      <dt className="text-stone-500 dark:text-stone-400">{label}</dt>
      <dd
        className={
          'mt-0.5 tabular-nums ' +
          (emphasize
            ? 'font-semibold text-stone-900 dark:text-stone-100'
            : 'font-medium text-stone-900 dark:text-stone-100')
        }
      >
        {value}
      </dd>
    </div>
  );
}
