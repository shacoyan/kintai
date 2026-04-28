# Loop 15 Phase 3 — STYLE.md 新規 + useReducedMotion 棚卸し 技術設計書

- 起票日: 2026-04-28
- プロジェクト: kintai
- ループ: Loop 15 Phase 3（最終フェーズ）
- 前段: Phase 1 完了 (newWorld 3bfc9ad) / Phase 2 完了 (newWorld ee4eede / kintai bb8e158)
- 並列度: **2 並列（Engineer A / Engineer B）**、依存関係なし、1 ラウンド完結見込み

---

## 1. 概要

### 何を
Loop 15 の締めくくりとして、以下 2 タスクを並列実行する。

| ID | タスク | 種類 | 担当 |
|---|---|---|---|
| L15-8 | `kintai/STYLE.md` 新規作成（Tailwind/UI スタイル規約の集約） | 新規ドキュメント | Engineer A |
| L15-9 | `useReducedMotion` 棚卸しドキュメント作成（Loop 16 候補の整理） | 新規ドキュメント | Engineer B |

### なぜ
- **L15-8**: Phase 1 で行った品質改善（slate→neutral、dark 対応、logger 統一、URL クエリ規律）と Phase 2 のセレクタ規約 JSDoc が散在。**新規メンバー / Engineer サブエージェントが参照する単一の規約ドキュメント** が必要。今後の Loop で「規約違反」を Reviewer が機械的に判定できる根拠資料となる。
- **L15-9**: 現状調査で `motion-safe:` プレフィックスは大半適用済みだが、`useReducedMotion` フック（`src/hooks/useReducedMotion.ts`）は **存在するのに利用箇所ゼロ**。CSS 制御で吸収できない JS アニメーション（setTimeout / requestAnimationFrame / インラインスタイル等）の棚卸しを行い、Loop 16 で実装する具体候補を確定する。

### スコープ外（今回 Phase 3 では実施しない）
- L15-9 の **コード修正は禁止**。ドキュメントのみ。実装は Loop 16+ で別タスクとして起票。
- 既存 `motion-safe:` の書き換え。
- Tailwind config の変更。

---

## 2. 分割戦略

### 並列度・チーム構成
- **Engineer A (GLM)**: L15-8 STYLE.md 作成
- **Engineer B (GLM)**: L15-9 useReducedMotion 棚卸しドキュメント作成
- **Reviewer (1名集約)**: 両ドキュメントを 1 名でレビュー（Phase 2 と同じ集約方式）
- **Tech Lead 統合 + 承認**: 統合チーム廃止（2026-04-25 ルール）に伴い Tech Lead が直接統合

### 依存関係
- **なし**（両タスクは完全独立、出力ファイルパスも別）
- Engineer A の出力 = `kintai/STYLE.md`
- Engineer B の出力 = `kintai/.company/engineering/docs/2026-04-28-kintai-reducedmotion-inventory.md`

### 競合リスク
- ゼロ。新規ファイル 2 本のみ。既存ファイルへの編集なし。

### 工数見積もり
- Engineer A: 約 15 分（GLM がファイルリダイレクトで一気に出力 → grep 検証）
- Engineer B: 約 10 分（grep → 表整形）
- Reviewer 集約: 約 5 分
- Tech Lead 統合 + 承認 + dual push: 約 5 分
- **合計: 約 30 分（1 ラウンド完結見込み）** ✅

---

## 3. チーム別タスク

### 3.1 Engineer A — L15-8 STYLE.md 新規作成

#### 対象ファイル（新規）
`kintai/STYLE.md`（プロジェクトルート直下、150〜200 行）

#### 実装方針
**GLM 出力をファイルリダイレクト方式**（トークン節約）。
プロンプトに「以下のテンプレートを埋めて Markdown ファイルとして出力せよ」と指示し、
`> kintai/STYLE.md` で書き出す。

#### 含めるセクション（番号順、見出しレベルも遵守）

