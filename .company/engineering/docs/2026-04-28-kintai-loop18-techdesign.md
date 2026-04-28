# L18 + L20 統合: カレンダーセル モバイル対応 + 凡例折りたたみ

- 作成日: 2026-04-28
- Tech Lead: 💻
- ベースSHA: newWorld 1a7dd7f / kintai a6984e9
- 関連タスク: #96 (L18 in_progress), #98 (L20 in_progress, L18 統合)
- 関連設計書（前史）:
  - `2026-04-26-kintai-multi-store-loop-b.md`
  - `2026-04-25-kintai-shift-preference-history-tab.md`
  - L17 (preferenceTheme 統一) 完了

---

## 1. 背景・目的

### 1.1 ペルソナ別の課題
- **A（スタッフ・SP メイン）**: カレンダーセルが指で押しにくい。希望/承認のステータス凡例が両方常駐していて何を見ればよいか分からない。実画面のセル高 47px は WCAG 2.5.5（44×44 推奨）をギリギリ。視覚的にも「タップターゲット」と認識しにくい。
- **B（店長・PC 兼用）**: セル内の 24×24 承認/却下ボタンが小さく、誤タップ多発。SP だと拡大タップしないと押せない。凡例 11 項目（メンバー色 + 状態 5 + 種別 3）を一望できず情報設計が破綻。
- **C（オーナー）**: SP で全体を眺めるとき、凡例が 2 行に折返してカレンダー本体を圧迫。

### 1.2 ゴール
1. **タップターゲットの再設計**: SP セル最低 64px、できれば 72px。WCAG 2.5.5 完全準拠。
2. **二重凡例の解消**: タブごとに必要な凡例だけを表示。希望タブで「シフトステータス」は出さない、シフトタブで「希望種別」は出さない。
3. **凡例の情報密度最適化**: SP は折りたたみデフォルト閉、PC はインライン展開。アイコン付き（preferenceTheme.Icon を流用、L17 の成果物）。
4. **承認/却下の動線変更**: 24×24 のセル内ボタン廃止 → セルタップで詳細 BottomSheet を開く（既存 `allMemberPrefDate` フローに統合）。
5. **safe-area 対応**: sticky 追加ボタンが iPhone のホームインジケータに被らない。

### 1.3 完了条件
- SP / PC 両方で Playwright スクショで before/after 比較。
- 既存の店長機能（複数件表示、+N件、pendingCount バッジ）は維持。
- AuthContext / Convex 系の挙動変更なし（純 UI 改修）。

---

## 2. L18 + L20 統合判断

### 2.1 結論: **統合する（1 Loop で実施）**

### 2.2 根拠
| 観点 | 統合する | 別々にする |
|------|----------|-----------|
| 編集対象ファイル | `ShiftPreferenceCalendar.tsx` のみで凡例 + セル両方カバー | 同ファイルを 2 PR で触ると競合確実 |
| Reviewer 観点 | 「SP 体験トータルで改善されたか」を一度に検証可 | 1 回目は判定保留→2 回目で再検証となり工数増 |
| Playwright スクショ | SP × 1 枚、PC × 1 枚で完結 | 4 枚撮って差分追跡が必要 |
| ユーザー価値 | SP 体験が一気に改善 | L18 後・L20 前の中間状態がリリースされる |
| 影響範囲 | `ShiftPreferenceCalendar` + `PreferenceActionRow` (compact 撤去) + `ShiftPage` (凡例タブ条件) | 同上 + 余分な調整コミット |
| Loop 全体 | 残り 8 Loop → **7 Loop に短縮** | 短縮なし |

### 2.3 リスクと打ち消し
- **リスク**: 1 Loop が大きくなる → Engineer 並列度を 3 → **4** に上げて 1 人あたりの守備範囲を抑える。
- **リスク**: PreferenceActionRow.compact を撤去すると他箇所に影響 → 事前 grep で利用箇所は `ShiftPreferenceCalendar.tsx` の 1 箇所のみと確認済み（後述）。

---

## 3. 現状調査結果

