# kintai Loop 15 — 品質横展開・テスト基盤強化・スタイルガイド常設化

- 起票日: 2026-04-28
- Tech Lead: 💻
- 対象リポジトリ: `/Users/usr0103301/Documents/個人仕事/newWorld/kintai`
- 関連: Loop 11b〜14 + L14.5/L14.6 (完了済)
- 参考既存ドキュメント: `kintai/.company/engineering/docs/2026-04-25-kintai-loop5-caption-weekday.md`, `2026-04-26-kintai-multi-store-loop-b.md`, `2026-04-28-kintai-loop14.6-realtime-shield.md`

---

## 0. サマリ

Loop 14 + L14.5/L14.6 で確立した規律 (neutral 基調 / dark: prefix セット必須 / URL クエリ merge / Realtime Shield) を kintai 全体に行き渡らせ、テスト基盤を Sentry 導入前にもう一段強化する。さらに Loop 11b〜14 の決定事項を `kintai/STYLE.md` 1 ファイルに集約し、新規 Engineer 着任時に再発見コストをゼロにする。

### Phase 構成

| Phase | 主旨 | 並列度 | 工数感 |
|---|---|---|---|
| Phase 1 | 品質横展開（機械的） | A〜D の 4 並列 | 各 5〜15 分 |
| Phase 2 | テスト基盤強化 | A〜C の 3 並列 | 各 10〜20 分 |
| Phase 3 | スタイルガイド常設化 | A・B の 2 並列 | 各 20〜30 分 |

Phase 1 → Phase 2 → Phase 3 の順で直列実行（前 Phase の成果を後 Phase が参照するため）。各 Phase 内は完全並列・依存なし・ファイル衝突なし。

### 事前調査で判明した重要事項（指示文との差分）

⚠️ Tech Lead 調査の結果、ユーザー指示と実態に以下の乖離があった。各タスクで補正済み:

| 項目 | 指示文 | 実態 | 補正 |
|---|---|---|---|
| L15-1 logger 引数 | `.message` / `String(err)` を `err` に統一 | grep 0 件。既に全 44 箇所が `formatSupabaseError(err)` または生 `err`。例外は `useAttendanceViewer.ts:70` のみ生 PostgrestError | スコープを「`formatSupabaseError(err)` で統一する規律徹底」に変更し、唯一の異物を整える |
| L15-2 AdminPage 横展開 | `AdminPage.tsx` の `setSearchParams` を merge 化 | `AdminPage.tsx` に `setSearchParams` 呼び出しが**存在しない**（`AdminDashboard.tsx` も `useSearchParams` を読み取り専用で使用、書き込み無し） | タスクを「`setSearchParams` を使う既存3箇所(`ShiftPage.tsx:87`, `HistoryPage.tsx:280`, [新規対象なし])の merge パターンが守られているか再点検 + ESLint コメント追加で再発防止」に変更 |
| L15-3 黄色アラート dark | `OwnerTransferSection.tsx:136` + 他の amber/yellow 一括 | yellow 系は同行のみ。amber 系は `bg-amber-50 dark:bg-amber-900/30` 等で **既に dark 補完済み** が大半 | スコープ縮小: `OwnerTransferSection.tsx:136` の `bg-yellow-50` + `border-yellow-400` のみ (dark prefix 欠落) |
| L15-4 dark:slate 残存 13 件 | `dark:slate-` を grep | `dark:slate-` 系: 8 件 / **裸の `slate-` (dark prefix 無し)**: 多数 (`text-slate-400` 等のアイコン色) | スコープ拡張: `slate-` 全般を `neutral-` に統一。アイコン色の裸 slate-400 も含める |

---

## Phase 1 — 品質横展開（4 並列）

### Engineer A: L15-1 logger 引数の規律徹底（FriendlyError 統一）

**目的**: `logger.error` の第2引数を `formatSupabaseError(err)` (= `FriendlyError` オブジェクト) に統一する。Loop 11 で確立した規律。

**現状**: `kintai/src` 全 44 箇所中 43 箇所は `formatSupabaseError(err)` を渡している。1 箇所のみ生 PostgrestError を渡しており異物。

**対象ファイル**: `kintai/src/hooks/useAttendanceViewer.ts`

**変更内容**:
- L70 `logger.error('Fetch viewer records error:', error);` → `logger.error('Fetch viewer records error:', formatSupabaseError(error));`
- ファイル先頭の import に `import { formatSupabaseError } from '../lib/errors';` を追加（未 import の場合）

**期待差分**: 1 ファイル / 2 行（import 1 + 呼び出し 1）

