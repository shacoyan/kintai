# L17: preference_type 色マップ統一 — Tech Design

- **Date**: 2026-04-28
- **Author**: Tech Lead
- **Project**: kintai (shahu-kintai)
- **Loop**: L17 (UX 改善ループ第 17 弾)
- **Reviewer Origin**: Design Reviewer `a9ec917f08d79a01c`
- **Related**: STYLE.md（追記候補）, L23 (dark: ペア欠落スキャン), L25 (a11y), L26 (アイコン整理)

---

## 1. 背景・目的

### 1.1 現状の問題
シフト希望の `preference_type`（`preferred` / `available` / `unavailable`）が、画面ごとに **5 箇所** で **3 通り以上** の異なる色マッピングで実装されており、ユーザーに「同じ概念なのに色が違う」混乱を与えている。

特に致命的なのは:
- **同じ「希望」が画面 A では青系（primary）、画面 B ではオレンジ（warning）で表示される**
- **同じ「出勤可」が画面 A では水色（info）、画面 B では青（primary）、画面 C では緑（success）で表示される**
- **アイコンが Circle と CheckCircle2 のみで形状が酷似** → 色覚に依存しないと識別困難（WCAG 1.4.1 違反リスク）

### 1.2 ゴール
1. **単一ソース化** — `src/lib/preferenceTheme.ts` を新設し、全画面が import する
2. **業務ドメインに即した推奨マッピング** を Tech Lead 決定として明文化
3. **色覚配慮アイコン** — 形状で識別可能（Circle と CheckCircle2 の同居を解消）
4. **dark: バリアント完備** — L23 と整合
5. **将来的に確定シフト本体（status・leave_type 等）にも同パターンを流用できる構造**

### 1.3 非ゴール（本 Loop 対象外）
- `status`（pending/approved/rejected 等）の色マップは既に `STATUS_DOT_CLASS` で統一済 → 触らない
- `leave_type` の統一 → 別 Loop
- STYLE.md §4 の正式追記 → 本 Loop でドラフト追記、正式版は L20 / L26 と束ねる

---

## 2. 現状調査結果

### 2.1 5 箇所マッピング表（事前調査確定）

| # | ファイル | 行範囲 | 用途 | preferred | available | unavailable | アイコン |
|---|---|---|---|---|---|---|---|
| 1 | `src/components/Shift/ShiftPreferenceCalendar.tsx` | L28–50 | カレンダーセル基本スタイル `PREFERENCE_STYLE` | **primary**（bg-50 / ring-300 / text-700） | **info**（bg-50 / ring-500/40 / text-500） | **warning**（bg-50 / ring-500/40 / text-500） | CheckCircle2 / Circle / XCircle |
| 2 | `src/components/Shift/ShiftPreferenceSidebar.tsx` | L114–130 | admin 凡例 Card | **warning**（dot + icon-500） | **primary**（dot + icon-500） | **neutral-400** | CheckCircle2 / Circle / XCircle |
| 3 | `src/components/Shift/ShiftPreferenceSidebar.tsx` | L136–149 | admin サマリ数値 | **warning-600/400** | **info-600/400** | **neutral-500/400** | （数値のみ） |
| 4 | `src/components/Shift/ShiftPreferenceSidebar.tsx` | L228–249 | self サマリ数値 | **warning-500** | **primary-500** | **neutral-400** | （数値のみ） |
| 5 | `src/pages/ShiftPage.tsx` | L42–46 | 履歴リスト iconBox `PREF_LIST_STYLE` | **primary-50/700** + dark | **info-50/500** + dark | **warning-50/500** + dark | CheckCircle2 / Circle / XCircle |
| 6\* | `src/components/Shift/PreferenceActionRow.tsx` | L221, L258–272 | full variant のアイコン色 + ラベル | **primary-600/400** | **success-600/400** | **danger-600/400** | CheckCircle2 / Circle / XCircle |
| 7\* | `src/components/Shift/ShiftPreferenceForm.tsx` | L47–51 | フォーム選択肢 `PREF_CONFIGS` | アイコンのみ（CheckCircle2） | アイコンのみ（Circle） | アイコンのみ（XCircle） | 色なし（中立） |

\* 秘書指摘の 5 箇所に加え、調査で発見した 2 箇所（PreferenceActionRow / ShiftPreferenceForm）も同一ソース化の対象に含める。**実質 7 箇所**。