```markdown
# kintai スタイルガイド

## 1. 目的・スコープ
- kintai 内の Tailwind / UI スタイル規約を集約
- 対象: `kintai/src/**/*.{ts,tsx,css}`
- 対象外: 外部ライブラリ（@radix-ui、shadcn 等）の内部スタイル
- 改訂履歴は git ログを正とし、本ドキュメントには書かない

## 2. カラーパレット規約

### 2.1 グレースケール
- **使用**: `neutral-*`（Tailwind デフォルト）
- **禁止**: `slate-*` / `gray-*` / `zinc-*` / `stone-*`
- 経緯: Loop 15 Phase 1 で `slate-*` → `neutral-*` に統一済み

### 2.2 セマンティックカラー
| 用途 | 推奨 | 禁止 |
|---|---|---|
| 警告 | `amber-*` | `yellow-*` |
| エラー | `red-*` / `danger-*`（Tailwind config 拡張） | `rose-*` / `pink-*` |
| 成功 | `emerald-*` / `green-*` / `success-*` | — |
| プライマリ | `primary-*`（Tailwind config 拡張） | 直接 `blue-*` |

### 2.3 透過度
- `bg-black/50`、`bg-white/80` 等の slash 記法を使う
- `bg-opacity-*` は禁止（旧記法）

## 3. Dark モード規約

### 3.1 必須ルール
すべての色指定は **`dark:` バリアントとペアで書く**。

```tsx
// ✅ OK
<div className="bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-200">

// ❌ NG（dark 未指定）
<div className="bg-white text-neutral-700">
```

### 3.2 ペア対応表（推奨マッピング）
| Light | Dark |
|---|---|
| `bg-white` | `dark:bg-neutral-900` |
| `bg-neutral-50` | `dark:bg-neutral-800` |
| `bg-neutral-100` | `dark:bg-neutral-800` |
| `text-neutral-900` | `dark:text-neutral-100` |
| `text-neutral-700` | `dark:text-neutral-200` |
| `text-neutral-500` | `dark:text-neutral-400` |
| `border-neutral-200` | `dark:border-neutral-700` |
| `border-neutral-300` | `dark:border-neutral-600` |

### 3.3 例外
- `text-white` / `bg-black` のような絶対色はペア不要
- 影 (`shadow-*`) は dark で見栄えに応じて `dark:shadow-none` 等を検討

## 4. コンポーネント別 代表クラス例

| コンポーネント | 代表クラス例 |
|---|---|
| Button (primary) | `bg-primary-600 hover:bg-primary-700 text-white motion-safe:transition-colors` |
| Button (secondary) | `bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700` |
| Button (danger) | `bg-danger-600 hover:bg-danger-700 text-white` |
| Input | `bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 placeholder:text-neutral-300 motion-safe:transition-colors` |
| Select | Input と同等 + `appearance-none` |
| Card | `bg-white dark:bg-neutral-800 rounded-lg shadow-sm border border-neutral-200 dark:border-neutral-700` |
| Toast | `bg-neutral-900 text-white rounded-md shadow-lg motion-safe:animate-fade-in` |
| Badge | `inline-flex items-center px-2 py-0.5 rounded text-xs font-medium` |
| EmptyState | `text-neutral-500 dark:text-neutral-400 text-center py-8` |
| BreakButton | `bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 text-white motion-safe:transition-colors` |
| ClockButton | `w-48 h-48 rounded-full motion-safe:transition-all duration-300` |
| TenantSelector | `bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 motion-safe:transition-all` |
| StoreSelector | TenantSelector と同等 |
| MemberManagement (行) | `bg-white dark:bg-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-700/50` |
| StoreManagement (カード) | Card と同等 |
| AttendanceAdmin (テーブル) | `border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-200 dark:divide-neutral-700` |
| MonthlySummary (見出し) | `text-neutral-900 dark:text-neutral-100 font-semibold` |

> 詳細な完全クラス列は各コンポーネントのソースを正とする。本表は「迷ったらここを真似る」基準。

## 5. logger 規約（Phase 1 統一済み）

### 5.1 形式
```ts
import { logger } from '@/lib/logger';
import { formatSupabaseError } from '@/lib/errors';

try {
  // ...
} catch (err) {
  logger.error('failed to fetch attendance:', formatSupabaseError(err));
}
```

### 5.2 ルール
- `console.log` / `console.error` の **直接呼び出しは禁止**
- 第 1 引数: メッセージ末尾は `:`（コロン）で終わる
- 第 2 引数: 必ず `formatSupabaseError(err)` を通す（生 err を渡さない）
- info/warn/error の使い分けは `src/lib/logger.ts` の JSDoc を参照

## 6. URL クエリ規律（Phase 1 コメント済み）

### 6.1 SearchParams の更新パターン
```tsx
// ✅ OK
const next = new URLSearchParams(searchParams);
next.set('tab', 'history');
setSearchParams(next, { replace: true });

