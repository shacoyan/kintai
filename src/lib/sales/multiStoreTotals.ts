import { toFiniteNumber } from './salesRangeAdapter';

// =============================================================================
// computeMultiStoreDailyTotals — 全店(ALL)×今日 の横断集計（唯一の真実源）
// -----------------------------------------------------------------------------
// オーナー要件(B): 全店合計の3カード(本日の売上(全店合計)/決済済み/未決済) を
// 表示する。下に店舗別(今日)の内訳一覧を出す。本関数は「上の全店合計」を算出する。
//
// 正当性インバリアント（Reviewer 必須確認・過去の二重計上事故の再発防止）:
//   1. 店舗はロケーション別でディスジョイント(各店の売上は他店と重複しない)。
//      → 全店合計 = Σ各店(決済済+未決済) は単純和で二重計上が起きない。
//   2. 決済済みと未決済も定義上ディスジョイント(各店 computeDailyTotals の前提)。
//      → grandTotal = settledTotal + openTotal も単純和で重複しない。
//
// 金額の誠実性(過少表示の禁止):
//   取得失敗した店舗を ¥0 と誤って合算に算入してはならない。
//   error を持つ店舗は合計から除外し、anyError/complete/failedStores で
//   「不可知(一部店舗の取得に失敗)」を呼び出し側へ伝える。
//   呼び出し側は complete=false のとき合計を「—」等で不可知表示し、
//   過少表示(失敗店を 0 とみなした合計)を出さないこと。
//
// NaN/欠落防御: 各店の小計フィールドを toFiniteNumber 経由で正規化し NaN 伝播ゼロ。
// =============================================================================

/**
 * 1 店舗分の当日小計（単店 computeDailyTotals の結果相当）＋取得成否。
 * hook 側(useSquareLiveAllStores)の PerStoreResult から本型へ詰め替える。
 */
export interface StoreDailyEntry {
  /** 店舗名（表示・突合用） */
  storeName: string;
  /** その店の決済済み売上合計 */
  settledTotal: number;
  /** その店の決済済み取引件数 */
  settledCount: number;
  /** その店の未決済(OPEN)売上合計 */
  openTotal: number;
  /** その店の未決済(OPEN)伝票件数 */
  openCount: number;
  /**
   * 取得に失敗した店舗のエラー（全文）。
   * truthy の店舗は合計から除外され failedStores に積まれる。
   */
  error?: string | null;
}

export interface MultiStoreDailyTotals {
  /** 全店(成功店のみ)の決済済み売上合計 = Σ各店settledTotal */
  settledTotal: number;
  /** 全店(成功店のみ)の決済済み取引件数 = Σ各店settledCount */
  settledCount: number;
  /** 全店(成功店のみ)の未決済(OPEN)売上合計 = Σ各店openTotal */
  openTotal: number;
  /** 全店(成功店のみ)の未決済(OPEN)伝票件数 = Σ各店openCount */
  openCount: number;
  /** 全店合計売上 = settledTotal + openTotal */
  grandTotal: number;
  /** 全店合計件数 = settledCount + openCount */
  grandCount: number;
  /** 集計対象(=渡された)店舗数 */
  storeCount: number;
  /** 取得成功した店舗数(合計に算入された店舗数) */
  succeededCount: number;
  /** 取得に失敗した店舗名の配列(全文 error を持っていた店舗) */
  failedStores: string[];
  /** いずれかの店舗が取得失敗したか */
  anyError: boolean;
  /**
   * 全店舗が取得成功か(=合計が信頼できるか)。
   * false のとき呼び出し側は合計を不可知表示し過少表示を避ける。
   * 店舗 0 件のときは complete=true(集計対象なし=矛盾なし)。
   */
  complete: boolean;
}

/**
 * 全店(ALL)×今日 の横断集計。失敗店は合計から除外し complete/anyError で通知する。
 * @param entries 店舗別の当日小計＋取得成否
 */
export function computeMultiStoreDailyTotals(
  entries: StoreDailyEntry[] | null | undefined,
): MultiStoreDailyTotals {
  const list = entries ?? [];

  let settledTotal = 0;
  let settledCount = 0;
  let openTotal = 0;
  let openCount = 0;
  let succeededCount = 0;
  const failedStores: string[] = [];

  for (const entry of list) {
    if (entry?.error) {
      // 取得失敗店は ¥0 として合算しない(過少表示の禁止)。
      failedStores.push(entry.storeName);
      continue;
    }
    settledTotal += toFiniteNumber(entry?.settledTotal);
    settledCount += toFiniteNumber(entry?.settledCount);
    openTotal += toFiniteNumber(entry?.openTotal);
    openCount += toFiniteNumber(entry?.openCount);
    succeededCount += 1;
  }

  const anyError = failedStores.length > 0;

  return {
    settledTotal,
    settledCount,
    openTotal,
    openCount,
    grandTotal: settledTotal + openTotal,
    grandCount: settledCount + openCount,
    storeCount: list.length,
    succeededCount,
    failedStores,
    anyError,
    complete: !anyError,
  };
}