**期待動作**: 既存挙動と同一（log 出力フォーマットが他 43 箇所と揃うのみ）。型エラーが出ないこと。

**検証コマンド**:
```bash
cd /Users/usr0103301/Documents/個人仕事/newWorld/kintai
npx tsc --noEmit
# 異物が再発していないことの確認:
rg "logger\.error\([^)]+, (?!formatSupabaseError)" src --pcre2 | rg -v "formatSupabaseError|formatted"
```

---

### Engineer B: L15-2 URL クエリ merge パターンの再点検 + 規律コメント

**目的**: Loop 14 Phase 2 L14-6 で確立した「`setSearchParams(next, { replace: true })` 前に既存 `searchParams` を `new URLSearchParams(searchParams)` で複製してから set する」パターンを、新規実装時に守らせる仕組みを入れる。

**現状調査結果**: `setSearchParams` を呼び出すのは以下 2 箇所のみ。両方とも merge パターンを既に採用済み。
- `kintai/src/pages/ShiftPage.tsx:82-89` (L82 から L89 の useEffect)
- `kintai/src/pages/HistoryPage.tsx:275-282` (L275 から L282 の useEffect)

`AdminPage.tsx` には `useSearchParams` も `setSearchParams` も存在しない。`AdminDashboard.tsx:78` は `const [searchParams] = useSearchParams();` の read-only 利用のみで書き込み無し。

**対象ファイル**:
1. `kintai/src/pages/ShiftPage.tsx` (L82 直前)
2. `kintai/src/pages/HistoryPage.tsx` (L275 直前)

**変更内容**: 両 useEffect の直前に同一のコメントブロックを追加。

```ts
  // URL クエリ merge 規律 (Loop 14 L14-6 / Loop 15 L15-2):
  // - setSearchParams 呼び出し前に必ず new URLSearchParams(searchParams) で複製してから set する。
  // - 直接オブジェクトリテラル {date: ym} を渡すと他クエリ (例: tab=, store=) を消失させる。
  // - 新規実装時はこのパターンに従うこと。
```

**期待差分**: 2 ファイル / 各 4 行追加

**期待動作**: 実装変更なし。コメントのみ。tsc / eslint パス。

**検証コマンド**:
```bash
cd /Users/usr0103301/Documents/個人仕事/newWorld/kintai
npx tsc --noEmit
# 規律違反パターンが無いことの再確認:
rg "setSearchParams\s*\(\s*\{" src
# (上記がヒットすれば違反。空であるべき)
```

---

### Engineer C: L15-3 黄色アラート dark 補完

**目的**: `OwnerTransferSection.tsx` の BottomSheet 内アラートが light/dark 両モードで読みやすいよう `dark:` prefix を補完。

**対象ファイル**: `kintai/src/components/Admin/OwnerTransferSection.tsx`

**変更内容**: L136 の class を以下に置換。

旧:
```tsx
<div className="p-4 text-sm text-gray-700 dark:text-neutral-200 bg-yellow-50 border-l-4 border-yellow-400">
```

新:
```tsx
<div className="p-4 text-sm text-neutral-700 dark:text-neutral-200 bg-amber-50 dark:bg-amber-900/30 border-l-4 border-amber-400 dark:border-amber-600">
```

**置換意図**:
- `text-gray-700` → `text-neutral-700` (パレット統一)
- `bg-yellow-50` → `bg-amber-50` + `dark:bg-amber-900/30` (Loop 14 で確立した警告系 amber パレット + dark 補完)
- `border-yellow-400` → `border-amber-400` + `dark:border-amber-600` (同上)

**期待差分**: 1 ファイル / 1 行 (class 文字列のみ)

**期待動作**: light モードでは黄色背景 + 黄色左ボーダー（既存と視覚的にほぼ同等）、dark モードでは琥珀色の半透明背景 + 暗い琥珀左ボーダーで本文がはっきり読める。

**検証コマンド**:
```bash
cd /Users/usr0103301/Documents/個人仕事/newWorld/kintai
npx tsc --noEmit
# yellow 系が完全に消えたことの確認:
rg "(bg-yellow|text-yellow|border-yellow)" src
# (空であるべき)
```

---

### Engineer D: L15-4 slate-* → neutral-* 統一（dark prefix 有無問わず）

**目的**: Loop 12 P3 で開始し Loop 14 で確立した「kintai は neutral がデフォ、slate は使わない」規律を全面適用。

**対象ファイル一覧** (調査済み 8 ファイル):

