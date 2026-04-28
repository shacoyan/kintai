# L19: EmptyState 統一 — 技術設計書

- 起票日: 2026-04-28
- 作成: Tech Lead (Opus 4)
- スコープ: kintai リポジトリ (newWorld サブツリー / kintai/main 両方)
- ループ位置: シフト申請/承認 10 Loop UX 改善 — L19 (L18 完了済 / L20 完了済 / L19 in_progress)
- 関連タスク: TaskList #97

---

## 1. 背景・現状調査結果

### 1.1 既に存在する `EmptyState` コンポーネント

`kintai/src/components/ui/EmptyState.tsx` に既に実装済み。バレル (`src/components/ui/index.ts`) からも export されている。

現行 API:

```ts
interface EmptyStateProps {
  icon?: React.ReactNode;       // 省略時 <Inbox />
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}
```

スタイル: `flex flex-col items-center justify-center py-12 text-center`、デフォルトアイコン `Inbox 12x12 text-neutral-400/500`、タイトル `text-lg font-medium text-neutral-600/400`、説明 `text-sm text-neutral-400/500 max-w-xs`。dark モードはペアで対応済。

### 1.2 既に `EmptyState` を使用している場所 (= 統一済)

| # | ファイル | title (現状) | icon |
|---|---|---|---|
| U1 | `src/components/Attendance/DailyList.tsx:71` | 勤怠記録がありません | `TrendingUp` |
| U2 | `src/components/Attendance/MonthlySummary.tsx:16` | 今月はまだ打刻記録がありません | `Calendar` |
| U3 | `src/components/Tenant/TenantSelector.tsx:55` | 参加中のワークスペースがありません | `Building2` |
| U4 | `src/components/Correction/CorrectionList.tsx:93` | 修正申請はありません | `FileEdit` |
| U5 | `src/components/Notification/NotificationBell.tsx:184` | 新しい通知はありません | (なし→Inbox) |
| U6 | `src/components/Notification/NotificationBell.tsx:215` | 新しい通知はありません | (なし→Inbox) |
| U7 | `src/components/Leave/LeaveList.tsx:85` | 休暇申請はありません | (確認要) |
| U8 | `src/components/Admin/ShiftMismatchAlert.tsx:76` | シフト不一致はありません | (なし→Inbox) |
| U9 | `src/components/Admin/ShiftPresetManager.tsx:179` | プリセットが未登録です | `CalendarClock` |
| U10 | `src/components/Admin/StoreManagement.tsx:151,215,260` | テナントにメンバーがいません 他 | (一部 icon なし) |
| U11 | `src/components/Admin/RoleManagementSection.tsx:123` | 役職がまだありません | (なし→Inbox) |
| U12 | `src/components/Admin/PayrollCalculation.tsx:632` | YYYY年M月のデータはありません | `Calculator` |
| U13 | `src/pages/HistoryPage.tsx:468` | 今月の勤怠データがまだありません | `CalendarX` |
| U14 | `src/pages/DashboardPage.tsx:212` | まだ本日の打刻はありません | `Clock` |

### 1.3 ad-hoc (未統一) の empty 表示 — 本 Loop の置換対象

| # | ファイル | 行 | 現コード概要 | 文言 |
|---|---|---|---|---|
| A1 | `src/components/Shift/ShiftPreferenceCalendar.tsx` | 341-355 | 黄色バナー (`bg-warning-50 ... border ... rounded-lg p-3 flex items-center justify-between`) + 右側に「次の希望がある月へ」リンクボタン | 今月のシフト希望はまだありません |
| A2 | `src/components/Shift/ShiftCalendar.tsx` | 267-281 | 青バナー (`bg-primary-50 ... border ... rounded-lg`) + 右側に「次のシフトがある月へ」ボタン | 今月のシフトはまだありません |
| A3 | `src/components/Shift/ShiftPreferenceSidebar.tsx` | 152-154 | `<div className="text-sm text-neutral-500">この日の希望はありません</div>` | この日の希望はありません |
| A4 | `src/components/Shift/ShiftPreferenceAdminList.tsx` | 297-301 | `<p className="text-sm text-neutral-500 dark:text-neutral-400 py-4 text-center">...</p>` 動的文言 (history / all / pending の 3 分岐) | 履歴はありません / 希望がありません / 未対応の希望はありません |
| A5 | `src/components/Shift/ShiftAdminPanel.tsx` | 216 | `<div className="px-6 py-8 text-center text-neutral-500 dark:text-neutral-400">シフト申請はありません</div>` | シフト申請はありません |
| A6 | `src/pages/ShiftPage.tsx` | 488-490 | BottomSheet 内 `<p className="text-sm text-neutral-500 dark:text-neutral-400 text-center py-6">...</p>` | この日にシフトはありません |
| A7 | `src/pages/ShiftPage.tsx` | 740-742 | `<li className="px-4 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">...</li>` | この日の希望はありません |
| A8 | `src/pages/ShiftPage.tsx` | 845-849 | `<Card padding="md"><p className="text-center text-sm ...">履歴はありません</p></Card>` | 履歴はありません |
| A9 | `src/pages/HistoryPage.tsx` | 495-499 | calendar view の補助テキスト `<p className="text-center text-sm ... py-2">...</p>` | 今月の打刻データがまだありません |

