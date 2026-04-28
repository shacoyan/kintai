# L21: ShiftAdminPanel アクション集約 — 技術設計書

- 対象プロジェクト: `kintai`
- 対象ファイル本体: `src/components/Shift/ShiftAdminPanel.tsx` (520 行)
- 呼び出し元: `src/pages/ShiftPage.tsx` L499 (props 11 個、変更しない)
- 作成日: 2026-04-28
- 上位文脈: シフト申請/承認 10 Loop UX 改善 (L20 完了済 / L21 in_progress)
- ルール: Tech Lead 設計のみ。実装は Engineer (GLM) → Reviewer → Tech Lead 統合承認。

---

## 1. 背景・現状調査結果

### 1-1. 現状アクションの棚卸し（status × ロール別）

`ShiftAdminPanel.tsx` 内、shift カード右側に並ぶアクションボタンを status ごとに集計:

| status | 表示中ボタン | ボタン数 | 確認(2 段階)パターン |
|--------|------|------|---|
| `pending` | 承認 / 修正 / 却下 | 3 (確認時 +戻す) | approve, reject |
| `approved` | 修正 / 削除 | 2 | delete |
| `rejected` | 復活承認 / 削除 | 2 | restore(=approve), delete |
| `modified` | 再修正 / 削除 | 2 | delete |
| `cancelled` | (一覧から除外) | 0 | — |
| 全 status (修正中) | 確定 / 取消 (時刻 select 2 つ) | — | — |
| ヘッダ | 一括承認 + 件数バッジ | 1 (確認時 +戻す) | bulk approve |

**追加観察**:
- いずれの破壊的/状態変更操作も「1 タップで実行」ではなく「ボタン → 同位置に確認ボタン+戻す」の **インライン 2 段階確認**。これは UX 上良いが「ボタンが揃って見えない瞬間」が発生し、ユーザーが文脈喪失しやすい。
- `pending` で 3 ボタン横並び + ステータスバッジ + 店舗バッジ + 日付 + 時刻 + メンバー名で、SP 縦幅が圧迫。
- `approved` / `rejected` / `modified` の「修正/削除」「復活承認/削除」「再修正/削除」は **2 ボタンで散らばっており**、削除という危険操作が常時露出している。
- 既存ボタンは `min-h-[44px]` 指定が **修正中の確定/取消ボタンのみ**。他のアクション(`px-2.5 py-1`)は実測 24-26px 程度で **SP タップターゲット 44px に未達**。L18 以降の 44px 方針からは違反状態。

### 1-2. プライマリ / セカンダリ分類（提案）

| status | プライマリ (常時露出) | セカンダリ (メニュー集約) |
|--------|------------------|--------------------|
| `pending` | **承認** (success, 確認 2 段階維持) | 修正 / 却下 |
| `approved` | **修正** (primary) | 削除 |
| `rejected` | **復活承認** (success) | 削除 |
| `modified` | **再修正** (primary) | 削除 |

設計の根拠:
- 店長の主タスクは「承認」。`pending` のプライマリは承認で異論なし。
- `approved/modified` の主タスクは時刻調整→「修正」がプライマリ、削除は事故防止のためメニューへ。
- `rejected` は復活承認(=救済)が主、削除は完全消去でセカンダリ。
- 却下は破壊的だがサブ。誤タップ時の心理コストが高いため secondary 扱い + 既存 2 段階確認を維持。

### 1-3. 既存基盤・利用可否

| 部品 | 場所 | L21 で使えるか |
|---|---|---|
| `BottomSheet` | `src/components/ui/BottomSheet.tsx` (148L) | YES — Esc 閉じ / focus trap / body scroll lock / role=dialog 完備。SP では bottom、PC では centered で表示済 |
| `Button` | `src/components/ui/Button.tsx` | YES (variant 既存) |
| DropdownMenu / Popover / Menu | **なし** | 新規作成必要 |
| `MoreHorizontal` / `MoreVertical` icon | lucide-react に存在 (依存済 `^1.11.0`) | YES — import 追加のみ |
| 類似実装 | `TenantSwitcher.tsx` / `NotificationBell.tsx` / `TopBar.tsx` / `StoreSelector.tsx` が `aria-haspopup="menu"` + `aria-expanded` パターン実装済 | 参考可 (パターン流用) |