### 3.1 既存資産（活用可能）
- ✅ `src/components/ui/BottomSheet.tsx` — focus trap / ESC / body scroll lock 完備。新規実装不要。
- ✅ `src/lib/preferenceTheme.ts` — `PREFERENCE_THEME_LIST` (preferred/available/unavailable) と各 `theme.Icon` を提供。L17 で確立済み。
- ✅ `src/components/Shift/ShiftPreferenceCalendar.tsx` 内で `STATUS_LEGEND` (pending/approved/rejected/modified/cancelled) ローカル定義済み。
- ✅ ShiftPage.tsx に既存の admin 用 BottomSheet (`allMemberPrefDate`) があるため、24×24 ボタン撤去後はそれにフォールバックさせるだけ。
- ✅ `BottomNav` / AppShell は既に `pb-[env(safe-area-inset-bottom)]` 対応済み。

### 3.2 確認済みの問題点
- **C1**: スタッフセル `aspect-square min-h-[44px] md:min-h-[56px]` → SP iPhone エミュレーションで実効 47px 程度。
- **C2**: `PreferenceActionRow.tsx` compact variant L160-185 の承認/却下ボタンが `w-6 h-6`（24×24px）。
- **A3**: 凡例は `flex flex-wrap` で 2 段並ぶ。`STATUS_LEGEND.map` (5 項目) と `PREFERENCE_THEME_LIST.map` または `memberEntries` がそれぞれ独立行で常時表示。タブに依存せず両方出る。
- **C5**: ShiftPage.tsx L782 の sticky 追加ボタンには `pb-[env(safe-area-inset-bottom)]` なし。

### 3.3 PreferenceActionRow.compact 利用箇所
- ✅ `ShiftPreferenceCalendar.tsx` L341 の 1 箇所のみ。撤去しても他に影響なし。
- ⚠️ 撤去ではなく「**承認/却下ボタンだけを compact から削除し、表示部分は残す**」方針とする（メンバー名・略称・テーマラベル・時刻表示は引き続き必要）。

### 3.4 タブ判定のフック点
- `ShiftPage.tsx` L49 `activeTab: 'shift' | 'preference' | 'leave'` 既存。
- カレンダー側は現状タブ非依存。**新規 prop `showStatusLegend?: boolean` を追加**してタブ側で制御するのがクリーン。

---

## 4. 改善方針（変更内容の総覧）

### 4.1 ShiftPreferenceCalendar.tsx
| # | 項目 | Before | After |
|---|------|--------|-------|
| 1 | スタッフセル高 | `aspect-square min-h-[44px] md:min-h-[56px]` | **`min-h-[64px] md:min-h-[72px]`** + `aspect-square` 撤去（縦が伸びることを許容） |
| 2 | grid gap | `gap-1.5` | **`gap-1 md:gap-1.5`**（SP のみ詰める） |
| 3 | フォーカスリング | 既存 `focus-ring` 維持 | 維持 |
| 4 | 凡例コンポーネント分離 | インライン JSX | **新規 `LegendCard` コンポーネント**に外出し（同ファイル内 or `src/components/Shift/CalendarLegend.tsx`） |
| 5 | 凡例の SP 折りたたみ | 常時展開 | **SP デフォルト閉**（「凡例を表示」ボタン）、開閉状態は `useState` ローカル。PC (`md:` 以上) は常時展開 |
| 6 | 凡例の二重同居 | `STATUS_LEGEND` + 種別 を両方常時 | **新規 prop `showStatusLegend` で制御**。希望タブから来たら `true`、シフトタブから来たら `false` |
| 7 | 凡例アイコン | 色ドット + ラベル | **`theme.Icon` (Star / CheckCircle2 / Ban) + 色ドット + ラベル**で視認性向上 |
| 8 | 店長セル内承認ボタン | `<PreferenceActionRow variant="compact">` で 24×24 ボタン表示 | **新規 variant `compact-readonly`** を追加、または `showActions` prop で制御。タップは親 `onDateClick` のみ受ける |

### 4.2 PreferenceActionRow.tsx
| # | 項目 | 変更内容 |
|---|------|---------|
| 1 | compact variant の承認/却下ボタン | **削除しない、prop `showInlineActions?: boolean`（デフォルト false）で制御**。`ShiftPreferenceCalendar` からは false で呼び出し。 |
| 2 | 状態表示（承認済/却下バッジ） | 維持 |
| 3 | full variant | **無変更** |

