import React from 'react';
import { Card, Badge, Heading, ErrorBanner, EmptyState, Spinner } from '../ui';
import type { MonthlyReport } from '../../lib/reports/types';
import { formatYen, formatCount } from './reportFormat';
import { LockedValue, formatRate } from './monthlyDisplay';

// =============================================================================
// MonthlyStoreReport — 店舗別月報の表示（Loop E §5.2 / §5.4）
// -----------------------------------------------------------------------------
//   - useMonthlyReport の結果（data/loading/error）を受け取り、表＋カードで表示。
//   - 売上内訳 / 客数4セグ＋客単価 / シーシャ本数 / 原価(変動) / 販管費(変動) /
//     人件費 / 消費税 / 違算計 / 目標達成率 / 暫定利益(額/率)。
//   - 経営数値（社員人件費・売上目標生値・暫定利益額/率）は LockedValue で
//     null→「—」＋（managerial のみ）ロック Badge（§5.4 fail-safe）。
//   - sga_variable は RPC 確定値をそのまま表示（再計算しない＝インセンティブ
//     二重計上防止・§5.2 / Loop B §4.5）。内訳は参考表示。
//   - 金額は円のカンマ区切り（万単位は使わない）。レートは %。
//   - グラフは作らない（表＋カードのみ）。
// =============================================================================

export interface MonthlyStoreReportProps {
  data: MonthlyReport | null;
  loading: boolean;
  error: string | null;
  isManagerial: boolean;
  onReload: () => void;
  /** マスタ未設定時に managerial へ出す設定導線（任意）。 */
  onEditSettings?: () => void;
}

/** 金額 1 行（ラベル + 値・右寄せ）。 */
const Row: React.FC<{ label: string; children: React.ReactNode; muted?: boolean }> = ({
  label,
  children,
  muted,
}) => (
  <div className="flex items-center justify-between py-1.5 text-sm">
    <span className={muted ? 'text-stone-400 dark:text-stone-500' : 'text-stone-600 dark:text-stone-300'}>
      {label}
    </span>
    <span className="font-medium text-stone-900 dark:text-stone-100 tabular-nums">{children}</span>
  </div>
);

/** 強調行（合計など・上罫線）。 */
const TotalRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between pt-2 mt-1 border-t border-stone-200 dark:border-stone-700 text-sm">
    <span className="font-semibold text-stone-800 dark:text-stone-100">{label}</span>
    <span className="font-semibold text-stone-900 dark:text-stone-50 tabular-nums">{children}</span>
  </div>
);

