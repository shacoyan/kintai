# Loop 16 — STYLE.md 規約 vs 実装 乖離駆逐

- 起案: Tech Lead
- 日付: 2026-04-28
- 直近 SHA: newWorld 1c8e9e0 / kintai 10010b2
- 前提ループ: Loop 15（STYLE.md 162 行・9 セクション 制定）

---

## 1. 背景・スコープ

Loop 15 で kintai/STYLE.md を制定したが、Reviewer から `RoleManagementSection.tsx` に
`gray-*` クラスが 20 箇所超残存しているとの範囲外指摘あり。
Loop 16 では STYLE.md 全 9 セクションについて実装乖離を網羅的に検出し、駆逐する。

### 規約根拠（STYLE.md セクション → 検出カテゴリ対応）
- §2.1 グレースケール `slate/gray/zinc/stone-*` 禁止 → **L16-A**
- §3.1 dark: ペア必須 → **L16-B**
- §5.2 logger 第 2 引数 `formatSupabaseError` 必須 → **L16-C**
- §6.2 setSearchParams は URLSearchParams 複製必須 → **L16-D**
- §7.1 Playwright セレクタ優先順位 → **L16-E**
- §2.2 セマンティックカラー（`blue-*` 直接禁止 / プライマリは `primary-*`） → **L16-A 派生**

---

## 2. 事前調査結果

### 2.1 件数サマリ

| カテゴリ | 規約 | 検出件数 | 実違反件数 | 判定 |
|---|---|---|---|---|
| L16-A | gray/slate/zinc/stone-* 全廃 | 50 行 / 5 ファイル | **50** | 今 Loop で駆逐 |
| L16-A' | blue-* / yellow-* 等 直接色 | A と同ファイル | **8 推定** | A に内包 |
| L16-B | dark: ペア欠損（gray 以外で） | 1 行 | **1** | A に内包 |
| L16-C | logger 第 2 引数違反 | 7 行 (grep ヒット) | **0** | スキップ（全件 `formatted` 変数化済で規約準拠） |
| L16-D | URL クエリ複製違反 | 2 行 (grep ヒット) | **0** | スキップ（両者規約準拠 + 警告コメント有） |
| L16-E | E2E `locator(css)` 乱用 | 2 行 | **0** | スキップ（`page.locator('html')` は role/text 不可。最終手段として妥当） |

→ **Loop 16 の実作業は L16-A（+ A' / B 内包）のみ。** B〜E は規約遵守済み。

### 2.2 L16-A 対象ファイル詳細

| # | ファイル | gray件数 | 派生課題 |
|---|---|---|---|
| 1 | `src/components/Admin/RoleManagementSection.tsx` | 21 | `text-blue-600` / `text-red-600` / `text-red-500` のセマンティック検証 |
| 2 | `src/components/Admin/InviteCodeSettingsSection.tsx` | 13 | なし（primary-* 既使用、整合済） |
| 3 | `src/components/Admin/OwnerTransferSection.tsx` | 9 | **`bg-blue-600` / `focus:ring-blue-500` 直接色 → `primary-*` 置換要** / `disabled:bg-gray-300` の dark ペア欠損 |
| 4 | `src/components/Admin/TenantNameEditSection.tsx` | 6 | **`focus:ring-blue-500` / `focus:border-blue-500` → `primary-*`** |
| 5 | `src/components/Admin/TenantDeleteSection.tsx` | 1 | **`text-gray-600` 単独（dark ペア欠損）→ `text-neutral-600 dark:text-neutral-400`** |

合計: **50 件 + 派生 ~8 件 = 58 箇所**

### 2.3 機械置換テーブル（dark ペア有のケース）

`gray-*` → `neutral-*` の 1:1 置換で済むケース（既に dark ペア付き）:

| from | to |
|---|---|
| `text-gray-900` | `text-neutral-900` |
| `text-gray-800` | `text-neutral-900` (※) |
| `text-gray-700` | `text-neutral-700` |
| `text-gray-600` | `text-neutral-600` |
| `text-gray-500` | `text-neutral-500` |
| `text-gray-400` | `text-neutral-400` |
| `text-gray-300` | `text-neutral-300` |
| `bg-gray-50` | `bg-neutral-50` |
| `bg-gray-100` | `bg-neutral-100` |
| `bg-gray-200` | `bg-neutral-200` |
| `bg-gray-300` | `bg-neutral-300` |
| `border-gray-300` | `border-neutral-300` |
| `hover:bg-gray-50` | `hover:bg-neutral-50` |
| `hover:bg-gray-200` | `hover:bg-neutral-200` |
| `disabled:bg-gray-300` | `disabled:bg-neutral-300` |

※ 厳密には `gray-800` は `neutral-800` だが、対象箇所はすべて見出しテキスト用途で
   STYLE.md §3.2 の推奨マッピング上 `text-neutral-900 dark:text-neutral-100` が正解。
   既に該当箇所は `dark:text-neutral-100` ペア確定済 → light 側を `neutral-900` に揃える。

---

## 3. タスク分割

### 3.1 並列方針
**3 並列・1 Phase で完結。** 5 ファイルだが独立性が高く、ファイル単位で割り当てる。

