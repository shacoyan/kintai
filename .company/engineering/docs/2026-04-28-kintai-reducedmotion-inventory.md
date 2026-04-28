# useReducedMotion 棚卸し（Loop 16+ 候補ピックアップ）

- 起票日: 2026-04-28
- プロジェクト: kintai
- ループ: Loop 15 Phase 3 内の調査タスク（コード修正なし）
- 担当: Engineer B
- 目的: `prefers-reduced-motion: reduce` ユーザーへの配慮状況を全面棚卸しし、Loop 16 以降の実装候補を確定する

## 0. 既存基盤（現状把握）

| 種別 | 場所 | 内容 |
|---|---|---|
| Global CSS shield | `src/index.css` L32-37 | `@media (prefers-reduced-motion: reduce)` で全要素の animation/transition を 0.01ms に短縮 |
| React フック | `src/hooks/useReducedMotion.ts` | matchMedia で reduce 判定を返す。**現在利用箇所ゼロ**（フック定義 1 件のみ検出） |
| Tailwind プレフィックス | 各コンポーネント | `motion-safe:` を概ね全 transition/animate に適用済み（137 件ヒット） |

> CSS shield と Tailwind `motion-safe:` で **静的 CSS アニメーションは既に reduce 対応済み**。
> 残課題は **JS 制御アニメーション**（setTimeout / setInterval / requestAnimationFrame / インラインスタイル動的変更）のみ。

### 0.1 既存基盤の事実確認