| # | ファイル | 該当行 | 含まれるトークン |
|---|---|---|---|
| 1 | `src/components/Store/StoreSelector.tsx` | L116, L133, L135, L137, L144, L160, L165 | `slate-50/100/200/300/400/500/700/800/900` (light + dark 混在) |
| 2 | `src/components/Leave/LeaveList.tsx` | L86 | `text-slate-400` (アイコン色) |
| 3 | `src/components/Admin/MemberManagement.tsx` | L231 | `text-slate-400` (アイコン色) |
| 4 | `src/components/Admin/StoreManagement.tsx` | L216 | `text-slate-400` (アイコン色) |
| 5 | `src/components/Admin/AttendanceAdmin.tsx` | L467 | `text-slate-400` (アイコン色) |
| 6 | `src/components/Attendance/MonthlySummary.tsx` | L52 | `dark:bg-slate-800` |
| 7 | `src/components/ui/EmptyState.tsx` | L17 | `text-slate-400 dark:text-slate-500` |
| 8 | `src/components/Attendance/BreakButton.tsx` | L56 | `bg-slate-600 hover:bg-slate-700 dark:bg-slate-500` |
| 9 | `src/components/Tenant/TenantSelector.tsx` | L56 | `text-slate-400` (アイコン色) |

合計 9 ファイル / 推定 14〜18 行 (StoreSelector が複数)。

**変換ルール (機械的置換)**:
- `slate-50` → `neutral-50`
- `slate-100` → `neutral-100`
- `slate-200` → `neutral-200`
- `slate-300` → `neutral-300`
- `slate-400` → `neutral-400`
- `slate-500` → `neutral-500`
- `slate-600` → `neutral-600`
- `slate-700` → `neutral-700`
- `slate-800` → `neutral-800`
- `slate-900` → `neutral-900`
- `bg-slate-XXX` / `text-slate-XXX` / `border-slate-XXX` / `hover:bg-slate-XXX` / `focus:bg-slate-XXX` / `dark:bg-slate-XXX` 等、**prefix の有無を問わず数値部分だけ slate → neutral に置換**

**注意事項**:
- StoreSelector.tsx は 7 行あるため確実に全置換すること
- 置換漏れチェックは grep で 0 件であることを確認
- アイコン色の `text-slate-400` も対象（指示の文字「dark:slate- だけ」ではなく、実態に合わせ全 slate を統一）

**期待差分**: 9 ファイル / 14〜18 行

**期待動作**: 視覚的にはほぼ同等（slate と neutral は色相がわずかに異なる: slate=青寄り / neutral=純グレー）。Loop 14 で他コンポーネントが既に neutral 化されているため、kintai 全体のグレー味が neutral に一本化される。

**検証コマンド**:
```bash
cd /Users/usr0103301/Documents/個人仕事/newWorld/kintai
npx tsc --noEmit
# slate 残存ゼロを確認:
rg "slate-" src
# (空であるべき)
```

---

### Phase 1 統合時の注意点

- 全 4 タスクは編集ファイルが完全に独立しており衝突しない:
  - A: `useAttendanceViewer.ts`
  - B: `ShiftPage.tsx` + `HistoryPage.tsx`
  - C: `OwnerTransferSection.tsx`
  - D: `StoreSelector.tsx` + `LeaveList.tsx` + `MemberManagement.tsx` + `StoreManagement.tsx` + `AttendanceAdmin.tsx` + `MonthlySummary.tsx` + `EmptyState.tsx` + `BreakButton.tsx` + `TenantSelector.tsx`
- 統合後に `npx tsc --noEmit` と `rg "slate-|bg-yellow|text-yellow|border-yellow" src` を実行し全て 0 件であることを最終確認
- Phase 1 完了後に Phase 2 へ進む

---

## Phase 2 — テスト基盤強化（3 並列）

### Engineer A: L15-5 テーマ切替 E2E 本実装

**目的**: Loop 13 で skip にしたテーマ切替テストを本実装。`ThemeToggle` (実体: `TopBar` 内のボタン, aria-label = `テーマ切替（現在: …）`) クリック → `html` 要素の `class` 変化を検証。

**対象ファイル**: `kintai/e2e/smoke.spec.ts`

**現状**:
```ts
test.skip('テーマ切替ボタンが存在する', async ({ page }) => {
  await page.goto('/login');
  expect(true).toBe(true);
});
```

**新実装方針**:

```ts
test('テーマ切替ボタンが light → dark を切り替える', async ({ page }) => {
  // localStorage seed で初期テーマを 'light' に固定
  await page.addInitScript(() => {
    localStorage.setItem('kintai_theme', 'light');
  });
  await page.goto('/login');

  // 初期状態: html に 'dark' class が無い
  await expect(page.locator('html')).not.toHaveClass(/dark/);

  // テーマ切替ボタン (aria-label が「テーマ切替」で始まる) をクリック
  // 初期 light → 次は dark
  const themeButton = page.getByRole('button', { name: /テーマ切替.*クリックで\s*ダーク/ });
  await expect(themeButton).toBeVisible();
  await themeButton.click();

  // dark class が付与されたことを検証
  await expect(page.locator('html')).toHaveClass(/dark/);
});
```

**設計上のポイント**:
- `localStorage.setItem('kintai_theme', 'light')` は `ThemeContext.tsx:15` の初期値読み取りキーと一致
- `aria-label` は `テーマ切替（現在: ライト / クリックで ダーク）` のような動的文字列のため正規表現でマッチ
- `html.classList.contains('dark')` は `ThemeContext.tsx:29` の `root.classList.toggle('dark', dark)` で制御される
- ログイン画面 (`/login`) で TopBar が表示されるかは要確認: もし TopBar が認証後のみ表示なら、別ルート (例: `/`) もしくは `LoginPage` 内のテーマトグルを探す必要あり

**追加調査タスク (Engineer A 実施)**:
1. `LoginPage.tsx` を読み、`/login` 画面に TopBar (またはテーマトグルボタン) が表示されるか確認
2. 表示されない場合は次のいずれか:
   - (a) テスト画面を `/login` 以外 (例: 公開トップページ) に変更
   - (b) `LoginPage` にテーマトグルが無いなら、テストを `test.skip` のまま `// TODO(Loop 16): 認証後画面で再実装` コメントを残し、代わりに `addInitScript` で `localStorage.setItem('kintai_theme', 'dark')` してから `/login` を開いて `html` に `dark` class があることだけ検証する **静的版** を実装

**期待差分**: 1 ファイル / 15〜25 行

**検証コマンド**:
```bash
cd /Users/usr0103301/Documents/個人仕事/newWorld/kintai
npm run dev &  # 別ターミナル想定
sleep 5
npx playwright test e2e/smoke.spec.ts
```

CI では `npm run build && npm run preview` ベースで動かすが、本タスクではローカルで dev サーバー + Playwright が green ならOK。

---

### Engineer B: L15-6 Playwright CI 設定正式化

**目的**: Loop 14 Phase 2 で一旦 revert した CI 安定化設定を、Loop 14.6 まで完了した今のタイミングで正式に投入。

**対象ファイル**: `kintai/playwright.config.ts`

**現状**:
```ts
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: { ... },
  projects: [...],
  webServer: { ... },
});
```

**変更内容**: `defineConfig` 引数オブジェクトに以下 4 行を追加 (場所: `testDir` の直下、`timeout` の上)。

```ts
  fullyParallel: !!process.env.CI,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
```

**理由**:
- `fullyParallel`: CI のみ並列実行（ローカルは webServer 共有のため直列）
- `forbidOnly`: CI で `test.only` 残置を防止
- `retries: 2`: ネットワーク等の flake を吸収
- `workers: 1` (CI): webServer と Supabase 共有を考慮した安全側
- ローカル (`!CI`) では `workers: undefined` で Playwright デフォルトに任せる

**期待差分**: 1 ファイル / 4 行追加

**検証コマンド**:
```bash
cd /Users/usr0103301/Documents/個人仕事/newWorld/kintai
npx tsc --noEmit -p tsconfig.json  # playwright.config.ts は別 tsconfig かもしれない
node -e "require('./playwright.config.ts')" 2>&1 || true  # 構文チェック
# CI 環境変数を疑似的に設定して dry-run:
CI=1 npx playwright test --list e2e/smoke.spec.ts | head
```

---

### Engineer C: L15-7 smoke.spec.ts セレクタ規約整備 + 違反点検

**目的**: Phase 3 で文書化する「セレクタ規約」を smoke.spec.ts 自体が体現するよう違反を整える + 規約コメントをファイル冒頭に置く。

**対象ファイル**: `kintai/e2e/smoke.spec.ts`

**現状調査**:
- L6: `page.getByRole('heading', { name: /ログイン/i })` ✅ 規約遵守 (heading = role)
- L7: `page.getByLabel(/メール/i)` ✅ 規約遵守 (フォーム入力 = label)
- L8: `page.getByLabel(/パスワード/i)` ✅ 規約遵守

