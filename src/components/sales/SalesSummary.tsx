import { Card, StatCard } from '../ui';
import { formatYen } from './utils';

// =============================================================================
// SalesSummary — 当日売上サマリ（square-dashboard 見本の kintai 版・W4-P1）
// -----------------------------------------------------------------------------
// 見本（square-dashboard/src/components/SalesSummary.tsx）からのスリム移植。
//   - YoY 行は P1 では撤去（today に前年比なし＝設計書 §4.3.4）。
//   - ui: kintai 共通 ui（Card/StatCard）に差し替え。formatYen は components/sales/utils。
//   - 未決済（openTotal/openCount）は P2 で OpenOrder 導入後に表示するため P1 は受けず、
//     「合計売上」＝決済済み売上に一致する（当日 live 決済済みベース）。
//   - loading は StatCard の null（dash）+ skeleton 相当でなく Card 枠のプレースホルダ。
// =============================================================================

interface SalesSummaryProps {
  /** 決済済み売上合計 */
  total: number;
  /** 決済済み取引件数 */
  count: number;
  loading: boolean;
  /** 表示対象日 (YYYY-MM-DD)。指定時は KPI カード上に期間ラベルを表示 */
  date?: string;
}

export default function SalesSummary({ total, count, loading, date }: SalesSummaryProps) {
  return (
    <div className="space-y-2">
      {date && (
        <p className="text-xs text-stone-500 dark:text-stone-400" aria-label="表示対象日">
          対象日: {date}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {loading ? (
          <>
            <Card padding="md" aria-hidden="true">
              <div className="h-4 w-24 rounded bg-stone-200 dark:bg-stone-700 animate-pulse" />
              <div className="mt-3 h-8 w-32 rounded bg-stone-200 dark:bg-stone-700 animate-pulse" />
            </Card>
            <Card padding="md" aria-hidden="true">
              <div className="h-4 w-24 rounded bg-stone-200 dark:bg-stone-700 animate-pulse" />
              <div className="mt-3 h-8 w-32 rounded bg-stone-200 dark:bg-stone-700 animate-pulse" />
            </Card>
          </>
        ) : (
          <>
            <StatCard label="本日の売上（決済済み）" value={formatYen(total)} />
            <StatCard label="本日の取引件数" value={count} unit="件" />
          </>
        )}
      </div>
    </div>
  );
}