### 2.2 集計：preferred の色だけで何通り？

| 色トークン | 出現箇所 |
|---|---|
| primary | #1（cell）, #5（list iconBox）, #6（ActionRow text） |
| warning | #2（admin 凡例）, #3（admin サマリ）, #4（self サマリ） |

→ **同じ「希望」が primary と warning の 2 通り** で完全に分裂。最悪。

`available`:
| 色 | 箇所 |
|---|---|
| info | #1, #3, #5 |
| primary | #2, #4 |
| success | #6 |

→ **3 通り**

`unavailable`:
| 色 | 箇所 |
|---|---|
| warning | #1, #5 |
| neutral | #2, #3, #4 |
| danger | #6 |

→ **3 通り**

### 2.3 既存 `src/lib/` 構成（`ctx_tree` 確認済）
```
src/lib/
  cn.ts
  csv.ts
  errors.ts
  logger.ts
  supabase.ts
```
→ `preferenceTheme.ts` を追加しても規模・粒度的に妥当。

### 2.4 型定義（確定）
```ts
// src/types/index.ts
export type ShiftPreferenceType = 'available' | 'preferred' | 'unavailable';
```
→ 新規ファイルはこの型を import して使う。

### 2.5 Tailwind パレット（確認済）
`tailwind.config.*` に定義あり（`primary` / `neutral` / `success` / `warning` / `danger` / `info` の 6 系列、各 50–900）。dark: ペアは原則 50↔900/40 + 700↔300 が慣例。

---

## 3. 推奨マッピング（Tech Lead 決定）

### 3.1 業務ドメイン分析

| 概念 | 業務的意味 | UI 上の意味付け |
|---|---|---|
| `preferred`（希望） | スタッフが「ぜひこの日に入りたい」と積極希望 | **ポジティブ・主役・最も注目させる** |
| `available`（出勤可能） | 「入れと言われれば入れる」中立的可用性 | **OK・正常・落ち着いた肯定** |
| `unavailable`（出勤不可） | 「絶対無理」不可 | **ブロック・否定・注意喚起（ただし違反ではない）** |

### 3.2 採択マッピング（決定）

| type | 色 | 根拠 |
|---|---|---|
| `preferred` | **primary** | スタッフが「ここに入りたい」と挙手する **アクション性のある積極シグナル**。サービスのブランドカラー（primary）で「このユーザーの意思」を主役表示する。warning は「警告」で意味が反転し誤読を生む（→ #2/#3/#4 の warning は誤り） |
| `available` | **success** | 「出勤 OK = 緑信号」の世界共通メタファ。info（水色）は「お知らせ」で行動可能性を示さない。primary は preferred と被るので不可。 |
| `unavailable` | **neutral** | 「不可」は否定だが **ルール違反でも警告でもない正当な権利申告**。danger（赤）/ warning（橙）は心理的圧迫が強すぎる。グレーで「このスロットには出ない」と中立的に消音表示するのが UX 的に正解。色覚配慮上も赤緑の隣接を避けられる。 |

### 3.3 アイコン（色覚配慮）

| type | 採択アイコン | 旧 | 形状の差異 | 理由 |
|---|---|---|---|---|
| `preferred` | **`Star`**（lucide-react） | CheckCircle2 | 5 角形・尖り | 「お気に入り = 希望」の直感メタファ。CheckCircle2 と Circle が同心円で混同される問題を根本解消 |
| `available` | **`CircleCheck`**（=lucide-react `CheckCircle2` のエイリアス、視覚的に同じ） | Circle | 円 + チェック | 「OK」の明示。空の Circle は「未入力」と誤読されるので廃止 |
| `unavailable` | **`Ban`**（lucide-react） | XCircle | 円 + 斜線 | 道路標識「進入禁止」と同型で、文字を読まずに「不可」が伝わる。XCircle（×内包）は否定形すぎてストレス |

→ **3 つとも輪郭シルエットが明確に異なる**（星・チェック付き円・斜線円）→ グレースケールでも 100% 識別可能。

### 3.4 検証：色覚シミュレーション（理論）

| 型 | P 型（赤緑色弱） | D 型 | T 型 | グレースケール |
|---|---|---|---|---|
| primary（青系） vs success（緑系） vs neutral（灰） | 青と緑は区別可（明度差あり）、灰は明らかに別 | 同上 | 青と緑が近づく → アイコン形状で補完 | 明度差 + 形状差で識別可 |