### 1.4 検出された問題

1. **同一文言の重複**: 「この日の希望はありません」(A3, A7)、「履歴はありません」(A4, A8)、「今月のシフト希望はまだありません」系 (A1, A2)。
2. **サイズ不揃い**: `EmptyState` 既定は `py-12` (大), ad-hoc は `py-4`〜`py-8`、A6/A7 はリスト内 `py-6`、A9 は補助テキスト `py-2`。**現行 API には `size` バリアントが無い**ため、リスト内・カード内・ページレベルで一律 `py-12` は重すぎ → ad-hoc が残った主因。
3. **アクション付き empty**: A1/A2 は「次の月へ移動」ボタン付き warning/primary バナースタイル。現行 `action` API は中央配置 primary ボタンのみ。
4. **トーン (色付きバナー)**: A1 (warning), A2 (primary) のように "情報を強調する empty" は `EmptyState` には現状無い (常に neutral)。
5. **a11y**: 現行 `EmptyState` に `role` 指定なし。

---

## 2. 統一仕様

### 2.1 新 `EmptyState` API

```ts
type EmptyStateSize = 'sm' | 'md' | 'lg';
type EmptyStateTone = 'neutral' | 'info' | 'warning';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
  iconRight?: React.ReactNode;       // A1/A2 の ChevronRight 等
  variant?: 'primary' | 'tertiary';  // 既定 'primary'
}

interface EmptyStateProps {
  icon?: React.ReactNode;             // 省略時 <Inbox />、tone により色追従
  title: string;
  description?: string;
  action?: EmptyStateAction;
  size?: EmptyStateSize;              // 既定 'md'
  tone?: EmptyStateTone;              // 既定 'neutral'
  className?: string;                 // 余白の微調整用 (margin など)
  'data-testid'?: string;
}
```

### 2.2 サイズバリアント

| size | 用途 | 縦余白 | アイコン | タイトル | 説明 |
|---|---|---|---|---|---|
| `sm` | リスト・サイドバー・BottomSheet 内 | `py-6` | `w-8 h-8` | `text-sm font-medium` | `text-xs` |
| `md` (既定) | カード内・セクション内 | `py-12` | `w-12 h-12` | `text-lg font-medium` | `text-sm` |
| `lg` | ページ全体 (該当データなし時のメインビュー) | `py-20` | `w-16 h-16` | `text-xl font-semibold` | `text-base` |

`sm` では `description` を省略しても破綻しないようマージン調整。

### 2.3 トーンバリアント (色付きバナー対応)

`tone='neutral'` (既定): 縦並び中央配置、現行と同じ。

`tone='info'` / `tone='warning'`: **横並びバナー形** に切り替え、A1/A2 を一発で吸収。

```
┌──────────────────────────────────────────────────────┐
│ [icon] title (任意 description)        [ action  >] │
└──────────────────────────────────────────────────────┘
```

スタイル (Tailwind トークン):

| tone | container | text | action button |
|---|---|---|---|
| `info` | `bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg p-3` | `text-primary-800 dark:text-primary-300` | `bg-primary-100 dark:bg-primary-800/40 text-primary-700 dark:text-primary-200 hover:bg-primary-200 dark:hover:bg-primary-800/60` |
| `warning` | `bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800 rounded-lg p-3` | `text-warning-800 dark:text-warning-200` | `bg-primary-600 hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600 text-white` (A1 の現行に揃える) |

`tone !== 'neutral'` の場合、`size` 指定は無視 (常にバナー高さ固定)、`icon` 指定可だが省略可。

### 2.4 a11y

- `tone='neutral'`: ルート要素 `role="status"` + `aria-live="polite"` (空表示は状態通知)
- `tone='info' | 'warning'`: ルート要素 `role="status"` のみ (頻繁にアニメーションしない)
- アイコンには `aria-hidden="true"` 付与
- `action.label` がそのままボタンの可視ラベル → `aria-label` 不要
- ChevronRight 等 `iconRight` も `aria-hidden`