| Engineer | 担当ファイル | 件数 | 派生課題 |
|---|---|---|---|
| **A** | `RoleManagementSection.tsx` | 21 | セマンティック色（blue/red の使い分け）検証 |
| **B** | `InviteCodeSettingsSection.tsx` + `TenantDeleteSection.tsx` | 13 + 1 | dark ペア欠損 1 件追加 |
| **C** | `OwnerTransferSection.tsx` + `TenantNameEditSection.tsx` | 9 + 6 | **blue-* → primary-* 置換** / disabled の dark ペア追加 |

依存なし。3 名同時起動可能。

### 3.2 Phase 構成
- Phase 1（今 Loop 完結）: A/B/C 並列実行
- Reviewer: 1 名集約（最後に grep 0 件 + ビルド OK + 視覚 diff 確認）
- Tech Lead 統合 + 承認 + dual push

---

## 4. 各タスク詳細

### L16-A1（Engineer A）: RoleManagementSection.tsx

- 対象: `src/components/Admin/RoleManagementSection.tsx`（21 件）
- 対象行（事前調査済み）:
  111, 129, 141, 142, 152, 155, 172, 175, 178, 184, 185, 186, 187, 188, 189,
  211, 215, 219, 223, 230, 248
- 修正方針:
  1. `gray-` → `neutral-` 機械置換（テーブル §2.3 準拠）
  2. **そのまま残すもの**:
     - `hover:text-blue-600` / `hover:text-red-600`（編集/削除のセマンティック色 → 維持。STYLE.md §2.2 で `red-*` は許容、`blue-*` は要 primary 化検討だが**ホバー時のアクション色として今ループは維持**）
     - `text-red-500`（必須マーク `*` → 維持。`danger-*` は将来検討）
- 推奨手段: **GLM に sed 一括置換指示** → 検証は grep 0 件確認
- 成功基準:
  - `grep -E "(text\|bg\|border\|ring\|divide\|hover:bg\|hover:text)-(gray\|slate)-[0-9]+" src/components/Admin/RoleManagementSection.tsx` → 0 件
  - ビルド成功
  - dark ペア破壊なし（既存ペアそのまま）
- 注意点:
  - **141 行 `border-b hover:bg-gray-50 dark:hover:bg-neutral-800`** の `border-b` は色未指定のままでも OK（Tailwind の `border-b` だけなら `border-color` は CSS のデフォルト継承）。ただし STYLE.md §3.2 上は `border-neutral-200 dark:border-neutral-700` 明示推奨。**今ループでは触らず**、Loop 17 候補に。
  - 152, 155, 175, 178 行の `hover:text-blue-600` / `hover:text-red-600` は **触らない**（アクション色）

### L16-A2（Engineer B）: InviteCodeSettingsSection.tsx + TenantDeleteSection.tsx

- 対象 1: `src/components/Admin/InviteCodeSettingsSection.tsx`（13 件）
  - 対象行: 62, 65, 89, 95, 101, 106, 112, 122, 129, 148, 155, 183, 189
  - 全件 dark ペア有・機械置換のみ
  - 183 行: `disabled:bg-gray-300 dark:disabled:bg-neutral-600` → `disabled:bg-neutral-300 dark:disabled:bg-neutral-600`
  - **`bg-primary-600` 等は既に primary 化済み** → 触らない

- 対象 2: `src/components/Admin/TenantDeleteSection.tsx`（1 件 + dark ペア追加）
  - 49 行: `text-sm text-gray-600 mb-6 leading-relaxed`
    → `text-sm text-neutral-600 dark:text-neutral-400 mb-6 leading-relaxed`
  - **dark ペア追加が必要な唯一の箇所**

- 推奨手段: GLM 指示で 1 ファイルずつ
- 成功基準: 両ファイルで `gray-` 0 件 + dark ペア完備 + ビルド OK

### L16-A3（Engineer C）: OwnerTransferSection.tsx + TenantNameEditSection.tsx

- 対象 1: `src/components/Admin/OwnerTransferSection.tsx`（9 件 + セマンティック違反）
  - gray 機械置換: 28, 29, 68, 86, 89, 92, 97, 105, 121
  - **追加修正（STYLE.md §2.2 違反）**:
    - 105 行 `focus:ring-blue-500 focus:border-blue-500` → `focus:ring-primary-500 focus:border-primary-500`
    - 121 行 `bg-blue-600 ... hover:bg-blue-700 ... focus:ring-blue-500`
      → `bg-primary-600 ... hover:bg-primary-700 ... focus:ring-primary-500`
    - 121 行 `disabled:bg-gray-300 disabled:cursor-not-allowed`
      → `disabled:bg-neutral-300 dark:disabled:bg-neutral-600 disabled:cursor-not-allowed` （**dark ペア追加**）
    - 68 行 `bg-gray-100 dark:bg-neutral-800 ... hover:bg-gray-200 dark:hover:bg-neutral-700`
      → `bg-neutral-100 dark:bg-neutral-800 ... hover:bg-neutral-200 dark:hover:bg-neutral-700`