export const MonthlyStoreReport: React.FC<MonthlyStoreReportProps> = ({
  data,
  loading,
  error,
  isManagerial,
  onReload,
  onEditSettings,
}) => {
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
    return (
      <EmptyState
        title="月報データがありません"
        description="店舗と年月を選択してください。"
      />
    );
  }

  const { sales, customers, expenses, fees, labor, target, settings } = data;
  const laborWaiting = labor.source === 'unavailable';
  const settingsMissing = data.settings_exists === false;

  return (
    <div className="space-y-4">
      {/* ヘッダ */}
      <div className="flex flex-wrap items-center gap-2">
        <Heading level={3}>{data.store_name}</Heading>
        <span className="text-sm text-stone-500">
          {data.year}年{data.month}月
        </span>
        {settingsMissing && (
          <Badge tone="warning">月次マスタ未設定</Badge>
        )}
        {settingsMissing && isManagerial && onEditSettings && (
          <button
            type="button"
            onClick={onEditSettings}
            className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            マスタを設定
          </button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* 売上 */}
        <Card>
          <Card.Header>
            <Heading level={4}>売上</Heading>
          </Card.Header>
          <Card.Body>
            <Row label="現金">{formatYen(sales.cash)}</Row>
            <Row label="カード">{formatYen(sales.card)}</Row>
            <Row label="PayPay">{formatYen(sales.external)}</Row>
            <Row label="その他">{formatYen(sales.other)}</Row>
            <TotalRow label="合計">{formatYen(sales.total)}</TotalRow>
            <Row label="（未決済込み）" muted>
              {formatYen(sales.total_with_open)}
            </Row>
          </Card.Body>
        </Card>

        {/* 客数 */}
        <Card>
          <Card.Header>
            <Heading level={4}>客数</Heading>
          </Card.Header>
          <Card.Body>
            <Row label="新規">{formatCount(customers.new)}</Row>
            <Row label="リピート">{formatCount(customers.repeat)}</Row>
            <Row label="常連">{formatCount(customers.regular)}</Row>
            <Row label="スタッフ">{formatCount(customers.staff)}</Row>
            <TotalRow label="合計">{formatCount(customers.total)}</TotalRow>
            <Row label="客単価">{formatYen(customers.avg_spend)}</Row>
            <Row label="シーシャ本数">{formatCount(data.shisha_count)} 本</Row>
          </Card.Body>
        </Card>

        {/* 原価（変動） */}
        <Card>
          <Card.Header>
            <Heading level={4}>原価（変動費）</Heading>
          </Card.Header>
          <Card.Body>
            <Row label="酒代">{formatYen(expenses.drink)}</Row>
            <Row label="フード">{formatYen(expenses.food)}</Row>
            <Row label="フレーバー">{formatYen(expenses.flavor)}</Row>
            <TotalRow label="原価計">{formatYen(data.cogs_variable)}</TotalRow>
          </Card.Body>
        </Card>

        {/* 販管費（変動） */}
        <Card>
          <Card.Header>
            <Heading level={4}>販管費（変動費）</Heading>
          </Card.Header>
          <Card.Body>
            <Row label="消耗品">{formatYen(expenses.supplies)}</Row>
            <Row label="その他">{formatYen(expenses.other)}</Row>
            <Row label="インセンティブ">{formatYen(expenses.incentive)}</Row>
            <Row label="手数料（カード）">{formatYen(fees.card)}</Row>
            <Row label="手数料（PayPay）">{formatYen(fees.external)}</Row>
            <TotalRow label="変動販管費計">{formatYen(data.sga_variable)}</TotalRow>
          </Card.Body>
        </Card>

        {/* 人件費 */}
        <Card>
          <Card.Header>
            <div className="flex items-center gap-2">
              <Heading level={4}>人件費</Heading>
              {laborWaiting && <Badge tone="warning">未連携</Badge>}
            </div>
          </Card.Header>
          <Card.Body>
            <Row label="アルバイト">
              {laborWaiting ? (
                <span className="text-stone-400">集計待ち</span>
              ) : (
                formatYen(labor.parttime)
              )}
            </Row>
            <Row label="社員（固定）">
              <LockedValue
                value={settings ? settings.fixed_payroll_employee : null}
                isManagerial={isManagerial}
              />
            </Row>
          </Card.Body>
        </Card>

        {/* 税・違算・目標 */}
        <Card>
          <Card.Header>
            <Heading level={4}>税・違算・目標</Heading>
          </Card.Header>
          <Card.Body>
            <Row label="消費税">{formatYen(data.consumption_tax)}</Row>
            <Row label="違算計">{formatYen(data.discrepancy_total)}</Row>
            <Row label="目標達成率">{formatRate(target.achievement_rate)}</Row>
            <Row label="売上目標">
              <LockedValue value={target.sales_target} isManagerial={isManagerial} />
            </Row>
          </Card.Body>
        </Card>
      </div>

      {/* 暫定利益（経営数値・ロック対象） */}
      <Card>
        <Card.Header>
          <Heading level={4}>暫定利益</Heading>
        </Card.Header>
        <Card.Body>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-xs text-stone-500 mb-1">暫定利益</div>
              <div className="text-lg font-semibold tabular-nums">
                <LockedValue value={data.provisional_profit} isManagerial={isManagerial} />
              </div>
            </div>
            <div>
              <div className="text-xs text-stone-500 mb-1">暫定利益率</div>
              <div className="text-lg font-semibold tabular-nums">
                <LockedValue
                  value={data.provisional_profit_rate}
                  format={(n) => formatRate(n)}
                  isManagerial={isManagerial}
                />
              </div>
            </div>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
};

export default MonthlyStoreReport;