### 4.3 ShiftPage.tsx
| # | 項目 | 変更内容 |
|---|------|---------|
| 1 | `<ShiftPreferenceCalendar>` への prop 追加 | `showStatusLegend={canManageTenant && showAllMembersPrefs}`（店長視点では status 凡例を表示）。スタッフ自分視点では preference 凡例だけで十分 |
| 2 | sticky 追加ボタンの safe-area | `className` に **`pb-[calc(0.75rem+env(safe-area-inset-bottom))]`** を追記、または既存の `py-3` を `pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]` に分解 |
| 3 | 「+N件」タップ後動線 | 既存の `onDateClick` → `setAllMemberPrefDate(date)` を踏襲（24×24 ボタン廃止のフォールバック） |

### 4.4 凡例の二重同居解消マトリクス
| タブ | 視点 | preference 凡例（種別 3 項目） | status 凡例（5 項目） | メンバー色 |
|------|------|-------------------------------|---------------------|----------|
| 希望 | スタッフ自分 | ✅ 表示 | ❌ 非表示 | ❌ 非表示 |
| 希望 | 店長（全員モード） | ✅ 表示 | ✅ 表示 | ✅ 表示 |
| シフト | 全員 | （カレンダー対象外） | （対象外） | （対象外） |

---

## 5. コンポーネント設計（API）

### 5.1 `ShiftPreferenceCalendar` の新規 prop
```ts
interface ShiftPreferenceCalendarProps {
  // ... 既存 prop
  /** 状態凡例（pending/approved/...）を表示するか。店長視点で true。デフォルト false */
  showStatusLegend?: boolean;
  /** メンバー色凡例を表示するか（既に canManageTenant + memberNames で判定中。明示化のみ） */
  showMemberLegend?: boolean;
}
```

### 5.2 `CalendarLegend`（新規・同ファイル内 or 分離）
```ts
interface CalendarLegendProps {
  showPreferenceTypes: boolean;   // 種別 3 項目
  showStatuses: boolean;          // status 5 項目
  memberEntries: Array<[string, string]>;  // 店長視点のみ
  memberNames?: Map<string, string>;
}
// 内部: SP は折りたたみ閉デフォルト + 「凡例を表示 ▼」ボタン、md: 以上は常時展開
```

### 5.3 `PreferenceActionRow` の新規 prop
```ts
interface PreferenceActionRowProps {
  // ... 既存
  /** compact variant でセル内に承認/却下ボタンを出すか。デフォルト false */
  showInlineActions?: boolean;
}
```

### 5.4 BottomSheet は既存流用
- 新規作成しない。既存 `allMemberPrefDate` BottomSheet が承認/却下のフォールバック先。

---

## 6. タスク分割（並列度 4 / 1 Phase）

### Engineer A: ShiftPreferenceCalendar セル本体
- 対象: `src/components/Shift/ShiftPreferenceCalendar.tsx`
- 範囲:
  - スタッフセル: `aspect-square min-h-[44px] md:min-h-[56px]` → `min-h-[64px] md:min-h-[72px]`（aspect-square 撤去）
  - grid gap: `gap-1.5` → `gap-1 md:gap-1.5`
  - 店長セル: `min-h-[88px] lg:min-h-[120px]` は維持（既に十分）
  - セル内のフォントサイズや padding は既存維持（gap 縮小ぶんで余白確保）
- 期待動作: SP iPhone 14 (390px) で各セル 64px 以上、grid が画面幅にきちんと収まる

### Engineer B: 凡例の分離 + タブ別表示
- 対象: `src/components/Shift/ShiftPreferenceCalendar.tsx`（凡例 JSX を関数コンポーネント化）+ `src/pages/ShiftPage.tsx`（`showStatusLegend` prop 追加）
- 範囲:
  - `STATUS_LEGEND` をモジュールトップに残す
  - 凡例 JSX を `CalendarLegend` コンポーネントに切出し（同ファイル末尾 or `CalendarLegend.tsx` 新規）
  - 新規 prop `showStatusLegend` を追加。default `false`
  - 凡例の SP 折りたたみ（`useState(false)` + 「凡例 ▼」ボタン、`md:hidden` で SP のみ折りたたみ機構）
  - 凡例アイコンに `theme.Icon` 採用（preferred=Star, available=CheckCircle2, unavailable=Ban — preferenceTheme.ts に従う）
  - ShiftPage L627 の `<ShiftPreferenceCalendar ... />` 呼出しに `showStatusLegend={canManageTenant && showAllMembersPrefs}` を追加