→ 既存違反は **無い**。Engineer A が L15-5 で追加するテストも本規約に従うこと。

**変更内容**:

ファイル先頭 (`import` 直後) に規約コメントブロックを追加:

```ts
/**
 * kintai E2E セレクタ規約 (Loop 15 L15-7)
 * - フォーム入力: page.getByLabel(/ラベル/i)
 * - ボタン / リンク / heading: page.getByRole('button|link|heading', { name: /…/ })
 * - エラーメッセージ等の本文: page.getByText(/…/)
 * - 上記で取れない場合のみ data-testid を新規付与し getByTestId を使う
 * - locator(css) は最終手段。極力使わない。
 *
 * 詳細: kintai/STYLE.md §セレクタ規約
 */
```

Engineer A が追加するテーマ切替テストも本規約に従っていること（A 担当範囲のため B・C は手を加えない）。

**期待差分**: 1 ファイル / 11 行追加 (コメントのみ)

**競合注意**: Engineer A も同じ `smoke.spec.ts` を編集する。**Engineer A → Engineer C の順** で直列実行する。Engineer C は A の出力 (テーマ切替テスト追加済み) を base に編集すること。

または: A と C で編集箇所が完全に分離 (A = `test.skip` ブロックの置換 / C = ファイル先頭の import 直後にコメント追加) のため、Tech Lead が統合時に手動で merge してもよい。**並列度を最大化するため後者を採用**。Engineer C は「ファイル先頭 import 直後に上記コメントブロックを追加するパッチ」のみを生成し、テストブロックには触れない。

**検証コマンド**:
```bash
cd /Users/usr0103301/Documents/個人仕事/newWorld/kintai
npx tsc --noEmit -p tsconfig.json
```

---

### Phase 2 統合時の注意点

- A と C が同じ `smoke.spec.ts` を編集 → 編集箇所を分離: A = `test.skip` ブロック (L11-14)、C = ファイル先頭 (L1 直後)。Tech Lead 統合時に両方の差分を順に適用。
- B は `playwright.config.ts` 単独で衝突なし。
- 統合後 `npx tsc --noEmit` パス + `npx playwright test --list` がエラー無く列挙できることを確認。

---

## Phase 3 — スタイルガイド常設化（2 並列）

### Engineer A: L15-8 `kintai/STYLE.md` 新規作成

**目的**: Loop 11b〜14 で確立した規律を 1 ファイルに集約し、新規 Engineer/Reviewer が必ず最初に読む文書とする。

**対象ファイル**: `kintai/STYLE.md` (新規)

**構成 (章立て)**:

```markdown
# kintai スタイルガイド

最終更新: 2026-04-28 (Loop 15 L15-8)
対象: kintai リポジトリの React + Tailwind コード全般

## 1. カラーパレット

### 1.1 デフォルトはneutral
- グレー系トークンは neutral を使う。slate は使わない (Loop 12 P3 / Loop 14 / Loop 15 で全面 neutral 化済み)
- 背景: bg-white (light) / dark:bg-neutral-900 or dark:bg-neutral-800
- 文字: text-neutral-900 (light) / dark:text-neutral-100
- 枠線: border-neutral-200 (light) / dark:border-neutral-700
- アイコン補助色: text-neutral-400 ~ 500

### 1.2 アクセント
- primary (青系): プライマリアクション (送信ボタン等)
- info (薄い青): バッジ・補助情報
- success (緑): 完了・承認
- warning (amber): 注意 (黄色 yellow は使わない。Loop 15 L15-3 で amber 統一)
- danger (rose / red): 削除・拒否

### 1.3 旧パレット → 新トークン マッピング表

| 旧 (Loop 11b 以前) | 新 (Loop 14〜15) | 用途 |
|---|---|---|
| `bg-gray-100` | `bg-neutral-100` | 補助背景 |
| `text-gray-700` | `text-neutral-700` | 本文 |
| `bg-slate-50` | `bg-neutral-50` | 薄い背景 |
| `bg-slate-100` | `bg-neutral-100` | hover 背景 |
| `bg-slate-800` | `bg-neutral-800` | dark 背景 |
| `text-slate-400` | `text-neutral-400` | アイコン |
| `text-slate-500` | `text-neutral-500` | 補助文字 |
| `border-slate-200` | `border-neutral-200` | 通常枠線 |
| `border-slate-700` | `border-neutral-700` | dark 枠線 |
| `bg-yellow-50` | `bg-amber-50 dark:bg-amber-900/30` | 警告背景 |
| `border-yellow-400` | `border-amber-400 dark:border-amber-600` | 警告ボーダー |
| `text-yellow-700` | `text-amber-700 dark:text-amber-300` | 警告文字 |
| `bg-blue-100` | `bg-info-100` または primary-* (用途次第) | バッジ |
| `text-red-600` | `text-danger-600` または `text-rose-600` | エラー |
| `bg-green-50` | `bg-success-50` | 成功背景 |

(15 種程度を網羅)

## 2. dark: prefix 規律

### 2.1 セット必須
背景・文字・枠線のいずれかに `bg-` `text-` `border-` 系を書いた時、**同じ要素に dark: 対応 class を必ず追加**する。

OK:
```html
<div class="bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
```

NG:
```html
<div class="bg-white text-neutral-900">  <!-- dark で背景白のまま破綻 -->
```

### 2.2 例外 (dark 不要パターン)
- `bg-transparent` / `text-inherit` 系 → dark 不要
- アイコン補助色 `text-neutral-400` → 両モードで読める場合は dark 省略可だが付けるのが望ましい
- ブランド固定色 (例: ロゴ色) → 意図的に固定する旨をコメントで明記

### 2.3 ペア早見表
| light | dark |
|---|---|
| `bg-white` | `dark:bg-neutral-900` |
| `bg-neutral-50` | `dark:bg-neutral-900` |
| `bg-neutral-100` | `dark:bg-neutral-800` |
| `text-neutral-900` | `dark:text-neutral-100` |
| `text-neutral-700` | `dark:text-neutral-200` |
| `text-neutral-500` | `dark:text-neutral-400` |
| `border-neutral-200` | `dark:border-neutral-700` |
| `bg-amber-50` | `dark:bg-amber-900/30` |
| `text-amber-700` | `dark:text-amber-300` |

## 3. logger 規約

### 3.1 4 レベル
- `logger.debug(msg, ctx?)` — 開発時のみ console.debug。本番黙殺
- `logger.info(msg, ctx?)` — 開発時のみ console.info
- `logger.warn(msg, ctx?)` — 常時 console.warn
- `logger.error(msg, errOrCtx?)` — 常時 console.error。将来 Sentry forward

### 3.2 第2引数の規約
- catch 句では **必ず `formatSupabaseError(err)` でラップしてから渡す** (FriendlyError オブジェクト = `{ message, code, original }`)
- 生 `err.message` や `String(err)` は禁止
- 例外: PostgrestError の `error` 変数 (Supabase クライアントから直接受けた場合) も `formatSupabaseError(error)` でラップ

OK:
```ts
} catch (err) {
  logger.error('fetchFoo error:', formatSupabaseError(err));
}
```

NG:
```ts
} catch (err) {
  logger.error('fetchFoo error:', err.message);  // string 化されて code 情報が失われる
  logger.error('fetchFoo error:', String(err));  // 同上
}
```

## 4. URL クエリ規律 (Loop 14 L14-6 / Loop 15 L15-2)

`setSearchParams` を呼ぶ前に必ず既存 `searchParams` を複製してから set:

```ts
const next = new URLSearchParams(searchParams);
next.set('date', ym);
setSearchParams(next, { replace: true });
```

直接オブジェクトリテラル `setSearchParams({ date: ym })` を渡すと、`tab=` `store=` 等の他クエリが消失する。

## 5. セレクタ規約 (E2E / Playwright)

優先順位:
1. `getByLabel(/…/)` — フォーム入力
2. `getByRole('button|link|heading|alert', { name: /…/ })` — UI コントロール
3. `getByText(/…/)` — 本文・エラーメッセージ
4. `getByTestId(...)` — 上記で取れない場合のみ。`data-testid` を新規付与
5. `locator(css)` — 最終手段。極力使わない

## 6. アニメーション規律

### 6.1 motion-safe
全ての `transition-*` `animate-*` には `motion-safe:` prefix を付ける:
```html
<button class="motion-safe:transition-colors">
```

### 6.2 useReducedMotion フック
`src/hooks/useReducedMotion.ts` を提供済み。JS 側でアニメーションを制御する場合 (将来 framer-motion 導入時) に使う。L15-9 で適用候補を棚卸し済み。

## 7. その他規律

### 7.1 Realtime Shield (Loop 14.6)
Supabase Realtime チャンネル購読時は `kintai/src/lib/realtimeShield.ts` のラッパを使う。直接 `supabase.channel(...)` を呼ばない。

### 7.2 RLS / store_members.is_manager
- 権限判定は必ず `useTenant().myRole` を使う
- DB 直接クエリで is_manager を読む場合は store_id スコープ必須

### 7.3 dual push 規律
- newWorld リポジトリと kintai 専用リポジトリの両方に push する
- 方式: `git subtree push --prefix=kintai kintai main`

---
履歴:
- 2026-04-28: Loop 15 L15-8 で初版作成 (Loop 11b〜14 + L14.5/L14.6 規律集約)
```