→ **色＋形状の二重符号化** で WCAG 1.4.1（色のみに依存しない）をクリア。

---

## 4. 新規ファイル設計

### 4.1 ファイルパス
`/Users/usr0103301/Documents/個人仕事/newWorld/kintai/src/lib/preferenceTheme.ts`

### 4.2 export シグネチャ（TypeScript）

```ts
import type { LucideIcon } from 'lucide-react';
import { Star, CheckCircle2, Ban } from 'lucide-react';
import type { ShiftPreferenceType } from '../types';

/** UI 用の色トーン（Tailwind パレット名と 1:1） */
export type PreferenceTone = 'primary' | 'success' | 'neutral';

/** 1 つの preference_type に対する完全な UI 表現セット */
export interface PreferenceTheme {
  /** 型そのもの */
  type: ShiftPreferenceType;
  /** 色トーン名（プレゼン層で参照する用） */
  tone: PreferenceTone;
  /** 日本語フルラベル（"希望" / "出勤可能" / "出勤不可"） */
  label: string;
  /** 1 文字略記（カレンダーセル等の極小表示用："希" / "可" / "不"） */
  shortLabel: string;
  /** lucide アイコンコンポーネント */
  Icon: LucideIcon;

  // ---- Tailwind class セット（dark: ペア完備） ----

  /** カレンダーセル等のフルブロック背景 + リング + 文字色 */
  cellClass: string;
  /** 数値サマリの強調文字色（"text-XXX-600 dark:text-XXX-400"） */
  countTextClass: string;
  /** ドット（"bg-XXX-500 dark:bg-XXX-400"） */
  dotClass: string;
  /** アイコン単独色（"text-XXX-500 dark:text-XXX-400"） */
  iconColorClass: string;
  /** アイコン背景チップ（リスト iconBox 用："bg-XXX-50 text-XXX-700 dark:bg-XXX-900/40 dark:text-XXX-300"） */
  iconBoxClass: string;
  /** カード／バナー枠（"border-XXX-200 bg-XXX-50 dark:border-XXX-700 dark:bg-XXX-950"） */
  cardBorderBgClass: string;
  /** バッジ用（"bg-XXX-100 text-XXX-700 dark:bg-XXX-800 dark:text-XXX-200"） */
  badgeClass: string;
}

/** 取得関数（推奨 API） */
export function getPreferenceTheme(type: ShiftPreferenceType): PreferenceTheme;

/** 全テーマを Record で取得（map 用途） */
export const PREFERENCE_THEME: Record<ShiftPreferenceType, PreferenceTheme>;

/** 配列で取得（フォーム選択肢ループ等） */
export const PREFERENCE_THEME_LIST: PreferenceTheme[];
```

### 4.3 実装内容（チームへの仕様）

```ts
// 推奨マッピング表（実装はこの定数の組み立て）
const RAW = {
  preferred: {
    tone: 'primary' as const,
    label: '希望',
    shortLabel: '希',
    Icon: Star,
  },
  available: {
    tone: 'success' as const,
    label: '出勤可能',
    shortLabel: '可',
    Icon: CheckCircle2,
  },
  unavailable: {
    tone: 'neutral' as const,
    label: '出勤不可',
    shortLabel: '不',
    Icon: Ban,
  },
};

// tone から各 class を組み立てるヘルパー（DRY）
function build(tone: PreferenceTone) {
  return {
    cellClass:        `bg-${tone}-50 ring-1 ring-${tone}-300 text-${tone}-700 dark:bg-${tone}-900/30 dark:ring-${tone}-700 dark:text-${tone}-200`,
    countTextClass:   `text-${tone}-600 dark:text-${tone}-400`,
    dotClass:         `bg-${tone}-500 dark:bg-${tone}-400`,
    iconColorClass:   `text-${tone}-500 dark:text-${tone}-400`,
    iconBoxClass:     `bg-${tone}-50 text-${tone}-700 dark:bg-${tone}-900/40 dark:text-${tone}-300`,
    cardBorderBgClass:`border-${tone}-200 bg-${tone}-50 dark:border-${tone}-700 dark:bg-${tone}-950`,
    badgeClass:       `bg-${tone}-100 text-${tone}-700 dark:bg-${tone}-800 dark:text-${tone}-200`,
  };
}
```