### 1-4. テスト・依存

- `src/components/Shift/ShiftAdminPanel.tsx` 専用テストなし (調査済)。
- 呼び出し元は `ShiftPage.tsx` のみ。props インターフェース不変なら他影響ゼロ。
- 業務ロジック(`onApprove/onReject/onModify/onBulkApprove/onDelete`)は **完全に hook 経由**で本コンポーネントに副作用ロジック無し。プレゼンテーション差し替えのみで完結。

---

## 2. 集約方針

### 2-1. 全体方針

**プライマリ + Kebab メニュー(セカンダリ) のハイブリッド**を採用し、PC/SP で同じ構造、ただし **SP では Kebab 起動時に BottomSheet で展開** (PC は Popover ドロップダウン) する。

### 2-2. 採用案の比較

| 案 | 概要 | メリット | デメリット | 判定 |
|---|---|---|---|---|
| **案A: Kebab に集約 (Popover/BottomSheet ハイブリッド)** | プライマリ 1 つ + `MoreVertical` で残りを開く。PC=Popover, SP=BottomSheet | 視覚ノイズ最小 / 業界標準 / SP 44px 確保しやすい / 既存 BottomSheet 流用可 | 1 タップ余計 / Popover 実装が新規 | **採用** |
| 案B: ステータス別最小アクションのみ | カード上はプライマリ 1 つだけ表示、セカンダリは行クリックで展開 | 最小ボタン数 | 削除/却下にアクセスする手段が直感的でない / 行クリックの discoverability 低い | 不採用 |
| 案C: 全アクションを BottomSheet 詳細パネル | カード上は何も置かず、行タップ→BottomSheet 内に全アクション | カード超ミニマル / SP に最適 | PC で常に 2 タップ要求は冗長 / 一括承認や承認待ちレビューは 1 タップ希望が大 | 不採用 |

**選定理由**: 案A は「主操作 (承認/修正/復活承認/再修正) は 1 タップ維持」「破壊的 (却下/削除) は 1 階層深く」のバランスが取れ、SP では BottomSheet 流用で開発コスト最小、PC では即応性を犠牲にしない。

### 2-3. レスポンシブ戦略

| breakpoint | プライマリ | セカンダリ展開先 |
|---|---|---|
| `< sm` (640px 未満) | 同左 | **BottomSheet** (既存 `BottomSheet.tsx` 流用、title はカード概要) |
| `>= sm` | 同左 | **Popover** (新規 `ActionMenu` 内蔵、kebab ボタン基準で右下展開) |

切替は `window.matchMedia('(min-width: 640px)')` を 1 度購読する hook (`useIsDesktop` 等) を新設、または既存の Tailwind ブレークポイント整合のための `useMediaQuery` を新設 (依存ゼロ実装)。

### 2-4. 既存「インライン 2 段階確認」の取り扱い

- **プライマリ承認 / 復活承認**: 既存の「ボタン→確認ボタン+戻す」を **維持**。メニューに包む必要なし。
- **却下 (pending)** / **削除 (approved/rejected/modified)**: メニュー内で選択された後の確認は **同じインラインパターンを維持**。ただし表示位置はメニューを閉じた後にカードのアクション領域へインラインで出す (現状の confirmingId / deletingId state ロジックを再利用)。
  - 代替案: 確認ステップを BottomSheet 内に閉じ込める。→ 却下: 採用しない (現行 UX 一貫性維持優先、Engineer 実装コスト削減)。

---

## 3. 新規/拡張コンポーネント設計