- 期待動作:
  - 自分視点: 種別 3 項目だけが凡例に出る、SP は折りたたみ
  - 店長視点: 種別 + status + メンバー色が凡例に出る、SP は折りたたみ

### Engineer C: PreferenceActionRow compact ボタン制御
- 対象: `src/components/Shift/PreferenceActionRow.tsx` + `src/components/Shift/ShiftPreferenceCalendar.tsx`（呼び出し箇所）
- 範囲:
  - PreferenceActionRow に `showInlineActions?: boolean`（default false）を追加
  - compact variant の `{isPending && canManage && ( ... )}` ブロックを `{isPending && canManage && showInlineActions && ( ... )}` に変更
  - ShiftPreferenceCalendar L341 の compact 呼び出しは `showInlineActions` を渡さない（=false）
- 期待動作: セル内に承認/却下 24×24 ボタンが出ない。タップでセル全体の `onDateClick` が発火し既存の admin BottomSheet が開く

### Engineer D: sticky 追加ボタンの safe-area + スクショ
- 対象: `src/pages/ShiftPage.tsx` L782 周辺
- 範囲:
  - 既存 `className="lg:hidden sticky bottom-0 -mx-4 px-4 py-3 ..."` の `py-3` を `pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]` に変更
- スクショ計画:
  - PC: 1280×800、希望タブ・店長視点 → `playwright/screenshots/2026-04-28-loop18-pc.png`
  - SP: iPhone 14 Pro (393×852) エミュレーション、希望タブ・自分視点 → `playwright/screenshots/2026-04-28-loop18-sp.png`
- 期待動作: ホームインジケータ領域に被らない、stickyボタンが見切れない

---

## 7. 統合時の注意点

1. **編集ファイル競合**: A/B/C すべてが `ShiftPreferenceCalendar.tsx` を触る。**順序を A → B → C** にし、Engineer 間で逐次受け渡す（並列実装後に Tech Lead が手動マージするのは避ける）。
   - 実運用: A の diff を B が取り込み、B の diff を C が取り込む形で sequential PR にする。各 Engineer は assign された範囲のみ書く。
2. **PreferenceActionRow の compact API 変更**: `showInlineActions?: boolean` の default を **false** にすることで他箇所からの呼び出しが破壊されないことを保証。
3. **凡例の状態管理**: 折りたたみ open/close は localStorage に永続化**しない**（毎セッション初期は閉）。シンプル維持。
4. **A11y**: 凡例トグルボタンに `aria-expanded` 必須。アイコンには `aria-hidden="true"`。
5. **dark: ペア**: 凡例カードに dark 対応色を必ず付ける（L23 と整合）。

---

## 8. Reviewer 観点（集約 1 名）

| カテゴリ | チェック項目 |
|---------|------------|
| ターゲットサイズ | SP セル ≥ 64px、24×24 ボタン消失、sticky ボタン safe-area 対応 |
| 凡例制御 | 自分視点で status 凡例非表示、店長視点で全部表示、SP 折りたたみ動作 |
| 凡例アイコン | preferenceTheme.Icon が出ている、色ドット併記 |
| 既存機能維持 | +N件、pendingCount バッジ、empty state バナー、月送り、今月へ戻る |
| dark mode | 凡例カードの dark: ペア完備 |
| TypeScript | 新規 prop の型定義あり、`tsc --noEmit` 通過 |
| Build | `npm run build` 成功 |
| Playwright スクショ | PC 1 枚 + SP 1 枚、UI 崩れなし |

---

## 9. Playwright スクショ計画

