/**
 * L19: マイクロコピー集約
 *
 * すべてのユーザー向け文言を 1 ファイルに集約し、トーンを統一する。
 *
 * トーン規則:
 * - ローディング: `〇〇中…` (三点リーダ U+2026 統一、ASCII `...` 廃止)
 * - 空状態: `〇〇データがありません` (`なし` 単独表現は廃止)
 * - エラー: `〇〇の取得に失敗しました` (主語+目的語+結果動詞)
 * - CTA: 動作のみ (`更新` / `再試行` / `コピー`)、進行形は `〇〇中…`
 *
 * 参照側の typo を tsc で検出するため `as const` で literal 型として export する。
 */
export const MSG = {
  loading: {
    generic: '読み込み中…',
    locations: '店舗情報を取得中…',
    refresh: '更新中…',
  },
  empty: {
    generic: 'データがありません',
    locations: '店舗データがありません',
    transactions: '決済済み伝票はありません',
    openOrders: '未会計の伝票はありません',
    openOrdersHint: '営業時間中の未会計データはここに表示されます',
    segment: 'セグメントデータがありません',
    acquisition: '獲得経路データがありません',
    weekday: '曜日データがありません',
    trend: '推移データがありません',
    sales: '売上データがありません',
    location: '店舗データがありません',
  },
  error: {
    generic: 'エラーが発生しました',
    fetch: 'データの取得に失敗しました',
    locations: '店舗情報の取得に失敗しました',
    period: '期間データの取得に失敗しました',
    network: '通信エラーが発生しました',
    login: 'ログインに失敗しました',
    openOrders: '未決済伝票の取得に失敗しました',
    sales: '売上データの取得に失敗しました',
    transactions: '取引データの取得に失敗しました',
  },
  cta: {
    refresh: '更新',
    retry: '再試行',
    copy: 'コピー',
    copied: 'コピー済',
  },
  warning: {
    partialFailureTransactions: '日の取引データを取得できませんでした（一部データが欠落しています）。',
    partialFailureOpenOrders: '日の未決済伝票を取得できませんでした。',
    partialFailureMultiLocation: '店舗×{n}日でデータを取得できませんでした。',
  },
} as const;