// ❌ NG（直接ミューテーション）
searchParams.set('tab', 'history');
```

### 6.2 ルール
- 必ず `new URLSearchParams(searchParams)` で **複製してから** mutate する
- ナビゲーション履歴を増やさないキー（タブ・フィルタ等）は `{ replace: true }`
- ページ遷移を伴うキー（詳細 ID 等）は `{ replace: false }`（デフォルト）

## 7. セレクタ規約（E2E / Playwright）

### 7.1 優先順位（Phase 2 JSDoc 化済みを本格ドキュメント化）

| 順位 | セレクタ | 用途 |
|---|---|---|
| 1 | `getByLabel(...)` | フォーム入力（label 紐付き） |
| 2 | `getByRole('button', { name: '...' })` | ボタン・リンク・見出し |
| 3 | `getByText(...)` | テキストノード一意特定 |
| 4 | `getByTestId(...)` / `data-testid` | role / text で特定不可なケースのみ |
| 5 | `locator('css selector')` | 最終手段（必ずコメントで理由を残す） |

### 7.2 data-testid 命名規約
- 形式: `{component-kebab}-{role}-{detail?}`
- 例: `clock-button-start`, `tenant-selector-trigger`, `attendance-row-{id}`

### 7.3 待機戦略
- `waitForSelector` より `expect(locator).toBeVisible({ timeout })` を推奨
- ネットワーク待ちは `waitForResponse` で URL pattern 一致

## 8. アニメーション規約

### 8.1 motion-safe プレフィックス
- すべての `transition-*` / `animate-*` には **`motion-safe:` を付ける**
- 例: `motion-safe:transition-colors`、`motion-safe:animate-spin`
- 経緯: `prefers-reduced-motion` ユーザーへの配慮（global CSS shield も `src/index.css` にあり）

### 8.2 JS アニメーション
- setTimeout / requestAnimationFrame / インラインスタイル変更を伴う動的アニメは
  `useReducedMotion()` フック（`src/hooks/useReducedMotion.ts`）で分岐
- 詳細は別ドキュメント `2026-04-28-kintai-reducedmotion-inventory.md` 参照

## 9. 将来の拡張ポイント

次ループ以降で追加予定の規約スロット（プレースホルダ）:

- **9.1 フォーム規約**: react-hook-form + zod の標準パターン
- **9.2 エラーハンドリング規約**: try/catch + Toast + logger の三段ルール
- **9.3 レスポンシブ規約**: ブレークポイント（sm/md/lg/xl）の使い分け基準
- **9.4 z-index 規約**: モーダル / ドロップダウン / トースト の階層整理
- **9.5 アクセシビリティ規約**: ARIA / キーボード操作 / フォーカス管理
- **9.6 i18n 規約**: 文字列の集約・翻訳キー命名

> 各スロットは Loop 進行に合わせて埋める。空のうちはセクション見出しのみ残す。
```

#### 成功基準
- [ ] `kintai/STYLE.md` が存在し、150〜200 行の範囲に収まる
- [ ] 上記 9 セクション（1〜9）がすべて存在する
- [ ] コードブロック（````tsx` / ````ts`）が正しく閉じている
- [ ] Markdown レンダリング崩れがない（`grep -c '^```' kintai/STYLE.md` の結果が偶数）

#### 完了条件
- [ ] ファイルが上記パスに作成されている
- [ ] `wc -l kintai/STYLE.md` が 150〜220 行
- [ ] `grep -c '^## ' kintai/STYLE.md` が 9（h2 セクションが 9 個）

#### 注意点
- **コードを書かない**（`.tsx` 等への変更は禁止、Markdown 内のサンプルコードはOK）
- カラーパレットの「禁止」項目は Phase 1 で実際に統一した経緯を尊重する（slate / yellow）
- セレクタ規約は Phase 2 で書いた JSDoc の内容と整合させる（齟齬があれば JSDoc 側を正とする）
- Tailwind の `primary-*` / `danger-*` / `success-*` は kintai 独自拡張（`tailwind.config` 参照）

---

### 3.2 Engineer B — L15-9 useReducedMotion 棚卸しドキュメント作成

#### 対象ファイル（新規）
`kintai/.company/engineering/docs/2026-04-28-kintai-reducedmotion-inventory.md`

#### 実装方針
1. 以下 4 コマンドを kintai ルートで実行し、結果を保存:
   ```bash
   cd kintai
   grep -rn "transition-" src/  > /tmp/grep-transition.txt
   grep -rn "animate-"    src/  > /tmp/grep-animate.txt
   grep -rn "duration-"   src/  > /tmp/grep-duration.txt
   grep -rn "motion-safe:\|motion-reduce:\|useReducedMotion\|prefers-reduced-motion" src/ > /tmp/grep-motion-aware.txt
   ```