### 3-1. `src/components/ui/ActionMenu.tsx` (新規)

**責務**: トリガー (Kebab ボタン) + メニュー本体。デスクトップは Popover、SP は BottomSheet で表示する責務をカプセル化。

**Props 設計 (シグネチャのみ — 実装は Engineer)**:

```ts
export type ActionMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  tone?: 'default' | 'danger' | 'primary' | 'success'; // tailwind tone マッピング
  disabled?: boolean;
  icon?: React.ReactNode; // optional lucide icon
};

export interface ActionMenuProps {
  items: ActionMenuItem[];
  triggerLabel?: string;        // default: "操作メニュー" (aria-label)
  triggerSize?: 'sm' | 'md';    // SP 44px 担保のため md がデフォ
  align?: 'start' | 'end';      // Popover 開閉位置 (PC のみ有効)
  bottomSheetTitle?: string;    // SP BottomSheet header (例: メンバー名 + 日付)
  disabled?: boolean;
}
```

**a11y 要件**:
- トリガー: `<button>` + `aria-haspopup="menu"` + `aria-expanded={open}` + `aria-controls={menuId}` + `aria-label={triggerLabel}`
- メニュー: `role="menu"` 、各 item は `role="menuitem"`
- Esc / Tab フォーカス処理: BottomSheet 経路は既存 trap 流用、Popover 経路は **outside click + Escape で閉じる** + フォーカスはトリガーへ復帰
- アイコンのみのトリガー: `aria-label` 必須、`<MoreVertical aria-hidden="true" />`

**スタイル要件**:
- Trigger: `min-h-[44px] min-w-[44px]` でタップターゲット担保
- dark mode: `dark:text-neutral-300 dark:hover:bg-neutral-700` 系のペア必須 (L23 観点を先取り)
- Popover: `absolute right-0 mt-1 z-20 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-md shadow-lg`
- danger tone item: `text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/20`

**SP / PC 切替**: `useMediaQuery('(min-width: 640px)')` で判定。`isDesktop` 時は Popover、それ以外は BottomSheet を render。

### 3-2. `src/hooks/useMediaQuery.ts` (新規・極小)

**シグネチャ**:
```ts
export function useMediaQuery(query: string): boolean;
```
- 内部: `useEffect` で `matchMedia` 購読、unmount で解除。SSR 安全 (`typeof window === 'undefined'` ガード)。
- Vite/CSR 構成のため SSR 厳密性は不要だが、念のため初期 false。

### 3-3. `src/components/ui/index.ts` への export 追加

```ts
export { ActionMenu } from './ActionMenu';
export type { ActionMenuItem, ActionMenuProps } from './ActionMenu';
```

### 3-4. `ShiftAdminPanel.tsx` 改修方針

- 既存 4 つの status 別ブロック (pending / approved / rejected / modified) のアクション領域を以下構造に書き換え:
  ```
  [プライマリボタン (status 別)] [<ActionMenu items={secondaryItems}/>]
  ```
- `pending` の承認/却下、`*` の削除、`*` の修正のうち、status ごとに **プライマリ 1 + セカンダリ N** で再構成。
- インライン 2 段階確認 state (`confirmingId`, `deletingId`) はそのまま使う。`ActionMenu` の item `onSelect` 内で既存 setter を呼び出し → カードに既存の確認 UI が出る、という流れを維持。
- 「修正中 (`isModifying`)」状態のときは ActionMenu は **非表示** (現状の確定/取消だけ表示)。
- 「権限なし (`!canManageRow`)」時は ActionMenu 不表示。
- ヘッダの一括承認は **対象外** (1 ボタン+2 段階確認、既に集約済とみなす)。

### 3-5. プライマリボタンサイズの 44px 化 (L21 ついで対応)