> **重要 — Tailwind JIT 注意**：`bg-${tone}-50` 形式の動的クラス名は Tailwind JIT がスキャンできない。
> **必ず文字列リテラルで列挙**して RAW テーブルを書くこと（DRY ヘルパーは実装不可、各テーマで 7 クラス × 3 type = 21 クラスを literal で定義）。
> Engineer はこの仕様を守ること。`safelist` への登録でも回避可能だが、メンテ性が悪いため非推奨。

→ **チームには「ヘルパー関数なしの全 literal 列挙版」で実装させる**（後述タスク #A）。

### 4.4 import 例
```ts
// 使用側
import { getPreferenceTheme, PREFERENCE_THEME_LIST } from '../../lib/preferenceTheme';

const theme = getPreferenceTheme(p.preference_type);
<theme.Icon className={`w-4 h-4 ${theme.iconColorClass}`} />
<span>{theme.label}</span>
```

---

## 5. 置換対象 7 箇所 + 修正パターン

### 5.1 #1 ShiftPreferenceCalendar.tsx L28–50
- **削除**: `PREFERENCE_STYLE` 定数（ローカル）
- **置換**: 既存参照箇所（`PREFERENCE_STYLE[p.preference_type].cellClass` 等）を `getPreferenceTheme(p.preference_type).cellClass` に
- **影響**: cellClass / dot → dotClass / text → iconColorClass / label をプロパティ名移行
- **import 追加**: `import { getPreferenceTheme } from '../../lib/preferenceTheme';`
- **import 削除**: `CheckCircle2, Circle, XCircle` のうち、このファイルで他用途で使っていないものを削除

