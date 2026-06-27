import { Card, StatCard } from '../ui';
import { formatYen } from './utils';

// =============================================================================
// SalesSummary — 当日売上サマリ（決済済み + 未決済 の内訳・3カード）
// -----------------------------------------------------------------------------
// オーナー要件: 本日の売上(合計)に未決済(OPEN)も含め、決済済み/未決済の内訳
// （件数・金額）を 3 カード横並びで表示する。
//   ┌ 本日売上(合計) ┐ ┌ 決済済み ┐ ┌ 未決済 ┐
//   │ ¥決済済+未決済   │ │ ¥決済済  │ │ ¥未決済 │
//   │ 合計N件          │ │ 決済済件 │ │ 未決済件│
//   └────────────────┘ └────────┘ └───────┘
//
// 集計は src/lib/sales/dailyTotals.ts の computeDailyTotals（唯一の真実源）で算出し、
// 本コンポーネントは表示のみを担う（金額ロジックは持たない）。
//
// 金額の誠実性（ゼロ誤表示防止）:
//   - loading（決済済み取得中）: 決済済み・合計カードは skeleton。
//   - openLoading（未決済取得中）: 未決済・合計カードは skeleton。
//   - openError（未決済取得失敗）: 未決済カードは ¥0 を出さず「—」、合計カードも
//     未決済が不明のため「—」+「未決済の取得に失敗」注記。決済済みのみを「合計」と
//     称する過少表示は禁止。
// =============================================================================

interface SalesSummaryProps {
  /** 決済済み売上合計 */
  settledTotal: number;
  /** 決済済み取引件数 */
  settledCount: number;
  /** 未決済(OPEN)売上合計 */
  openTotal: number;
  /** 未決済(OPEN)伝票件数 */
  openCount: number;
  /** 合計売上 = settledTotal + openTotal */
  grandTotal: number;
  /** 合計件数 = settledCount + openCount */
  grandCount: number;
  /** 決済済み(live)取得中 */
  loading: boolean;
  /** 未決済(OPEN)取得中 */
  openLoading: boolean;
  /** 未決済(OPEN)取得エラー（全文・OpenOrderList 側で表示。ここでは不可知表示の判定に使う） */
  openError: string | null;
  /** 表示対象日 (YYYY-MM-DD)。指定時は KPI カード上に期間ラベルを表示 */
  date?: string;
}

/** loading 中の KPI カードプレースホルダ（既存スタイル踏襲） */
function SkeletonCard() {
  return (
    <Card padding="md" aria-hidden="true">
      <div className="h-4 w-24 rounded bg-stone-200 dark:bg-stone-700 animate-pulse" />
      <div className="mt-3 h-8 w-32 rounded bg-stone-200 dark:bg-stone-700 animate-pulse" />
    </Card>
  );
}

export default function SalesSummary({
  settledTotal,
  settledCount,
  openTotal,
  openCount,
  grandTotal,
  grandCount,
  loading,
  openLoading,
  openError,
  date,
}: SalesSummaryProps) {
  // 未決済が「不可知」= 取得失敗。¥0 誤表示を避けるため、未決済・合計を — 表示にする。
  const openUnknown = Boolean(openError);

  return (
    <div className="space-y-2">
      {date && (
        <p className="text-xs text-stone-500 dark:text-stone-400" aria-label="表示対象日">
          対象日: {date}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* 合計カード: 決済済み or 未決済のいずれか取得中は skeleton。未決済不可知なら — */}
        {loading || openLoading ? (
          <SkeletonCard />
        ) : openUnknown ? (
          <StatCard
            label="本日の売上（合計）"
            value="—"
            hint="未決済の取得に失敗"
          />
        ) : (
          <StatCard
            label="本日の売上（合計）"
            value={formatYen(grandTotal)}
            hint={`合計 ${grandCount.toLocaleString('ja-JP')} 件`}
          />
        )}

        {/* 決済済みカード */}
        {loading ? (
          <SkeletonCard />
        ) : (
          <StatCard
            label="決済済み"
            value={formatYen(settledTotal)}
            hint={`${settledCount.toLocaleString('ja-JP')} 件`}
          />
        )}

        {/* 未決済カード: 取得中は skeleton、失敗は ¥0 を出さず — */}
        {openLoading ? (
          <SkeletonCard />
        ) : openUnknown ? (
          <StatCard label="未決済" value="—" hint="取得に失敗" />
        ) : (
          <StatCard
            label="未決済"
            value={formatYen(openTotal)}
            hint={`${openCount.toLocaleString('ja-JP')} 件`}
          />
        )}
      </div>
    </div>
  );
}