現状 `px-2.5 py-1` で実測 24px 高さ → タップターゲット未達。本 L21 のスコープに含めて以下に揃える:
- プライマリボタン: `min-h-[44px] px-3 py-2`
- ActionMenu トリガー: `min-h-[44px] min-w-[44px]`
- 確認モード時の「○○する / 戻す」ボタン: 同上

これは Loop 全体方針 (L18 以降) の遵守であり、Engineer 範囲に含める。

---

## 4. 影響範囲

| 影響箇所 | 影響内容 | リスク |
|---|---|---|
| `ShiftAdminPanel.tsx` | 大規模リファクタ (アクション領域置換 + import 追加) | 中 — 業務ロジック props 不変なので限定的 |
| `ShiftPage.tsx` | 変更なし | 0 |
| `src/components/ui/index.ts` | export 1 行追加 | 0 |
| `src/components/ui/ActionMenu.tsx` | 新規 | — |
| `src/hooks/useMediaQuery.ts` | 新規 | — |
| 既存 `BottomSheet` | API 変更なし、利用追加のみ | 0 |
| a11y | aria-haspopup/expanded/controls 必須 | レビューで担保 |
| dark mode | 全 tone でペア必須 | レビューで担保 |
| 既存テスト | 該当なし (調査済) | 0 |
| Vite ビルド / TypeScript | 型エラーなしを必須 | Engineer + Reviewer 担保 |

---

## 5. Engineer 分割

並列度を最大化するため **3 チーム並列** (依存最小、A → B → C 順序ではあるが Stub で並列起動可能)。

### Team A: `ActionMenu` コンポーネント新設
- **対象ファイル**:
  - `src/components/ui/ActionMenu.tsx` (新規)
  - `src/hooks/useMediaQuery.ts` (新規)
  - `src/components/ui/index.ts` (export 追加)
- **タスク**:
  1. `useMediaQuery` 実装 (SSR ガード付き)
  2. `ActionMenu` 実装: SP=BottomSheet, PC=Popover, a11y (haspopup/expanded/controls/menu/menuitem) 完備
  3. tone (default/danger/primary/success) を tailwind class に解決
  4. dark mode 全 tone ペア対応
  5. トリガー / メニューアイテム共に `min-h-[44px]`
  6. outside click + Escape 閉じ + focus 復帰 (PC)
- **期待動作**: 単体で `import { ActionMenu } from './ui'` 可能、Storybook なしで型チェック通過。
- **GLM プロンプト方針**: シグネチャ + a11y 仕様 + tailwind tone マップを渡し、TenantSwitcher の Popover 実装パターン参照を指示。

### Team B: `ShiftAdminPanel` アクション集約改修
- **対象ファイル**: `src/components/Shift/ShiftAdminPanel.tsx`
- **依存**: Team A の `ActionMenu` 公開シグネチャ (上記 3-1 を契約として確定済 → 並列着手可)
- **タスク**:
  1. `ActionMenu` import 追加、`MoreVertical` は ActionMenu 内蔵想定で本ファイルへの追加不要
  2. status 別 4 ブロックを `[プライマリ] + <ActionMenu items={...}/>` 構造に置換
     - pending: primary=承認(既存 2 段階確認維持), secondary=[修正, 却下]
     - approved: primary=修正, secondary=[削除]
     - rejected: primary=復活承認(既存 2 段階確認維持), secondary=[削除]
     - modified: primary=再修正, secondary=[削除]
  3. `bottomSheetTitle` に `${memberName} ${date}` を渡してコンテキスト保持
  4. プライマリボタン 44px 化
  5. インライン確認 UI 領域は既存ロジック維持 (state そのまま)
  6. 修正中 / 権限なし時は ActionMenu 非表示分岐
- **期待動作**: 既存 props 不変、Vite ビルド + tsc strict 通過、既存「承認/却下/修正/削除/復活承認/再修正」全フロー実行可。
- **非タスク (やってはいけない)**: 業務 hook 呼び出し変更、props 追加/削除、`ShiftPage.tsx` 変更。

