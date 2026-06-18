import SalesSummary from './SalesSummary';
import TransactionList from './TransactionList';
import OpenOrderList from './OpenOrderList';
import { RefreshCw } from 'lucide-react';
import { Button, ErrorBanner } from '../ui';
import type { OpenOrder, Transaction } from '../../lib/sales/types';

// =============================================================================
// DailyLiveSection — 当日明細タブ本体（W4-P1 / 設計書 §4.3.5）
// -----------------------------------------------------------------------------
// period==='today' のとき SalesPage が描く当日 live セクション。
// props は useSquareLiveSales（契約 §4.3.2）の戻り値をそのまま受ける。
//   - sales: { total_amount, transaction_count } | null（決済済み集計）
//   - transactions: Transaction[]（決済済み伝票）
//   - loading / error（error は全文表示・短縮禁止＝MEMORY ルール）
//   - lastUpdated: 最終更新時刻（live の鮮度表示）
//   - refresh: 手動再取得
// P2 で未決済（OpenOrderList）を SalesSummary と TransactionList の間に挿入。
//   - openOrders: OpenOrder[]（未会計伝票・useSquareOpenOrders 戻り値）
//   - openOrdersLoading / openOrdersError（error は OpenOrderList 内で自前表示し、
//     当日売上全体は潰さない＝見本同様）
// =============================================================================

/** useSquareLiveSales の sales（§4.3.2）。決済済み集計の一部のみ参照。 */
export interface DailyLiveSales {
  total_amount: number;
  transaction_count: number;
}

export interface DailyLiveSectionProps {
  sales: DailyLiveSales | null;
  transactions: Transaction[];
  loading: boolean;
  error: string | null;
  /** 表示対象営業日 (YYYY-MM-DD) */
  date: string;
  /** 最終更新時刻（live 鮮度表示用・任意） */
  lastUpdated?: Date | null;
  /** 手動再取得（任意） */
  refresh?: () => void;
  /** 未会計伝票（useSquareOpenOrders 戻り値・§4.3.1） */
  openOrders: OpenOrder[];
  /** 未会計伝票の取得中フラグ */
  openOrdersLoading: boolean;
  /** 未会計伝票の取得エラー（全文・OpenOrderList 内で自前表示） */
  openOrdersError: string | null;
}

function formatUpdatedAt(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds(),
  ).padStart(2, '0')}`;
}

export default function DailyLiveSection({
  sales,
  transactions,
  loading,
  error,
  date,
  lastUpdated,
  refresh,
  openOrders,
  openOrdersLoading,
  openOrdersError,
}: DailyLiveSectionProps) {
  // error は全文表示（短縮しない＝MEMORY ルール）。再取得手段があれば併設。
  if (error) {
    return <ErrorBanner message={error} onRetry={refresh} />;
  }

  const total = sales?.total_amount ?? 0;
  const count = sales?.transaction_count ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-stone-500 dark:text-stone-400">
          本日の売上（リアルタイム）
        </p>
        <div className="flex items-center gap-2">
          {!loading && lastUpdated && (
            <p
              className="text-[11px] text-stone-400 dark:text-stone-500 tabular-nums"
              aria-label="最終更新時刻"
            >
              最終更新 {formatUpdatedAt(lastUpdated)}
            </p>
          )}
          {refresh && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={loading}
              disabled={loading}
              onClick={refresh}
              iconLeft={<RefreshCw size={14} aria-hidden="true" />}
            >
              更新
            </Button>
          )}
        </div>
      </div>

      <SalesSummary total={total} count={count} loading={loading} date={date} />

      <OpenOrderList
        orders={openOrders}
        loading={openOrdersLoading}
        error={openOrdersError}
      />

      <TransactionList transactions={transactions} loading={loading} />
    </div>
  );
}