**期待差分**: 1 ファイル新規 / 約 150〜200 行

**注意**: 上記は **Engineer A への構成案テンプレート**。Engineer A は本構成を踏襲して書く。具体的なマッピング数値は Loop 14 完了時点のリポジトリを実地調査して埋める。

**検証**: `cat kintai/STYLE.md | wc -l` が 100〜200 行範囲。markdown lint パス。

---

### Engineer B: L15-9 useReducedMotion 適用候補棚卸し（ドキュメントのみ）

**目的**: 現状 `framer-motion` 未導入だが、将来導入時に `useReducedMotion()` を適用すべきコンポーネントを設計書内に列挙し、Loop 16 以降の作業伏線を残す。

**対象**: 設計書 (本ファイル) の本セクションに調査結果を追記。実装変更なし。

**調査済み結果** (Tech Lead 実施: `transition` または `animate-` を使う 39 ファイル):

#### 7.1 framer-motion 導入時の useReducedMotion 適用候補

下記 39 ファイルが `transition-*` または `animate-*` を使用中。framer-motion 導入時には JS 側アニメーションへ移行することを検討:

**最優先 (motion-safe 必須 + 大きな動き)**:
- `src/components/ui/BottomSheet.tsx` (スライドアップ)
- `src/components/ui/Toast.tsx` (フェードイン・スライド)
- `src/components/Notification/NotificationBell.tsx` (バッジ・ドロップダウン)
- `src/components/Layout/Sidebar.tsx` (スライドイン)

**中優先 (hover/focus transition)**:
- `src/components/ui/Button.tsx`
- `src/components/ui/Input.tsx`
- `src/components/ui/Select.tsx`
- `src/components/ui/Textarea.tsx`
- `src/components/ui/Skeleton.tsx`
- `src/components/ui/Spinner.tsx`
- `src/components/Auth/LoginForm.tsx`
- `src/components/Tenant/CreateTenant.tsx`
- `src/components/Tenant/TenantSelector.tsx`
- `src/components/Tenant/TenantSwitcher.tsx`
- `src/components/Store/StoreSelector.tsx`
- `src/components/Attendance/ClockButton.tsx`
- `src/components/Attendance/BreakButton.tsx`
- `src/components/Attendance/DailyList.tsx`

**低優先 (transition のみ・アニメーションは軽微)**:
- 残り (Admin/Shift/Correction/Leave 系の各 panel・list・form 24 ファイル)

#### 7.2 framer-motion 導入時の方針 (Loop 16+ 想定)

1. CSS transition は残しつつ、**JS で制御するモーダル・トースト・サイドバーのみ** framer-motion 化
2. `<motion.div>` の `transition` prop に `useReducedMotion()` の戻り値を反映:
   ```ts
   const reduced = useReducedMotion();
   <motion.div animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.2 }}>
   ```
3. CSS の `motion-safe:` prefix は維持 (framer-motion 化しないコンポーネントの保険)

**Engineer B の作業内容**:
- 本設計書の §7.1 §7.2 セクションは Tech Lead が既に記入済み (上記)。Engineer B は **追加調査と精査**を行う:
  - 39 ファイルのうち、`transition-colors` のみ (色変化のみで動きが無い) のものを「補助」として分類
  - `animate-pulse` / `animate-spin` 等の Tailwind animate utility を使うファイルを別リストに分離
  - 結果を本設計書 §7.3 として追記

**期待差分**: 本設計書に §7.3 セクションを 30〜60 行追記。コードは1行も触らない。

**検証**: `wc -l 2026-04-28-kintai-loop15-techdesign.md` で行数増加を確認。

---

### Phase 3 統合時の注意点

- A は新規ファイル作成、B は本設計書追記のみ。完全独立・衝突なし。
- A の `STYLE.md` 完成後、`README.md` または `CONTRIBUTING.md` に「実装前に必ず STYLE.md を読む」リンクを追加するのは Loop 16 以降に回す（本ループのスコープ外）。

---

## 統合・最終承認チェックリスト