### 2.5 dark モード

すべての色クラスはペアで指定 (上の表参照)。L23 (dark ペア欠落スキャン) と整合。

---

## 3. 新規/変更ファイル一覧

| 種別 | パス | 内容 |
|---|---|---|
| 改修 | `kintai/src/components/ui/EmptyState.tsx` | API 拡張 (size / tone / action.iconRight など)、後方互換維持 |
| 確認 | `kintai/src/components/ui/index.ts` | 既存 `EmptyState` re-export のまま (型 export 追加) |
| 置換 | A1: `kintai/src/components/Shift/ShiftPreferenceCalendar.tsx` | バナー → `<EmptyState tone="warning" action=... />` |
| 置換 | A2: `kintai/src/components/Shift/ShiftCalendar.tsx` | バナー → `<EmptyState tone="info" action=... />` |
| 置換 | A3: `kintai/src/components/Shift/ShiftPreferenceSidebar.tsx` | div → `<EmptyState size="sm" title="この日の希望はありません" />` |
| 置換 | A4: `kintai/src/components/Shift/ShiftPreferenceAdminList.tsx` | p → `<EmptyState size="sm" title={...} />` (動的文言維持) |
| 置換 | A5: `kintai/src/components/Shift/ShiftAdminPanel.tsx` | div → `<EmptyState size="md" title="シフト申請はありません" />` |
| 置換 | A6: `kintai/src/pages/ShiftPage.tsx` | BottomSheet 内 p → `<EmptyState size="sm" title="この日にシフトはありません" />` |
| 置換 | A7: `kintai/src/pages/ShiftPage.tsx` | li 内 → `<li><EmptyState size="sm" ... /></li>` |
| 置換 | A8: `kintai/src/pages/ShiftPage.tsx` | Card 内 p → `<EmptyState size="sm" title="履歴はありません" />` (Card は維持) |
| 置換 | A9: `kintai/src/pages/HistoryPage.tsx` | 補助 p → 削除 or `<EmptyState size="sm" />` (詳細は B 担当判断、L18 改修箇所と整合) |

### 3.1 文言統一 (表記ゆれ吸収)

- 「ありません」「ありません。」混在 → **句点なし** に統一 (現状ほぼ句点なし、文言変更最小)
- 「まだ X はありません」「X はまだありません」「X がありません」の語順は **元コードを尊重** (コピー変更は別 Loop 推奨)
- 「履歴はありません」(A4 historyMode + A8) → 同一文言に統一済 → そのまま

---

## 4. チーム別タスク (Engineer 分割)

並列度: **2 並列** (A, B)。理由:
- A は基盤 (`EmptyState.tsx` の API 拡張) → 全置換の前提。**A 完了後に B 開始** という弱依存があるが、API シグネチャを設計書で先に確定するため、B は `EmptyState.tsx` の最終形を待たずにモック型で着手可能。
- 置換ファイル数が 9 (Shift 系 5 + pages 系 3 + 確認 1) と中規模 → 2 名で十分、過剰並列はマージ衝突を増やす。
- C 以降は不要。

### Team A — 基盤 (EmptyState コンポーネント拡張)

**対象ファイル**: `kintai/src/components/ui/EmptyState.tsx` のみ

**作業内容**:
1. §2.1 の Props 型定義に拡張
2. `size` (sm/md/lg) クラス分岐
3. `tone` (neutral/info/warning) でレンダリング分岐
   - `neutral` → 縦並び (現行)
   - `info`/`warning` → 横並びバナー
4. `action.iconRight`, `action.variant` 対応
5. a11y: `role`, `aria-hidden` 付与
6. デフォルト値で **既存 14 箇所 (U1〜U14) が変更不要** であることを保証 (`size='md'`, `tone='neutral'`)

**期待動作**:
- 既存呼び出し元のレンダリング結果が **ピクセルパーフェクト** で従来と一致
- 新規 prop (`size='sm'`, `tone='warning'` 等) で §2.2/2.3 の見た目を実現
- TypeScript エラー 0 / `npm run build` 成功

**禁止事項**:
- 既存呼び出し元のコードは触らない (B 担当)
- バレル `index.ts` の export 文修正は型 export 追加のみ

### Team B — 置換 (ad-hoc empty を EmptyState に統一)

