import { Card } from '../ui';
import { formatYen } from './utils';
import type { PerStoreResult } from '../../hooks/useSquareLiveAllStores';

// =============================================================================
// StoreTodayBreakdown — 全店(ALL)×今日 の店舗別内訳一覧（要件B 下段）
// -----------------------------------------------------------------------------
// オーナー要件(B): 全店合計3カードの下に、店舗別(今日)一覧を出す。
//   各行 = 店舗名 / その店の合計¥(決済済+未決済) / 決済¥(件) / 未決¥(件)。
//
// 金額の誠実性（過少表示禁止）:
//   取得失敗店は ¥0 を出さず「—」を表示し、その行に全文 error を併記する
//   （短縮禁止＝MEMORY ルール）。失敗店は全店合計（上段）からも除外されている。
//
// 表示のみ（金額ロジックは持たない）。集計は useSquareLiveAllStores
// （各店 computeDailyTotals）＋ computeMultiStoreDailyTotals が真実源。
// =============================================================================

interface StoreTodayBreakdownProps {
  /** 店舗別結果（useSquareLiveAllStores の perStore） */
  perStore: PerStoreResult[];
  /** いずれかの店舗を取得中 */
  loading: boolean;
  /** 表示対象営業日 (YYYY-MM-DD)。任意。 */
  date?: string;
  /**
   * 未決済(OPEN)列を表示するか（既定 true）。
   * 未決済は「今この瞬間に未会計の伝票」概念のため【今日のみ】表示する。
   * false（過去日）のとき: 未決済列を隠し、合計(=決済済み)と二重になるため
   * 「売上」1 列に集約した決済済みのみの表示にする。
   */
  showOpen?: boolean;
}

/** loading 中の行スケルトン。dataCols = 店舗名以外の数値列数。 */
function SkeletonRows({ dataCols }: { dataCols: number }) {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={i} aria-hidden="true">
          <td className="px-3 py-2.5">
            <div className="h-4 w-24 rounded bg-stone-200 dark:bg-stone-700 animate-pulse" />
          </td>
          {Array.from({ length: dataCols }, (_, j) => (
            <td key={j} className="px-3 py-2.5 text-right">
              <div className="ml-auto h-4 w-16 rounded bg-stone-200 dark:bg-stone-700 animate-pulse" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function StoreTodayBreakdown({
  perStore,
  loading,
  date,
  showOpen = true,
}: StoreTodayBreakdownProps) {
  // 今日: 合計/決済済み/未決済 の 3 数値列。過去日: 売上(=決済済み) の 1 数値列。
  const dataCols = showOpen ? 3 : 1;
  // colSpan: 失敗店の「—」+ error を数値列ぶんまたぐ。
  const failColSpan = dataCols;
  // 空表示の colSpan は 店舗名 + 数値列。
  const emptyColSpan = dataCols + 1;
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-200">
          {showOpen ? '店舗別（本日）' : '店舗別'}
        </h2>
        {date && (
          <p className="text-xs text-stone-500 dark:text-stone-400" aria-label="表示対象日">
            対象日: {date}
          </p>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <caption className="sr-only">
            {showOpen ? '店舗別の本日の売上内訳' : '店舗別の売上内訳'}
          </caption>
          <thead>
            <tr className="border-b border-stone-200 text-xs text-stone-500 dark:border-stone-700 dark:text-stone-400">
              <th scope="col" className="px-3 py-2 text-left font-medium">
                店舗
              </th>
              {showOpen ? (
                <>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    合計
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    決済済み
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    未決済
                  </th>
                </>
              ) : (
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  売上
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {loading ? (
              <SkeletonRows dataCols={dataCols} />
            ) : perStore.length === 0 ? (
              <tr>
                <td
                  colSpan={emptyColSpan}
                  className="px-3 py-6 text-center text-sm text-stone-400 dark:text-stone-500"
                >
                  対象店舗がありません
                </td>
              </tr>
            ) : (
              perStore.map((s, i) => {
                const failed = Boolean(s.error);
                return (
                  // 同名店の衝突を避けるため index 併用キー（nit-B）。
                  <tr key={`${i}-${s.storeName}`} className="text-stone-900 dark:text-stone-100">
                    <th
                      scope="row"
                      className="px-3 py-2.5 text-left font-medium"
                    >
                      {s.storeName}
                    </th>
                    {failed ? (
                      // 取得失敗店: ¥0 を出さず — 表示し、行内に全文 error を併記（過少表示禁止）。
                      <td
                        colSpan={failColSpan}
                        className="px-3 py-2.5 text-right text-xs text-amber-600 dark:text-amber-400"
                      >
                        <span className="mr-2 font-medium text-stone-400 dark:text-stone-500">
                          —
                        </span>
                        取得に失敗しました：{s.error}
                      </td>
                    ) : showOpen ? (
                      <>
                        <td className="px-3 py-2.5 text-right font-semibold">
                          {formatYen(s.grandTotal)}
                          <span className="ml-1 text-xs font-normal text-stone-400 dark:text-stone-500">
                            {s.grandCount.toLocaleString('ja-JP')}件
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {formatYen(s.settledTotal)}
                          <span className="ml-1 text-xs text-stone-400 dark:text-stone-500">
                            {s.settledCount.toLocaleString('ja-JP')}件
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {formatYen(s.openTotal)}
                          <span className="ml-1 text-xs text-stone-400 dark:text-stone-500">
                            {s.openCount.toLocaleString('ja-JP')}件
                          </span>
                        </td>
                      </>
                    ) : (
                      // 過去日: 売上(=決済済み) 1 列のみ。未決済概念が無い。
                      <td className="px-3 py-2.5 text-right font-semibold">
                        {formatYen(s.settledTotal)}
                        <span className="ml-1 text-xs font-normal text-stone-400 dark:text-stone-500">
                          {s.settledCount.toLocaleString('ja-JP')}件
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
