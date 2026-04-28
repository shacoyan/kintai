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