- 対象 2: `src/components/Admin/TenantNameEditSection.tsx`（6 件 + セマンティック違反）
  - gray 機械置換: 28, 31, 55, 61, 70, 73
  - **追加修正**:
    - 70 行 `focus:ring-blue-500 focus:border-blue-500` → `focus:ring-primary-500 focus:border-primary-500`
    - 70 行 `border-gray-300 dark:border-neutral-600` → `border-neutral-300 dark:border-neutral-600`

- 成功基準:
  - 両ファイルで `gray-` / `blue-` (focus/bg/hover/ring) 0 件
  - dark ペア完備
  - 視覚: primary カラーが正しく出る（Tailwind config で `primary` 拡張済を前提。下記 §4.4 で確認）

### 4.4 事前確認事項（Engineer 起動前 Tech Lead 確認）

`tailwind.config.{js,ts}` で `primary` カラーが定義されているか確認すること。
未定義なら `bg-primary-600` 置換は未定義クラスになる → ビルドは通るが色が出ない。
→ 既存の InviteCodeSettingsSection.tsx 183 行で `bg-primary-600` 使用中 = 定義済の高い蓋然性あり。
ただし Engineer C 起動前に grep で確認: `grep -E "primary:" tailwind.config.*`

---

## 5. 競合リスク・統合時の注意点

- 3 ファイル群（A/B/C）は完全独立。同一ファイルを複数 Engineer が触らない設計。
- TenantDeleteSection.tsx は B が単独所有（C と分離）。
- マージ競合なし。

### Phase 1 sed 巻き込み事故の教訓
- sed の正規表現で `dark:bg-neutral-800` の `neutral` 部分が意図せず `gray` 由来でなくても巻き込まれる事故防止のため、
  **sed パターンは必ず `gray-` をリテラル接頭で固定**:
  ```
  sed -i '' -E 's/\b(text|bg|border|hover:bg|hover:text|focus:bg|focus:ring|focus:border|disabled:bg|ring|divide|placeholder)-gray-([0-9]+)/\1-neutral-\2/g' <file>
  ```
- `slate-` も同パターンで安全のため適用（今回 0 件だが保険）
- **macOS BSD sed は `-i ''` 必須**（GNU sed と異なる）
- 機械置換後に必ず `git diff --stat` と該当ファイルの diff を目視 → 想定外箇所が変わっていないか確認

---

## 6. Reviewer 観点（集約 1 名）

1. **完全性**: 全 3 ファイル群で `grep -E "(text|bg|border|hover:|focus:|disabled:|ring|divide|placeholder)-(gray|slate|zinc|stone)-[0-9]+" src/components/Admin/*.tsx` → **0 件**
2. **dark ペア**: TenantDeleteSection.tsx 49 行 + OwnerTransferSection.tsx 121 行 disabled に dark ペア付与確認
3. **セマンティック**: OwnerTransferSection.tsx + TenantNameEditSection.tsx で `bg-blue-`/`focus:ring-blue-`/`focus:border-blue-` が **0 件**（hover アクション色は対象外なので RoleManagement の `hover:text-blue-600` は OK）
4. **ビルド**: `npm run build` 成功
5. **型チェック**: `npx tsc --noEmit` 成功
6. **視覚回帰**: `npm run dev` 起動 → 5 画面（5 セクション）の light/dark 両方を目視。primary カラーが青系で出ること
7. **退行なし**: `git diff` で行数バランス確認（追加 dark クラス分以外、行数変化は最小）

---

## 7. dual push 計画

1. Tech Lead 承認後、newWorld リポジトリでコミット
   - メッセージ: `style(kintai): Loop 16 — STYLE.md 規約準拠 / Admin Section の gray-* 駆逐 + primary 化`
2. `git push origin master`（newWorld）
3. **subtree push**: `git subtree push --prefix=kintai kintai main`
4. push 失敗時は `git subtree split` → `git push kintai <SHA>:main` のフォールバック

---

## 8. 工数見積もり

- Engineer 並列実行: 約 10 分
- Reviewer 集約: 約 8 分
- Tech Lead 統合 + 承認 + dual push: 約 7 分
- **合計: 約 25 分（1 ラウンド完結）**

---

## 9. Loop 17 以降の候補（今ループでは触らない）

1. RoleManagementSection.tsx の `hover:text-blue-600` を `hover:text-primary-600` に統一するか議論
   （セマンティック色 vs プライマリ色の境界整理）
2. STYLE.md §9 拡張スロットの埋め込み（フォーム規約 / エラーハンドリング規約 等）
3. テーブル `border-b` 単独使用箇所に `border-neutral-200 dark:border-neutral-700` 明示
4. STYLE.md 自動検証 lint（ESLint プラグイン or 簡易スクリプト）の導入検討

---

## 10. サマリ

- **L16-A のみ実施**（B〜E は調査の結果、規約遵守済み）
- 5 ファイル / 58 箇所 / 3 並列 / 1 Phase / 約 25 分
- gray-* 全駆逐 + dark ペア欠損 1 箇所修復 + blue-* セマンティック違反 ~6 箇所を primary-* 化
- Reviewer は grep + ビルド + 型 + 視覚で承認判定