### Team C: 動作検証 & ビジュアル整合
- **対象**: 全体 (実装後の検証)
- **タスク**:
  1. `pnpm build` (or `npm run build`) で型エラー / ビルドエラーなしを確認
  2. `pnpm dev` 起動 → `/shifts` 画面で 4 status 全パターンの操作を Playwright で確認
     - pending → 承認 / 却下 / 修正
     - approved → 修正 / 削除
     - rejected → 復活承認 / 削除
     - modified → 再修正 / 削除
     - 一括承認動作（影響なしの確認）
  3. SP viewport (375x667) で BottomSheet が立ち上がること
  4. PC viewport (1280x800) で Popover が右寄せで開くこと
  5. dark mode 切替で全 tone が破綻しないこと
  6. キーボード操作: Tab / Esc / Enter で開閉・選択可能なこと
  7. スクリーンショット 4 枚取得 (status 別 SP)
- **アウトプット**: 検証レポート (md) を `.company/engineering/reports/2026-04-28-l21-verify.md` に保存。

### 並列度
- A と B は ActionMenu のシグネチャ契約 (本書 3-1) で並列着手可能。B は当初 ActionMenu の薄い stub を import して書き上げ、A 完成後に差し替え (Engineer は同じ GLM セッション内で調整)。
- C は A+B 完了後の直列。
- **チーム D, E, F は本タスクでは未使用** (規模相応)。

---

## 6. Reviewer 観点 (集約レビュー: 1 名)

Reviewer は以下を 1 つずつチェックしレポートにまとめる:

### 6-1. 機能性
- [ ] props インターフェース (`ShiftAdminPanelProps`) が変更されていない (=`ShiftPage.tsx` 無傷)
- [ ] 既存の業務 hook (`onApprove/onReject/onModify/onBulkApprove/onDelete/onRefresh/canManageStore`) の呼び出しシグネチャに変更がない
- [ ] 4 status × プライマリ/セカンダリの分類が本書 1-2 表と一致
- [ ] 一括承認 / 並び替え / ページネーション / フィルタは無変更
- [ ] インライン 2 段階確認 (`confirmingId/deletingId`) のフロー保全

### 6-2. a11y
- [ ] ActionMenu トリガーに `aria-haspopup="menu"` + `aria-expanded` + `aria-controls` + `aria-label`
- [ ] menu に `role="menu"` 、item に `role="menuitem"`
- [ ] アイコンのみトリガーで `aria-hidden="true"` がアイコンに付与
- [ ] Escape で閉じる、トリガーへフォーカス復帰
- [ ] BottomSheet 経路の focus trap が機能 (既存)

### 6-3. UI / UX
- [ ] プライマリ + ActionMenu トリガー両方が `min-h-[44px]` 以上
- [ ] dark mode で全 tone (primary/success/danger/default) が破綻しない (text/bg/hover/border 各ペア)
- [ ] PC で Popover、SP で BottomSheet に切り替わる
- [ ] BottomSheet タイトルに「メンバー名 + 日付」が出てコンテキスト保持
- [ ] 修正中 / 権限なし時に ActionMenu が非表示

### 6-4. コード品質
- [ ] TypeScript strict 通過 (`pnpm tsc --noEmit` OK)
- [ ] Vite ビルド成功
- [ ] ESLint 警告ゼロ (新規追加コード)
- [ ] 不使用 import なし
- [ ] `ActionMenu` が他コンポーネントから再利用可能な汎用設計 (例: 将来 `ShiftPreferenceAdminList` 等にも転用可)

### 判定
- approve / 差戻し (差戻し時は対象 Team + 修正指示を明記)

---

## 7. 検証計画

### 7-1. 機械検証
| 項目 | コマンド | 合格条件 |
|---|---|---|
| 型 | `pnpm tsc --noEmit` | エラー 0 |
| ビルド | `pnpm build` | 成功 |
| Lint | `pnpm lint` (設定あれば) | 警告 0 (新規分) |