### Phase 1 (Reviewer)
- [ ] `useAttendanceViewer.ts:70` が `formatSupabaseError(error)` を渡している
- [ ] `useAttendanceViewer.ts` 冒頭に `formatSupabaseError` の import がある
- [ ] `ShiftPage.tsx` `HistoryPage.tsx` の useEffect 直前に L15-2 規律コメントがある
- [ ] `OwnerTransferSection.tsx:136` が `bg-amber-50 dark:bg-amber-900/30 border-l-4 border-amber-400 dark:border-amber-600` を使用
- [ ] `rg "(bg-yellow|text-yellow|border-yellow)" kintai/src` が 0 件
- [ ] `rg "slate-" kintai/src` が 0 件
- [ ] `npx tsc --noEmit` パス
- [ ] `npm run build` パス

### Phase 2 (Reviewer)
- [ ] `smoke.spec.ts` に新しいテーマ切替テストが追加され、`test.skip` ではなく `test` で記述
- [ ] テストが `localStorage.setItem('kintai_theme', 'light')` を seed
- [ ] テストが `html.classList.contains('dark')` 相当のアサート (`toHaveClass(/dark/)`) を持つ
- [ ] `playwright.config.ts` に 4 つの CI 設定 (`fullyParallel` / `forbidOnly` / `retries` / `workers`) が追加
- [ ] `smoke.spec.ts` 冒頭にセレクタ規約コメントブロックがある
- [ ] `npx tsc --noEmit` パス
- [ ] `npx playwright test --list` がエラー無く実行
- [ ] (可能なら) ローカル dev サーバー起動 + `npx playwright test e2e/smoke.spec.ts` で全 green

### Phase 3 (Reviewer)
- [ ] `kintai/STYLE.md` が新規作成され 100〜200 行範囲
- [ ] STYLE.md に 7 章 (カラーパレット / dark prefix / logger / URL クエリ / セレクタ / アニメーション / その他) が揃っている
- [ ] マッピング表が 12 行以上
- [ ] dark: ペア早見表が 9 行以上
- [ ] 本設計書 §7.3 が追記され、39 ファイルの分類が記載されている
- [ ] markdown 構文エラーなし

### 最終承認 (Tech Lead)
- [ ] 全 Phase の Reviewer チェックがパス
- [ ] `git diff --stat kintai/` で予想変更ファイル数 (Phase 1: 12 ファイル / Phase 2: 2 ファイル / Phase 3: 1 新規 + 1 追記) と一致
- [ ] `npx tsc --noEmit` + `npm run build` 最終パス
- [ ] dual push (newWorld + kintai/main) 準備完了

---

## Engineer 実行順序

1. **Phase 1**: A・B・C・D を完全並列で起動 → 全完了後 Reviewer 集約レビュー → 修正があれば修正サイクル → Tech Lead 統合
2. **Phase 2**: A・B・C を並列起動 (A と C は smoke.spec.ts の異なる箇所を編集) → Reviewer 集約 → 修正サイクル → Tech Lead 統合
3. **Phase 3**: A・B を並列起動 → Reviewer 集約 → 修正サイクル → Tech Lead 統合
4. 全 Phase 完了後、Tech Lead が最終承認 → dual push (newWorld commit + `git subtree push --prefix=kintai kintai main`)

---

## 付録: Engineer 向けサマリ指示文 (Phase 1 着手用)

### Phase 1 メイン指示文 (4 並列分配)

> Loop 15 Phase 1 を 4 並列で実行する。設計書: `kintai/.company/engineering/docs/2026-04-28-kintai-loop15-techdesign.md` の Phase 1 セクションを **必ず精読** してから着手すること。
>
> - **Engineer A**: §Phase 1 / Engineer A (L15-1) を実行。`kintai/src/hooks/useAttendanceViewer.ts` のみ編集。
> - **Engineer B**: §Phase 1 / Engineer B (L15-2) を実行。`kintai/src/pages/ShiftPage.tsx` と `kintai/src/pages/HistoryPage.tsx` のみ編集。コメント追加のみ。
> - **Engineer C**: §Phase 1 / Engineer C (L15-3) を実行。`kintai/src/components/Admin/OwnerTransferSection.tsx` の L136 1 行のみ編集。
> - **Engineer D**: §Phase 1 / Engineer D (L15-4) を実行。9 ファイル / 14〜18 行を `slate-` → `neutral-` に機械的置換。
>
> 各 Engineer は完了後 `npx tsc --noEmit` と該当 grep が 0 件であることを自己検証してから報告すること。コメントや過剰な改行追加はせず、設計書記載の差分のみを生成する。

(Phase 2 / Phase 3 のメイン指示文は当該 Phase 着手時に Tech Lead が同様に分配する)