### 5.2 #2 ShiftPreferenceSidebar.tsx L114–130（admin 凡例）
- **置換**: 3 行をループ生成に
  ```tsx
  {PREFERENCE_THEME_LIST.map(t => (
    <div key={t.type} className="flex items-center gap-2">
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${t.dotClass}`} />
      <t.Icon className={`w-4 h-4 shrink-0 ${t.iconColorClass}`} aria-hidden="true" />
      <span>{t.label}</span>
    </div>
  ))}
  ```

### 5.3 #3 ShiftPreferenceSidebar.tsx L136–149（admin サマリ）
- **置換**: 3 つの `<div>` を `PREFERENCE_THEME_LIST.map` に。`adminSummary[t.type + 'Count']` の参照には型ガードヘルパー（`getCount(adminSummary, t.type)`）を新設、または既存型を `Record<ShiftPreferenceType, number>` に拡張して直接参照。**設計書としては後者推奨**（adminSummary 型の counts プロパティを `Record<ShiftPreferenceType, number>` に変更）。

### 5.4 #4 ShiftPreferenceSidebar.tsx L228–249（self サマリ）
- 同 #3 と同パターン。`preferenceSummary` の counts も `Record<ShiftPreferenceType, number>` に揃える。

### 5.5 #5 ShiftPage.tsx L42–46（PREF_LIST_STYLE）
- **削除**: `PREF_LIST_STYLE` ローカル定数 + `PrefListStyle` interface
- **置換**: 参照箇所を `getPreferenceTheme(...)` の `iconBoxClass / Icon / label` に
- **import 整理**: `CheckCircle2, Circle, XCircle` の不要分を削除

### 5.6 #6 PreferenceActionRow.tsx L34–38, L221, L258–272
- **削除**: ローカル `PREFERENCE_ICON` 定数
- **置換**: `Ic = PREFERENCE_ICON[...]` → `theme = getPreferenceTheme(preference.preference_type); Ic = theme.Icon`
- **置換**: L258–272 の 3 分岐 if は `theme.iconColorClass` / `theme.label` に統一
- **compact variant**（L145, L167）の `typeLabel = ... '希' : '可' : '不'` は `theme.shortLabel` に置換

### 5.7 #7 ShiftPreferenceForm.tsx L41–51
- **削除**: `PREF_CONFIGS` 配列 + `PrefConfig` interface
- **置換**: `PREFERENCE_THEME_LIST.map(t => ({ value: t.type, label: t.label, Icon: t.Icon }))` または直接 list を使う
- フォーム選択ボタンの色付けを **選択中は `theme.cellClass` / 非選択は中立** で表示（現状色なし → UX 改善のオマケ）

---

## 6. タスク分割（並列度・チーム編成）

### 6.1 並列戦略
共通ファイル `preferenceTheme.ts` を **A が先行リリース** → B/C/D が並列で各画面置換。

| Phase | チーム | 担当 | ファイル | 依存 |
|---|---|---|---|---|
| **Phase 1** | **A** | 新規ライブラリ作成 | `src/lib/preferenceTheme.ts`（新規） | なし |
| **Phase 2 並列** | **B** | カレンダー系統 | `src/components/Shift/ShiftPreferenceCalendar.tsx` (#1) | A |
| | **C** | サイドバー 3 箇所一括 | `src/components/Shift/ShiftPreferenceSidebar.tsx` (#2 #3 #4) + 型修正（adminSummary/preferenceSummary を `Record<ShiftPreferenceType, number>` 化に伴う `ShiftPage.tsx` 側 props 構築の同期） | A |
| | **D** | ページ + ActionRow + Form | `src/pages/ShiftPage.tsx` (#5) + `src/components/Shift/PreferenceActionRow.tsx` (#6) + `src/components/Shift/ShiftPreferenceForm.tsx` (#7) | A |

→ **使用チーム数 4（A〜D）**、Phase 数 2、Phase 2 は 3 並列。

### 6.2 競合リスク
- **C ↔ D の境界**: `ShiftPage.tsx` の `preferenceSummary` 構築コード（L122–133 付近）は **C が型変更を主導、D は読み取り側の調整のみ**。C が完了後、D が PR を rebase。
  - → **回避策**: C の作業ブランチに D が直接コミットせず、C 完了後 D の差分を merge する。または **C が `ShiftPage.tsx` の summary 構築部分も担当し、D は L42–46 の PREF_LIST_STYLE 削除のみに限定**。
  - → **採択**: 後者（C が ShiftPage.tsx の summary 関連も触る、D は PREF_LIST_STYLE 関連のみ）。境界明確化。

### 6.3 各タスク詳細指示

#### Task A — preferenceTheme.ts 新規作成
- **ファイル**: `kintai/src/lib/preferenceTheme.ts`
- **要件**: §4.2 のシグネチャを完全実装。**全 class を文字列リテラルで列挙**（Tailwind JIT 対応）。
- **テスト不要**（純粋な定数モジュール）
- **完了条件**:
  - `tsc --noEmit` でエラーゼロ
  - `getPreferenceTheme('preferred').tone === 'primary'` を満たす
  - `PREFERENCE_THEME_LIST.length === 3`

#### Task B — ShiftPreferenceCalendar.tsx 置換（#1）
- **対象**: L28–50 の `PREFERENCE_STYLE` を削除、`getPreferenceTheme` 使用に置換
- **import 整理**: lucide-react の未使用アイコン除去
- **完了条件**:
  - L28–50 のローカル `PREFERENCE_STYLE` が消滅
  - 既存の見た目振る舞いは維持（preferred セルが primary 色で表示される）
  - dark mode で全 3 type の色が表示される
  - `tsc --noEmit` エラーゼロ

#### Task C — ShiftPreferenceSidebar.tsx 置換 + 型統一（#2 #3 #4）
- **対象 1**: L114–130 凡例 → `PREFERENCE_THEME_LIST.map`
- **対象 2**: L136–149 admin サマリ → `PREFERENCE_THEME_LIST.map` + counts 参照を `theme.type` キー経由に
- **対象 3**: L228–249 self サマリ → 同上
- **対象 4 (型)**: `ShiftPreferenceSidebarProps` の `preferenceSummary` / `adminSummary` の counts を `Record<ShiftPreferenceType, number>` 型に変更
- **対象 5 (連動)**: `ShiftPage.tsx` で `preferenceSummary` / 渡している `adminSummary` を構築している箇所（L122–133 付近）を新型に合わせて修正
- **完了条件**:
  - 凡例とサマリで色・アイコン・ラベルが完全一致
  - preferred = primary 色で統一表示される（旧 warning から変更）
  - 3 つの統計値が正しく表示される
  - `tsc --noEmit` エラーゼロ

#### Task D — ShiftPage / PreferenceActionRow / Form 置換（#5 #6 #7）
- **対象 1** (`ShiftPage.tsx` L42–46): `PREF_LIST_STYLE` 削除 → `getPreferenceTheme` 使用、`PrefListStyle` interface 削除
- **対象 2** (`PreferenceActionRow.tsx`): L34–38 `PREFERENCE_ICON` 削除、L145/L167 の typeLabel を `theme.shortLabel` に、L221 の `Ic` 取得を theme 経由に、L258–272 の 3 分岐色を `theme.iconColorClass` に
- **対象 3** (`ShiftPreferenceForm.tsx`): L41–51 `PREF_CONFIGS` 削除 → `PREFERENCE_THEME_LIST` 使用、選択中ボタンに `theme.cellClass` を適用（UX オマケ）
- **完了条件**:
  - 3 ファイルとも該当ローカル定数消滅
  - 履歴リストの iconBox が新カラーで表示される
  - ActionRow full variant で preferred=primary, available=success, unavailable=neutral
  - フォーム選択時に選択ボタンが該当色でハイライト
  - `tsc --noEmit` エラーゼロ

---

## 7. 統合時の注意点

1. **JIT クラス名の検証**: 統合後 `npm run build` を必ず通す。Tailwind がクラス名を見落とすと「色が出ない」現象が起きる。CSS 出力に `bg-primary-50 / bg-success-50 / bg-neutral-50` 等が全部入っているか grep で確認。
2. **型エラー連鎖**: C の adminSummary 型変更が `ShiftPage.tsx` 以外（例: テストやモック）で参照されていないか確認。`grep -rn "adminSummary\|preferenceSummary" src/` で全箇所洗い出し。
3. **lucide アイコン import 整理**: 4 ファイルで `CheckCircle2 / Circle / XCircle` の未使用 import が残らないよう、tsc warning を必ず解消。
4. **既存スナップショット**: テストはなし。Playwright で目視確認のみ。
5. **dual push**: kintai/main subtree push 必須。

---

## 8. Reviewer 観点

集約 Reviewer 1 名で以下を確認:

### 8.1 機能観点
- [ ] 3 type × 6 箇所 + フォームの計 7 箇所すべてで色・アイコン・ラベルが完全一致
- [ ] preferred = primary（青系）に統一されているか（旧 warning 表記が残っていないか）
- [ ] available = success（緑系）に統一されているか
- [ ] unavailable = neutral（灰）に統一されているか
- [ ] 全箇所で dark: バリアントが効いているか

### 8.2 コード品質
- [ ] `preferenceTheme.ts` で全クラス名が文字列リテラル（`${tone}` 補間がない）
- [ ] ローカル `PREFERENCE_STYLE` / `PREF_LIST_STYLE` / `PREFERENCE_ICON` / `PREF_CONFIGS` がすべて削除されている
- [ ] lucide-react の未使用 import が残っていない
- [ ] `tsc --noEmit` エラーゼロ
- [ ] `npm run build` 成功
- [ ] CSS ビルド出力に新規必要クラス（`bg-primary-50 / bg-success-50 / bg-neutral-50` 等 21 クラス）が全部含まれる

### 8.3 a11y / 色覚配慮
- [ ] 3 アイコン（Star / CheckCircle2 / Ban）の輪郭が明確に異なる
- [ ] グレースケール化しても識別可能（DevTools のカラーフィルタで確認）

---

## 9. Playwright スクショ計画（ガッツリモード）

### 9.1 認証問題への対応
shahu-kintai は本番環境では Supabase 認証が必須。Playwright での自動キャプチャは:

- **方針 A（採択）**: ローカル `vite dev` を立ち上げ、開発用 mock store / mock user で **未認証時に表示される public ランディング** + **認証後の Shift ページ** の両方を撮る。認証はテスト用シードユーザー（`.env.local` の `VITE_E2E_TEST_USER_EMAIL` 等）で `signInWithPassword` を browser_evaluate 経由で実行。
- **方針 B（フォールバック）**: 認証突破が困難なら、**手動でログイン済の状態を作ったあと Playwright をアタッチ**してスクショのみ撮影。
- **方針 C**: それも無理ならコードレビュー + storybook 互換のミニマル isolated rendering を `tmp/` に作って撮る。

### 9.2 撮るべき画面（Design Reviewer 提出用）

| # | URL / ルート | 撮影対象 | 観点 |
|---|---|---|---|
| 1 | `/shift?tab=preference` (self mode) | カレンダー全体 + サイドバーサマリ | #1 #4 #7 を一画面で俯瞰 |
| 2 | `/shift?tab=preference` (admin mode, owner ログイン) | admin 凡例 + admin サマリ + ActionRow リスト | #2 #3 #6 |
| 3 | `/shift?tab=preference&view=history` | 履歴リスト（iconBox 確認） | #5 |
| 4 | `/shift?tab=preference` フォーム展開状態 | 選択ボタンのハイライト | #7 オマケ |
| 5 | 上記すべて dark mode 版 | OS の prefers-color-scheme=dark | dark: ペア全部 |
| 6 | DevTools カラーフィルタ（Achromatopsia） | 1〜5 の色覚配慮版 | a11y 検証 |

→ **計 6 セット × Light/Dark + 色覚版 = 約 18 枚**

### 9.3 比較材料（Before/After）
- 着手前に同じ 6 セットを撮影 → `before/` フォルダ
- 完了後 `after/` フォルダ
- design-reviewer に diff を渡す

### 9.4 保存先
`/Users/usr0103301/Documents/個人仕事/newWorld/.company/engineering/tmp/2026-04-28-kintai-loop17/screenshots/{before,after}/`

---

## 10. dual push 計画

完了後:
```bash
# newWorld 親リポジトリ
cd /Users/usr0103301/Documents/個人仕事/newWorld
git add kintai/src/lib/preferenceTheme.ts \
        kintai/src/components/Shift/ShiftPreferenceCalendar.tsx \
        kintai/src/components/Shift/ShiftPreferenceSidebar.tsx \
        kintai/src/components/Shift/PreferenceActionRow.tsx \
        kintai/src/components/Shift/ShiftPreferenceForm.tsx \
        kintai/src/pages/ShiftPage.tsx \
        kintai/.company/engineering/docs/2026-04-28-kintai-loop17-techdesign.md