**対象ファイル** (9 ファイル):
1. `kintai/src/components/Shift/ShiftPreferenceCalendar.tsx` (A1)
2. `kintai/src/components/Shift/ShiftCalendar.tsx` (A2)
3. `kintai/src/components/Shift/ShiftPreferenceSidebar.tsx` (A3)
4. `kintai/src/components/Shift/ShiftPreferenceAdminList.tsx` (A4)
5. `kintai/src/components/Shift/ShiftAdminPanel.tsx` (A5)
6. `kintai/src/pages/ShiftPage.tsx` (A6, A7, A8 — 3 箇所まとめて)
7. `kintai/src/pages/HistoryPage.tsx` (A9)

**作業内容**:
- §3 表に従い ad-hoc div/p/li を `<EmptyState>` に置換
- 必要なアイコンを `lucide-react` から import (既存 import に追加):
  - A1: `<EmptyState tone="warning" title="今月のシフト希望はまだありません" action={ nextPrefMonth ? { label: '次の希望がある月へ', onClick: navigateToNextPrefMonth, iconRight: <NextPrefIcon className="w-3 h-3" aria-hidden /> } : undefined} />` (NextPrefIcon は既存使用中アイコンを流用)
  - A2: `<EmptyState tone="info" title="今月のシフトはまだありません" action={ hasFutureShift ? { label: '次のシフトがある月へ', onClick: navigateToNextShiftMonth, iconRight: <ChevronRight className="w-4 h-4" aria-hidden /> } : undefined} />`
- A4 の動的文言は **三項演算で title を組み立て** て渡す:
  ```tsx
  <EmptyState size="sm" title={historyMode ? '履歴はありません' : (statusFilter === 'all' ? '希望がありません' : '未対応の希望はありません')} />
  ```
- A6/A7 は親が BottomSheet/ul のため `size="sm"` 必須
- A8 は外側の `<Card padding="md">` を **維持** (他のタブと UI が揃うため)
- A9 は `viewMode === 'calendar'` の補助テキスト → L18 の calendar 改修と整合する形で `size="sm"` で表示 or 削除 (calendar 自身に空表現がある場合)。**B 担当者が現状確認の上で判断**。判断に迷ったら `size="sm"` で残す方針。

**期待動作**:
- 視覚的に大きく崩れない (色付きバナーは A1/A2 の現状色を再現)
- A1/A2 の「次の月へ」ボタンの動作・遷移先が変わらない
- ダークモードで全箇所が破綻しない
- TypeScript エラー 0 / `npm run build` 成功

**禁止事項**:
- `EmptyState.tsx` 本体は触らない (Team A 担当)
- 文言変更は §3.1 の範囲内のみ (新規コピー作成は L 別 Loop)
- 不要 import 残置禁止 (削除した element に対応する未使用 className がないか確認)

### 依存関係

```
Team A (API 拡張) ──┐
                   ├──→ Team B (置換)
[本設計書 §2 確定] ──┘
```

Team A の API は本設計書 §2.1 で完全確定 → Team B は API シグネチャを参照しながら **A と並列で着手可能**。ただし最終 build 検証は A マージ後に B が rebase して実施。

### マージ順序

1. Team A → Team B の順で commit
2. Reviewer は A→B の順でレビュー (A 単体で破綻ないことを先に確認)

---

## 5. Reviewer 観点 (集約 1 名)

以下を **すべて** チェック:

### 5.1 Team A (基盤)

- [ ] `EmptyState.tsx` の Props 型が §2.1 と完全一致
- [ ] 既存 14 箇所 (U1〜U14) が **無改修で動く** ことを `git diff` で確認 (Team B の変更を除外)
- [ ] `size='sm'` / `size='lg'` のクラスが §2.2 表と一致
- [ ] `tone='info'` / `tone='warning'` のクラスが §2.3 表と一致 (色トークンは既存 `tailwind.config` の primary/warning スケールを使用)
- [ ] dark: ペアがすべて指定されている
- [ ] `role="status"` 付与 / アイコン `aria-hidden`
- [ ] action.iconRight が指定時のみ描画される (`undefined` でも壊れない)
- [ ] `npm run build` 成功

### 5.2 Team B (置換)

- [ ] §3 表の 9 箇所すべて置換済 (`grep -rn "ありません" src/` で残党チェック)
- [ ] **新規 ad-hoc empty を作っていない** (今後の置換漏れ防止のため、本 Loop で発見した ad-hoc は全て `EmptyState` 化されている)
- [ ] A1/A2 のバナー色・ボタン文言・onClick 挙動が一致
- [ ] A4 の動的文言 3 分岐 (history/all/pending) がすべて表示される
- [ ] A6/A7/A8 のサイズが `sm` で過大な余白を生んでいない
- [ ] 削除した元コードに紐づく未使用 import / 未使用変数がない
- [ ] dark モードで全 9 箇所が読める色になっている
- [ ] `npm run build` 成功