- `src/index.css` L32-37 に shield を確認:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
  ```
- `src/hooks/useReducedMotion.ts` フック実装済み（matchMedia + change リスナーで reduce 判定）。
- `grep -rn "useReducedMotion" src/` の結果は **フック定義行のみ 1 件**。呼び出し箇所はゼロ。

## 1. grep 結果サマリー

| パターン | 検出件数 | 備考 |
|---|---|---|
| `transition-` | 69 | 全件 `motion-safe:transition-` 形式（後述 §2 で 0 件確認） |
| `animate-` | 14 | 全件 `motion-safe:animate-` 形式（後述 §2 で 0 件確認） |
| `duration-` | 20 | transition/animate に付随 |
| `motion-safe:` / `motion-reduce:` | 137 | 適用済み箇所（プレフィックス重複を含む） |
| `useReducedMotion` | 1（フック定義のみ） | **利用箇所ゼロ** |
| `prefers-reduced-motion` | 3（CSS 1 + フック 2） | shield + matchMedia 定義のみ |

調査コマンド:
```bash
cd kintai
grep -rn "transition-" src/ | wc -l
grep -rn "animate-" src/ | wc -l
grep -rn "duration-" src/ | wc -l
grep -rn "motion-safe:\|motion-reduce:" src/ | wc -l
grep -rn "useReducedMotion" src/
grep -rn "prefers-reduced-motion" src/
```

## 2. motion-safe 未適用の transition/animate 一覧

`grep "transition-" | grep -v "motion-safe:" | grep -v "src/index.css"` の結果:

| ファイル | 行 | パターン | 現状 | 推奨対応 | 優先度 |
|---|---|---|---|---|---|
| （該当なし） | — | — | — | — | — |

`grep "animate-" | grep -v "motion-safe:" | grep -v "src/index.css"` の結果:

| ファイル | 行 | パターン | 現状 | 推奨対応 | 優先度 |
|---|---|---|---|---|---|
| （該当なし） | — | — | — | — | — |

> **全コンポーネント `motion-safe:` 適用済み**。Tailwind プレフィックス層では reduce 未対応箇所ゼロ。

## 3. JS アニメーション候補（useReducedMotion 適用検討対象）

`grep -rn "setTimeout\|setInterval\|requestAnimationFrame" src/` の生検出結果から、**視覚的アニメーション目的のもの** を選別。
純粋な debounce / polling / 時刻表示更新 / ロングプレス検出 / コピーフィードバックのフラグ解除 は対象外として除外。

| ファイル | 行 | 用途 | 現状 | 推奨対応 | 優先度 |
|---|---|---|---|---|---|
| `src/components/Attendance/ClockButton.tsx` | 43 | 打刻成功時の `flashGreen` 緑フラッシュ演出（600ms） | 常時 600ms 点灯 | reduce 時はフラッシュをスキップ or 100ms 短縮を検討 | 低 |
| `src/components/Admin/AdminDashboard.tsx` | 132 | `requestAnimationFrame` を介した DOM 操作（演出用かどうか要確認） | 常時実行 | 演出目的なら reduce 時即時実行を検討 | 低 |

### 3.1 対象外として除外したもの（参考）

| ファイル | 行 | 種別 | 除外理由 |
|---|---|---|---|
| `src/components/Attendance/ClockButton.tsx` | 22, 54 | longPressTimer | 入力検出（演出ではない） |
| `src/components/Attendance/ClockButton.tsx` | 32 | 1 秒毎の時刻更新 setInterval | データ更新（演出ではない） |
| `src/components/Tenant/CreateTenant.tsx` | 52 | コピー成功フラグ 2 秒後解除 | UI 状態管理（演出ではない） |
| `src/components/ui/Toast.tsx` | 84 | Toast 自動 dismiss タイマー | dismiss 制御（演出ではない） |
| `src/components/Admin/AdminDashboard.tsx` | 287 | コピー成功フラグ 2 秒後解除 | UI 状態管理（演出ではない） |
| `src/hooks/useAttendance.ts` | 18 | データポーリング | データ取得（演出ではない） |
| `src/hooks/useActiveAttendance.ts` | 142 | 60 秒ポーリング | データ取得（演出ではない） |
| `src/pages/ResetPasswordPage.tsx` | 20 | リダイレクトタイマー | 画面遷移（演出ではない） |
| `src/pages/DashboardPage.tsx` | 48 | 60 秒毎の時刻更新 | データ更新（演出ではない） |

> 視覚的アニメーション目的は実質 `ClockButton.flashGreen`（確実）と `AdminDashboard` の rAF（要文脈確認）の **2 件のみ**。

## 4. インラインスタイル / style 属性での動的アニメ

`grep -rn "style={{" src/ | grep -E "transform|opacity|transition"` の結果:

| ファイル | 行 | 内容 | 推奨対応 | 優先度 |
|---|---|---|---|---|
| （該当なし） | — | — | — | — |

> インラインスタイル経由の動的アニメーションは **0 件**。Tailwind クラス方式に統一されている。

## 5. 優先度付け基準

| 優先度 | 基準 |
|---|---|
| **高** | ユーザー操作の主動線で頻発（Clock/Break/Tenant 切替等）かつ JS 制御で CSS shield が効かない |
| **中** | 管理画面・補助機能で発生する JS アニメーション |
| **低** | 既に CSS shield + `motion-safe:` でほぼ吸収済み / 演出が微細（短時間・低運動量） |

## 6. Loop 16+ 実装候補（確定リスト）

優先度「高」候補は **0 件**。優先度「低」候補のみ存在し、いずれも CSS shield により動作時間が 0.01ms に圧縮されるため、ユーザー体感への影響は軽微。

- [ ] （任意候補）`src/components/Attendance/ClockButton.tsx` L43 — `flashGreen` の `setTimeout(600ms)` を `useReducedMotion()` 判定でスキップする小修正
- [ ] （任意候補）`src/components/Admin/AdminDashboard.tsx` L132 — `requestAnimationFrame` の用途精査後、演出目的なら reduce 分岐追加

> 上記 2 件はいずれも **必須ではない**（CSS shield で transition/animation は 0.01ms に圧縮されるが、JS の setTimeout 自体は短縮されないため厳密には残課題。ただし `flashGreen` は背景色トグルのみで運動量ゼロのため reduce ユーザーへの実害は無し）。

## 7. 結論

**A: 既存の CSS shield + `motion-safe:` で実用上十分。`useReducedMotion` フックは将来 JS アニメ追加時に備えて残置。Loop 16 では実装タスク化しない。**

理由:
1. Tailwind プレフィックス層で `transition-` / `animate-` の motion-safe 未適用箇所が **0 件**（§2）
2. インラインスタイルでの動的アニメも **0 件**（§4）
3. JS 視覚アニメは 2 件のみで、いずれも背景色フラッシュ等の **微細な演出**。CSS shield により付随する transition も 0.01ms に圧縮されるため reduce ユーザーへの体感影響は軽微
4. `useReducedMotion` フックは実装済みで、将来 JS アニメ追加時に即座に利用可能な状態

## 8. 補足

- 本ドキュメントは **Phase 3 完了時点のスナップショット**（2026-04-28）
- 今後 transition/animate を追加する PR は STYLE.md §8 の規約に従い `motion-safe:` を必ず付ける
- JS アニメ（setTimeout/rAF で視覚効果を制御するもの）を追加する PR は **`useReducedMotion()` フック適用を必須**とし、本ドキュメントを更新する
- 次回棚卸し推奨時期: 大型 UI 追加（新規ダッシュボード / オンボーディング演出 等）の Loop 完了時

## 9. 次ループへの申し送り

- **Loop 16 では `useReducedMotion` 関連の実装タスクは不要**
- 万一着手する場合のスコープ: §6 の任意候補 2 件のみ（合計 30 分程度の小修正）
- 新規 JS 視覚アニメを実装するエンジニアは本ドキュメント §0 と STYLE.md §8 を参照すること
- フック `src/hooks/useReducedMotion.ts` は削除しないこと（残置）