### 7-2. 手動 / Playwright
- viewport: 375x667 (SP) / 1280x800 (PC)
- 各 status (pending/approved/rejected/modified) のシフトを 1 件以上用意
- 操作:
  1. プライマリボタンクリック → 確認 → 確定 まで完走
  2. ActionMenu トリガークリック → メニュー表示 → セカンダリ item 選択 → 確認 → 確定
  3. SP では BottomSheet が下から立ち上がる
  4. PC では Popover が右下に立ち上がる
  5. Esc で閉じる
  6. dark mode 切替で破綻なし

### 7-3. 回帰
- 一括承認の動作確認 (本 PR で触れていない領域だが影響無を担保)
- 修正中の確定/取消フロー
- フィルタ (申請中/承認済/すべて) 切替後にアクションが正しく出る
- ページネーションを跨いだ操作

---

## 8. dual push 計画

L20 完了時と同じ運用 (記憶: dual push は subtree push):

```bash
# newWorld 側
cd /Users/usr0103301/Documents/個人仕事/newWorld
git add kintai .company
git commit -m "feat(kintai): L21 ShiftAdminPanel アクション集約 (ActionMenu 新設, Kebab 統合)"
git push origin master

# kintai 専用リポジトリへ subtree push
git subtree push --prefix=kintai kintai main
```

- Vercel Production (`shahu-kintai.vercel.app`) は kintai/main push で自動デプロイ。
- デプロイ後、Tech Lead が Production URL でスモーク確認 (`/shifts` 開いて pending カードのプライマリ + Kebab 表示確認 + 1 件操作)。

---

## 9. リスク & 緩和策

| リスク | 影響 | 緩和策 |
|---|---|---|
| Popover の outside click 検知ミスで閉じない | UX 劣化 | Reviewer チェックリストに含む。`useEffect` で `mousedown` listener を documenent 全域に。 |
| BottomSheet 多重展開 (既存使用箇所と競合) | body scroll lock 衝突 | 既存 BottomSheet が `body.style.overflow=''` リセット実装あり。同時オープンは UI 設計上発生しない (1 アクション = 1 シート)。 |
| GLM が Popover の z-index を低く出力 | メニューが他要素に隠れる | レビューチェック: `z-20` 以上。BottomSheet は `z-50` (既存)。 |
| プライマリ 44px 化で既存レイアウト崩れ | カード縦幅増加 | 許容 — L18+ の方針。フィルタタブやヘッダには影響なし。 |
| status の `cancelled` がメニュー対象漏れ | — | 元々 `displayedShifts` から除外済 (L67) なのでメニューも不要。 |

---

## 10. スコープ外 (本 L21 で扱わない)

- 一括承認の UI 改修 (既に集約済)
- 修正中フォームの再設計 (時刻 select 2 つ → time picker 等)
- 削除前の追加情報表示 (誰が何回承認したか等)
- L23 (dark ペア欠落スキャン) — ActionMenu 新規分のみ本タスクで担保、既存全体監査は L23 に委ねる
- L25 (a11y 改善) — ActionMenu / ShiftAdminPanel に閉じる範囲のみ本タスクで担保、全体監査は L25 に委ねる
- L26 (マイクロインタラクション) — `motion-safe:transition` の付与は最低限のみ、リッチなアニメは L26 に委ねる

---

## 11. 着手順序サマリ

1. Team A (ActionMenu + useMediaQuery 実装) → GLM 並列ジョブ 1
2. Team B (ShiftAdminPanel 改修, A の契約に従う) → GLM 並列ジョブ 2
3. Reviewer (集約) → 1 ジョブ
4. 修正があれば対象 Team へ差戻し → 再 Review
5. Tech Lead 統合承認 (git diff 検査)
6. Team C 検証 (Playwright + ビルド)
7. dual push (newWorld + kintai/main)
8. Vercel Production スモーク

以上。