```ts
// playwright/loop18.spec.ts（新規）
test('L18 PC desktop calendar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://localhost:5173/shift');
  // 希望タブ + 店長視点 + 全員
  await page.click('text=希望');
  await page.click('text=全員の希望');
  await page.screenshot({ path: 'playwright/screenshots/2026-04-28-loop18-pc.png', fullPage: false });
});

test('L18 SP iPhone calendar', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('http://localhost:5173/shift');
  await page.click('text=希望');
  // 自分視点（凡例 SP 折りたたみ確認）
  await page.screenshot({ path: 'playwright/screenshots/2026-04-28-loop18-sp.png', fullPage: false });
});
```

注意: SP 検証はロケータ困難なため、エミュレーションでスクショ撮影 1 枚のみ。動作確認は PC で十分（CSS による画面幅判定）。

---

## 10. dual push 計画

- newWorld リポジトリ: `master` に直接 commit
- kintai リポジトリ: `git subtree push --prefix=kintai kintai main`（feedback_dual_push.md 準拠）
- コミットメッセージ:
  ```
  feat(kintai): L18+L20 — カレンダーセル モバイル対応 + 凡例折りたたみ

  - スタッフセル min-h 44→64/56→72 (WCAG 2.5.5 準拠)
  - PreferenceActionRow.compact の 24x24 ボタン撤去 (showInlineActions prop)
  - 凡例コンポーネント分離 + SP 折りたたみ + アイコン化
  - 凡例の二重同居解消 (showStatusLegend prop でタブ別制御)
  - sticky 追加ボタン safe-area-inset-bottom 対応

  Closes #96 #98
  ```

---

## 11. 工数見積もり

| フェーズ | 担当 | 見積 |
|---------|------|------|
| Engineer A (セル本体) | GLM | 8 分 |
| Engineer B (凡例分離 + タブ別) | GLM | 18 分 |
| Engineer C (compact ボタン制御) | GLM | 8 分 |
| Engineer D (safe-area + Playwright スクショ) | GLM + Claude | 12 分 |
| Reviewer 集約 | GLM | 10 分 |
| Tech Lead 統合 + 承認 + dual push | Claude | 8 分 |
| **合計** | | **約 64 分（1 Loop）** |

L18 + L20 を別々に走らせると約 90 分（重複コスト約 26 分）→ **統合で 30% 短縮**。

---

## 12. Loop 全体への影響

| 項目 | Before | After |
|------|--------|-------|
| 残 Loop 数 | 8 (L18,19,20,21,22,23,24,25,26) | **7** (L18+20 統合により L20 単体消滅) |
| 短縮効果 | — | 約 30 分 + Reviewer/Tech Lead 1 回分 |
| 後続 Loop の依存 | L23 (dark: ペア) は本 Loop の凡例カードを採点対象に含める | 整合済 |
| L25 (a11y) との関係 | L18 で WCAG 2.5.5 を先に消化するため L25 のスコープが軽量化 | 良 |

---

## 13. 注意点 / 既知のリスク

- **リスク (低)**: スタッフセルの `aspect-square` を撤去すると縦長セルが出る可能性 → `gridAutoRows: '1fr'` のままなので等高は維持される。要 Reviewer 確認。
- **リスク (低)**: 凡例の SP 折りたたみで初回ユーザーが凡例の存在に気付かない可能性 → 「凡例を表示 ▼」ボタンに必ずラベル明示。
- **リスク (中)**: `showInlineActions` を false にすると店長が SP セル内で即座に承認できなくなる → 既に admin BottomSheet で 1 タップ先で対応可能なため許容。むしろ誤タップ防止になる UX 改善。
- **リスク (低)**: Playwright スクショの差分は人間レビュー必須 → Reviewer が目視確認。

---

## 14. 出力ファイル一覧（実装後）

| ファイル | 変更種別 |
|---------|---------|
| `kintai/src/components/Shift/ShiftPreferenceCalendar.tsx` | 修正 |
| `kintai/src/components/Shift/PreferenceActionRow.tsx` | 修正（prop 追加） |
| `kintai/src/pages/ShiftPage.tsx` | 修正（prop 渡し + safe-area） |
| `kintai/playwright/loop18.spec.ts` | 新規（任意） |
| `kintai/playwright/screenshots/2026-04-28-loop18-pc.png` | 新規 |
| `kintai/playwright/screenshots/2026-04-28-loop18-sp.png` | 新規 |

以上。Engineer 4 名（A/B/C/D）並列着手で進行する。