2. 上記結果を以下のドキュメントテンプレートに整形して書き出す。

#### ドキュメントテンプレート

```markdown
# useReducedMotion 棚卸し（Loop 16+ 候補ピックアップ）

- 起票日: 2026-04-28
- プロジェクト: kintai
- ループ: Loop 15 Phase 3 内の調査タスク（コード修正なし）
- 目的: `prefers-reduced-motion: reduce` ユーザーへの配慮状況を全面棚卸しし、Loop 16 以降の実装候補を確定する

## 0. 既存基盤（現状把握）

| 種別 | 場所 | 内容 |
|---|---|---|
| Global CSS shield | `src/index.css` L33-38 | `@media (prefers-reduced-motion: reduce)` で全要素の animation/transition を 0.01ms に短縮 |
| React フック | `src/hooks/useReducedMotion.ts` | matchMedia で reduce 判定を返す。**現在利用箇所ゼロ** |
| Tailwind プレフィックス | 各コンポーネント | `motion-safe:` を概ね全 transition/animate に適用済み |

> CSS shield と Tailwind `motion-safe:` で **静的 CSS アニメーションは既に reduce 対応済み**。
> 残課題は **JS 制御アニメーション**（setTimeout / setInterval / requestAnimationFrame / インラインスタイル動的変更）。

## 1. grep 結果サマリー

| パターン | 検出件数 | 備考 |
|---|---|---|
| `transition-` | (Engineer 実測値) | 大半が `motion-safe:transition-` |
| `animate-` | (Engineer 実測値) | 大半が `motion-safe:animate-` |
| `duration-` | (Engineer 実測値) | transition/animate に付随 |
| `motion-safe:` / `motion-reduce:` | (Engineer 実測値) | 適用済み箇所 |
| `useReducedMotion` | 1（フック定義のみ） | **利用箇所ゼロ** |
| `prefers-reduced-motion` | 1（CSS のみ） | shield 定義のみ |

## 2. motion-safe 未適用の transition/animate 一覧

> `grep "transition-" | grep -v "motion-safe:"` の結果から、CSS shield 自身を除いたもの。

| ファイル | 行 | パターン | 現状 | 推奨対応 | 優先度 |
|---|---|---|---|---|---|
| (該当行を Engineer がここに転記) | | | | | |

> 0 件であれば「**全コンポーネント `motion-safe:` 適用済み**」と明記する。

## 3. JS アニメーション候補（useReducedMotion 適用検討対象）

> 以下を Engineer が `grep -rn "setTimeout\|setInterval\|requestAnimationFrame" src/` で抽出して埋める。
> 純粋な debounce / polling は除外し、**視覚的アニメーション目的のもの** のみ列挙。

| ファイル | 行 | 用途 | 現状 | 推奨対応 | 優先度 |
|---|---|---|---|---|---|
| (Engineer 実測) | | | | `useReducedMotion()` で短縮 or スキップ | 高/中/低 |

### 3.1 想定される候補例（Engineer は実測で置き換え）
- ClockButton の `flashGreen` トグル（緑フラッシュ演出）
- Toast の自動 dismiss タイマー（演出ではないので対象外の可能性）
- スクロール演出 / スムーススクロール
- カウントアップアニメーション（数値を段階的に増やす類）

## 4. インラインスタイル / style 属性での動的アニメ

> `grep -rn "style={{" src/ | grep -E "transform|opacity|transition"` の結果を整理。

| ファイル | 行 | 内容 | 推奨対応 | 優先度 |
|---|---|---|---|---|

## 5. 優先度付け基準

| 優先度 | 基準 |
|---|---|
| **高** | ユーザー操作の主動線で頻発（Clock/Break/Tenant 切替等）かつ JS 制御 |
| **中** | 管理画面・補助機能で発生する JS アニメーション |
| **低** | 既に `motion-safe:` が効いている / 演出的に微細 |

## 6. Loop 16+ 実装候補（確定リスト）

このセクションが **Loop 16 起票時の実装スコープ** となる。Engineer は優先度「高」を中心に 3〜5 件ピックアップする。

- [ ] (候補 1) — ファイル / 行 / 推奨対応
- [ ] (候補 2) — ファイル / 行 / 推奨対応
- [ ] (候補 3) — ファイル / 行 / 推奨対応

## 7. 結論

(Engineer が以下のどちらかを記載)

- **A**: 既存の CSS shield + `motion-safe:` で実用上十分。`useReducedMotion` フックは将来 JS アニメ追加時に備えて残置。Loop 16 では実装タスク化しない。
- **B**: 上記 N 件の JS アニメーションが reduce 未対応。Loop 16 で `useReducedMotion()` を適用する実装タスクを起票推奨。

## 8. 補足

- 本ドキュメントは **Phase 3 完了時点のスナップショット**
- 今後 transition/animate を追加する PR は STYLE.md §8 の規約に従い `motion-safe:` を必ず付ける
- JS アニメ追加時は本ドキュメントを更新するか、新規棚卸しドキュメントを作成
```