### 5.3 横断

- [ ] 文言の表記ゆれ (句点有無・全半角) なし
- [ ] `EmptyState.tsx` 以外で `Inbox` を直接 import している箇所が増えていない (重複アイコン import の予防)
- [ ] PR 規模が想定内 (~10 ファイル / ±200 行程度)

判定: `approved` / `needs-fix(team=A|B, reason=...)`

---

## 6. 検証計画

### 6.1 ビルド検証 (各 Engineer 内 + Reviewer)

```bash
cd kintai
npm run build
npm run lint   # eslint があれば
npx tsc --noEmit
```

### 6.2 grep 検証 (Reviewer)

```bash
# 残党チェック (見落とし検出)
grep -rn "ありません\|empty state\|まだ.*ません" src/components/Shift src/pages --include="*.tsx" \
  | grep -v "EmptyState"
# → 0 件 or 設計上残すべき箇所のみ (例: ShiftEditModal の権限エラー文言は empty ではない)
```

### 6.3 Playwright スクショ (本 Loop では実施しない)

- L19 単体ではスクショ取得しない (ループごとのスクショは時間効率が悪い)
- **次のループ (L21 以降) または 10 Loop 完了時の最終検証ループでまとめて取得**
- 取得対象 (将来の TODO): /shift (空月)・/shift?tab=admin・/shift?tab=preference (空日)・/history (空月)・/notification (空)・/correction (空) を light/dark × PC/SP の計 24 枚

### 6.4 手動確認 (任意・統合直前)

- `npm run dev` 起動 → 空のテナントでログイン → 各画面で empty 表示が崩れていないか目視

---

## 7. dual push 計画

L19 完了時:

```bash
# 1. newWorld 側 (subtree 親リポ) で commit
cd /Users/usr0103301/Documents/個人仕事/newWorld
git add kintai/src/components/ui/EmptyState.tsx \
        kintai/src/components/Shift/ShiftPreferenceCalendar.tsx \
        kintai/src/components/Shift/ShiftCalendar.tsx \
        kintai/src/components/Shift/ShiftPreferenceSidebar.tsx \
        kintai/src/components/Shift/ShiftPreferenceAdminList.tsx \
        kintai/src/components/Shift/ShiftAdminPanel.tsx \
        kintai/src/pages/ShiftPage.tsx \
        kintai/src/pages/HistoryPage.tsx \
        kintai/.company/engineering/docs/2026-04-28-kintai-loop19-techdesign.md
git commit -m "feat(kintai): L19 EmptyState 統一 — ad-hoc 9 箇所を統一コンポーネントに集約"
git push origin master

# 2. kintai 専用リポへ subtree push (MEMORY.md project_kintai_loop_b_done.md の dual push 方式)
git subtree push --prefix=kintai kintai main
```

push 後、Vercel Production の自動デプロイを Reviewer が確認。

---

## 8. 想定外/競合リスク

| リスク | 対策 |
|---|---|
| L18 (カレンダーセル モバイル対応) との競合 | A9 (HistoryPage) のみ重なる可能性 → Team B が現状 (L18 完了後) を grep 確認してから着手 |
| L20 (凡例折りたたみ + ヘッダ階層) との競合 | 完了済 (#98) → ShiftPage の構造を Team B が **置換時のコンテキストとして** 参照のみ |
| L23 (dark ペア欠落) との競合 | 本 Loop で新規追加する dark: クラスは設計書 §2.3 に従う → L23 のスキャン対象から外せる |
| `EmptyState` API 拡張で既存 14 箇所が壊れる | Team A の Reviewer 観点 (5.1) で既存箇所に diff がないことを必ず確認 |
| BottomSheet 内 (A6/A7) で `role="status"` が二重 announce | BottomSheet 自身が `role="dialog"` 系のはず → 中身の status は OS 側で適切にハンドルされる想定 (問題出れば L25 a11y 改善で再調整) |

---

## 9. 完了条件 (Definition of Done)

- [ ] Team A: `EmptyState.tsx` 拡張完了 + Reviewer approved
- [ ] Team B: 9 箇所置換完了 + Reviewer approved
- [ ] Tech Lead 統合 `git diff` 検査・最終承認
- [ ] `npm run build` 成功
- [ ] dual push (newWorld master + kintai/main) 完了
- [ ] Vercel Production に反映 (自動)
- [ ] TaskList #97 を completed に更新