git commit -m "feat(kintai): L17 preference_type 色マップ統一 — preferenceTheme.ts + 7箇所置換"
git push origin master

# kintai 専用リポジトリ（subtree push 方式）
git subtree push --prefix=kintai https://github.com/.../kintai.git main
# または事前設定済みなら: git push kintai-remote `git subtree split --prefix=kintai master`:main --force
```

---

## 11. 工数見積もり（Tech Lead 概算）

| Phase | チーム | タスク量 | 見積（GLM） |
|---|---|---|---|
| Phase 1 | A | 新規 1 ファイル（~150 行 literal 列挙） | 15 分 |
| Phase 2 並列 | B | 1 ファイル小規模置換 | 10 分 |
| | C | 1 ファイル中規模 + 型変更 + 隣接同期 | 25 分 |
| | D | 3 ファイル（小〜中） | 25 分 |
| Reviewer | R | 4 ファイル + 視覚検証 | 20 分 |
| Tech Lead | TL | 統合 + Playwright + 承認 | 30 分 |
| **合計** | | **直列換算 125 分 / 並列実時 約 90 分** | |

---

## 12. STYLE.md 追記ドラフト（次 Loop 採否）

以下を STYLE.md §4 として追記候補（本 Loop では追記せず、L20/L26 でまとめる）:

```md
## 4. シフト希望（preference_type）色マッピング

`preference_type` の UI 表現は **必ず `src/lib/preferenceTheme.ts` から取得** すること。
ローカルでマッピング定数を再定義することは禁止。

| type | tone | アイコン | 意味 |
|---|---|---|---|
| preferred  | primary | Star         | 「ぜひこの日に入りたい」積極希望 |
| available  | success | CheckCircle2 | 「入れと言われれば入れる」可用性表明 |
| unavailable| neutral | Ban          | 「不可」中立的な不可申告 |

dark: バリアントは preferenceTheme.ts に内包済。各クラスは文字列リテラルで列挙されている（Tailwind JIT 対応）。
```

---

## 13. 設計確定事項（一行サマリ）

- **ファイル**: `kintai/src/lib/preferenceTheme.ts`（新規）
- **採択マッピング**: `preferred=primary+Star` / `available=success+CheckCircle2` / `unavailable=neutral+Ban`
- **置換対象**: 7 箇所（5 + 隠れ 2）
- **チーム**: A（lib 作成）→ B/C/D（並列置換）の **2 Phase × 最大 3 並列**
- **Reviewer**: 1 名集約、機能 + 品質 + a11y 観点
- **dual push**: 必須

---

(EOF)