#### 成功基準
- [ ] ファイルが上記パスに作成されている
- [ ] §1 のサマリー表に **実測値** が入っている（「(Engineer 実測値)」のままでない）
- [ ] §2 / §3 / §4 の表に少なくとも **「該当 0 件」または実データ** が入っている
- [ ] §6 に Loop 16 候補が **0〜5 件** ピックアップされている（0 件なら結論 A）
- [ ] §7 結論が A/B のどちらかで明記されている

#### 完了条件
- [ ] `wc -l kintai/.company/engineering/docs/2026-04-28-kintai-reducedmotion-inventory.md` が 80〜200 行
- [ ] `grep -c '^## ' [上記パス]` が 8（§0〜§8）
- [ ] **コード変更が 1 行もない**（`git diff src/` が空であることを Reviewer が確認）

#### 注意点
- **コードを書かない**（`src/` への変更は禁止）
- grep 結果は端折らず、**該当ファイル名・行番号は正確に転記**
- 推奨対応は控えめに書く（「検討」「候補」レベル、断定しない）
- 既存基盤の事実関係（§0）に誤りがないか `src/index.css` `src/hooks/useReducedMotion.ts` を必ず確認

---

## 4. 統合時の注意点（Tech Lead / Reviewer 向け）

### 4.1 統合順序
1. Engineer A / B が並列で着手（独立タスク）
2. Reviewer が両ドキュメントを 1 名で連続レビュー
3. 差し戻しがあれば該当 Engineer のみ再修正
4. Tech Lead 統合 = 形式チェック（`wc -l`、`grep -c '^## '`、リンク切れチェック）
5. dual push（newWorld + kintai/main subtree push）

### 4.2 形式検証コマンド（Tech Lead 承認時に実行）
```bash
cd kintai
# L15-8
test -f STYLE.md && wc -l STYLE.md
grep -c '^## ' STYLE.md   # → 9
grep -c '^```' STYLE.md   # → 偶数
# L15-9
test -f .company/engineering/docs/2026-04-28-kintai-reducedmotion-inventory.md
wc -l .company/engineering/docs/2026-04-28-kintai-reducedmotion-inventory.md
grep -c '^## ' .company/engineering/docs/2026-04-28-kintai-reducedmotion-inventory.md  # → 8
# 副作用ゼロ確認
git diff src/ | wc -l   # → 0
```

### 4.3 整合性チェック
- STYLE.md §8（アニメーション規約）と reducedmotion-inventory.md §0（既存基盤）が矛盾しないこと
- STYLE.md §7（セレクタ規約）と Phase 2 で追加した JSDoc コメントが矛盾しないこと
- STYLE.md §5（logger 規約）と `src/lib/logger.ts` の実装が一致すること

### 4.4 リスク
- **低**。新規ドキュメント 2 本のみ、既存コードへの影響なし。
- ロールバックは `git rm` 2 ファイルで完結。

---

## 5. ロールアウト

1. Tech Lead がこの設計書を秘書に提示
2. 秘書承認後、Engineer A / B に並列発注
3. GLM 出力 → Reviewer 集約 → Tech Lead 統合 + 承認
4. dual push（newWorld + kintai/main）
5. 秘書へ完了報告 + Loop 15 全 9 タスク完遂を宣言

---

## 6. Phase 3 完了 = Loop 15 完遂

Loop 15 の全 9 タスク（Phase 1: L15-1〜4 / Phase 2: L15-5〜7 / Phase 3: L15-8〜9）完了をもって、
**Loop 15「品質改善 + テスト基盤 + ドキュメント整備」サイクル終了**。

次ループ Loop 16 候補:
- L15-9 ピックアップ結果に基づく `useReducedMotion` 適用（必要なら）
- STYLE.md §9 拡張ポイントの 1 つを Loop 16 のテーマとして選定（フォーム規約 / エラー規約 等）
- 別系統の機能追加 / バグ修正

---

(設計書ここまで)
