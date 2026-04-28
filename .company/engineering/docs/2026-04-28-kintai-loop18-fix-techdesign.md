# Loop 18 Fix — P0 緊急修正設計書（SW キャッシュ + SP sticky 重なり）

- 日付: 2026-04-28
- 起案: Tech Lead
- 関連タスク: #106 (P0-1 SW), #107 (P0-2 sticky)
- 関連: Design Reviewer による Vercel Production (shahu-kintai.vercel.app) L18+L20 反映後検証 (#105)
- 緊急度: P0（既存ユーザー全員白画面 / SP 新規希望追加動線断絶）

---

## 1. 背景・問題サマリ

L18 + L20 統合 Loop を Vercel Production にデプロイ後、Design Reviewer の検証で以下 2 件の P0 が発覚。両件ともユーザー操作を直接ブロックするため、Loop 19 以降の通常フローに割り込んで即時修正する。

### P0-1: Service Worker キャッシュ戦略の破綻

- 症状: 既存ユーザーが新デプロイ後の URL を開くと真っ白画面。Console は `index-a-op4FiY.js` / `index-4Wjvu1kM.css` の 404。
- 根本原因: `kintai/public/sw.js` は `index.html` と `/` を `cache-first` でプリキャッシュしている。Vite ビルド成果物のハッシュは毎デプロイで変わるため、旧 HTML がキャッシュから返る → そこに記述された旧ハッシュ JS/CSS を要求 → 404 → 画面が組み立てられず白画面。
- 影響範囲: 既存 SW を install 済みの全ユーザー（つまり一度でもアクセスしたユーザー全員）。新規ユーザーは影響を受けない。
- 暫定回避: SW unregister + `caches` 削除 + リロード。これを毎デプロイ手動でやるのは現実的でないため恒久対応必須。

### P0-2: SP 追加ボタンが BottomNav に隠れる

- 症状: SP 393×852（iPhone 14 Pro 想定）でシフトページの「本日の希望を追加・編集」 sticky ボタンが、画面下部固定の BottomNav に完全に潜って押下不可。
- 根本原因（複合）:
  1. `kintai/src/pages/ShiftPage.tsx` L783 の sticky バーが `z-10` ＋ `bottom-0`。
  2. `kintai/src/components/layout/AppShell.tsx` L43 の BottomNav は `fixed bottom-0 h-16 z-30`。
  3. sticky バー側に `bottom-16` のオフセットがないため、BottomNav と完全に重なる位置に張り付く。
  4. **ブレイクポイント不整合**: BottomNav は `md:hidden`（< 768px で表示）、sticky バーは `lg:hidden`（< 1024px で表示）。768〜1023px では sticky だけ存在し BottomNav は無いが、それ以外（< 768px = まさに SP）では両方存在し重なる。
- 影響範囲: SP 全幅レンジ（< 768px）の全ユーザー。新規シフト希望追加の主要動線が機能不全。

---

## 2. P0-1 修正方針（Service Worker）

### 2.1 戦略

| リソース種別 | 戦略 | 理由 |
|---|---|---|
| ナビゲーション (`request.mode === 'navigate'` または HTML document) | **network-first**（fail 時のみキャッシュ fallback） | HTML は常に最新を取得し、新ハッシュ参照を確実にする |
| `/assets/*`（Vite 出力のハッシュ付き JS/CSS/画像） | **cache-first**（取れたらキャッシュへ put） | ハッシュで URL がユニークなので長期キャッシュ安全。高速化に寄与 |
| Supabase REST/Auth（`/rest/`, `/auth/`） | network-only（既存維持、fail で cache.match） | 既存挙動を温存 |
| その他 (`favicon`, `manifest.json`, `sw.js` 自身など) | network-first | 安全側 |

### 2.2 必須要件

1. **`CACHE_NAME` を `kintai-v2` にバンプ**（旧 `kintai-v1` を強制 invalidate）。
2. **`activate` イベントで旧キャッシュを `caches.delete`**（既存にあるが `kintai-v2` 基準で再評価）。
3. **`self.skipWaiting()` + `self.clients.claim()`**: 新 SW 即時有効化。既存ユーザーがリロード 1 回で復旧できるようにする。
4. **navigation fetch の network-first は `fetch` 失敗時のみ `caches.match('/index.html')` にフォールバック**（オフライン時の最低限の体験維持）。
5. **`/assets/*` は cache-first ＋ stale-while-revalidate 風に「キャッシュヒット返しつつ裏で更新」しない**。シンプルに「キャッシュにあれば返す、無ければ fetch して put」で十分（ハッシュで一意のため stale 概念がない）。
6. **`sw.js` 自身は SW ランタイムが特別扱いするのでキャッシュ対象外**（fetch ハンドラ内で URL.pathname === '/sw.js' は `return;` で素通り）。

### 2.3 実装シグネチャ（Engineer GLM 用）

ファイル: `kintai/public/sw.js`（全面書き換え）

```js
const CACHE_NAME = 'kintai-v2';
const ASSET_CACHE = 'kintai-assets-v2';
const NAV_FALLBACK = '/index.html';

// install: NAV_FALLBACK のみプリキャッシュ（オフライン用）
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.add(NAV_FALLBACK))
  );
  self.skipWaiting();
});

// activate: 旧バージョンの kintai-* を全削除
self.addEventListener('activate', (event) => {
  const keep = new Set([CACHE_NAME, ASSET_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('kintai-') && !keep.has(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // sw.js 自身は素通り
  if (url.pathname === '/sw.js') return;

  // Supabase API は network-only（既存挙動温存）
  if (url.pathname.includes('/rest/') || url.pathname.includes('/auth/')) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // ナビゲーション (HTML) は network-first
  const isNavigation = req.mode === 'navigate'
    || (req.headers.get('accept') || '').includes('text/html');
  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // index.html を更新キャッシュ
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(NAV_FALLBACK, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(NAV_FALLBACK))
    );
    return;
  }

  // /assets/* は cache-first（ハッシュ付きで一意）
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  // その他は network-first
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});
```

### 2.4 ロールアウト時の留意

- 既存ユーザーは「新デプロイ → 1 回目のロード時に旧 SW が動き旧 HTML を返す → 真っ白」のままだが、新 SW が install＋activate＋clients.claim する瞬間に caches が clear されるため、**「リロード 1 回で復旧」**となる。これは現状（手動 SW 解除）より大幅改善。
- 念のため Production リリース直後にユーザーへ「Cmd/Ctrl+R でリロードしてください」と Slack アナウンスする運用フォロー（PM 連携）。
- 将来検討: 502 や stale を完全に防ぐなら Workbox 導入だが、今回の P0 修正範囲では対象外。

---

## 3. P0-2 修正方針（SP sticky 重なり）

### 3.1 修正内容

ファイル: `kintai/src/pages/ShiftPage.tsx` L783 付近

変更前:
```tsx
<div className="lg:hidden sticky bottom-0 -mx-4 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] bg-white/95 dark:bg-neutral-900/95 backdrop-blur border-t border-neutral-200 dark:border-neutral-700 z-10">
```

変更後（diff の意図）:
```tsx
<div className="md:hidden sticky bottom-16 -mx-4 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] bg-white/95 dark:bg-neutral-900/95 backdrop-blur border-t border-neutral-200 dark:border-neutral-700 z-20">
```

修正点 3 つ:

| 項目 | Before | After | 理由 |
|---|---|---|---|
| ブレイクポイント | `lg:hidden` (< 1024) | `md:hidden` (< 768) | BottomNav と整合。768〜1023px では PC 同等の単独ボタン配置に戻し sticky は使わない（タブレット領域は通常レイアウトで操作可能） |
| 縦位置 | `bottom-0` | `bottom-16` | BottomNav h-16 ぶんを避ける |
| z-index | `z-10` | `z-20` | BottomNav `z-30` の下、本文の通常 `z-10` 要素より上 |

### 3.2 副作用と確認

- `pb-[calc(env(safe-area-inset-bottom)+0.75rem)]` は維持。`bottom-16` で BottomNav 上端に張り付くので、ボタン本体側の safe-area パディングはそのまま下端余白として正しく機能する（BottomNav 自体が safe-area を内包している前提を AppShell 側で確認する必要あり。後述の Reviewer 観点に追加）。
- `lg:hidden` → `md:hidden` の変更で 768〜1023px (タブレット縦) における sticky バーが消える。この帯域では「カレンダー本文末尾の通常ボタン」が露出するレイアウト前提。**タブレット帯域に通常ボタンが既に存在するか Engineer が現地確認**。無い場合は二択:
  - (A) 通常ボタンを `hidden md:block lg:hidden` で復活させる
  - (B) sticky を `lg:hidden` のまま残し、`md:bottom-0 bottom-16` のように BP ごとにオフセット切替（768 以上は BottomNav 無いので bottom-0 で OK）

→ **採用案: (B)**。理由は実装が局所完結し、リグレッションリスクが低いため。最終的なクラス案:

```tsx
<div className="lg:hidden sticky bottom-16 md:bottom-0 -mx-4 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] bg-white/95 dark:bg-neutral-900/95 backdrop-blur border-t border-neutral-200 dark:border-neutral-700 z-20">
```

- `lg:hidden` 維持（< 1024px で表示）
- `bottom-16` を基本、`md:bottom-0` で 768px 以上（BottomNav 不在）は底に戻す
- `z-20`

### 3.3 既存パディング

`-mx-4 px-4 pt-3` 等は維持。既存の見た目・タップ領域を変えない。

---

## 4. Engineer 分割

**Engineer 1 名（A）に連続実装**。理由:

- 変更ファイル 2 つ・差分極小（sw.js 全面書き換え + ShiftPage 1 行）
- 並列化のオーバーヘッド（コンフリクトリスク・レビュー往復）が利得を上回る
- 緊急 P0 のため最短経路で本番反映を優先

**Engineer A タスク内訳（順次）:**

1. `kintai/public/sw.js` を §2.3 のシグネチャで全面書き換え
2. `kintai/src/pages/ShiftPage.tsx` L783 のクラス文字列を §3.2 採用案 (B) に置換
3. `pnpm build` (kintai 配下) でビルド成功を確認
4. 変更差分を `git diff` で提示

---

## 5. Reviewer 観点（集約 Reviewer 1 名）

### sw.js
- [ ] `CACHE_NAME` が `kintai-v2` に上がっているか
- [ ] navigation の判定に `req.mode === 'navigate'` と `accept: text/html` の OR が入っているか
- [ ] navigation 失敗時に `caches.match(NAV_FALLBACK)` でフォールバックするか
- [ ] `/assets/*` が cache-first で、`res.ok` を見て put しているか（5xx をキャッシュしない）
- [ ] `activate` で `kintai-` プレフィックスの旧キャッシュが削除され、`clients.claim()` が呼ばれるか
- [ ] `skipWaiting()` が `install` 内に存在するか
- [ ] GET 以外は早期 return しているか
- [ ] `/sw.js` 自身を fetch ハンドラから除外しているか
- [ ] Supabase REST/Auth の既存挙動が壊れていないか

### ShiftPage.tsx
- [ ] `bottom-16 md:bottom-0` の組合せになっているか
- [ ] `z-20` であり `z-10` のままになっていないか
- [ ] `lg:hidden` を維持し、PC で sticky が出ないか
- [ ] safe-area の pb 計算が温存されているか
- [ ] 周辺の sticky/fixed 要素と新たな重なりが発生していないか（特に Toast/Dialog）

### 横断
- [ ] `pnpm build` 成功
- [ ] BottomNav 自体が safe-area を内包しているか（`AppShell.tsx` L43 周辺確認）。していない場合は別タスク化（本 P0 修正には含めない）

---

## 6. 検証計画

### 6.1 ローカル
1. `cd kintai && pnpm build && pnpm preview`
2. Chrome DevTools Application → Service Workers → 旧 SW（v1）を確認
3. ページロード → 新 SW (v2) install + activate を確認、`Caches` に `kintai-v2` / `kintai-assets-v2` が出現、旧 `kintai-v1` が消えること
4. DevTools → Network → throttle Offline で reload → `/index.html` がキャッシュから返り画面が描画されること

### 6.2 Vercel Preview
- PR を切って Preview デプロイ → モバイルエミュレータ 393×852 で sticky バーが BottomNav 上にきれいに乗ること
- 別プレビュー URL に再デプロイし、リロード 1 回で白画面にならないこと（旧プレビュー → 新プレビュー間で SW がどう振る舞うか）

### 6.3 Production 検証（Design Reviewer 再実施）
Playwright スクショ再取得（#105 のシナリオ流用）:
- Desktop 1280×800: sticky バー非表示・通常ボタン表示
- Tablet 820×1180 (md 帯): sticky バーが `bottom-0` に出ること
- Mobile 393×852 (sm 帯): sticky バーが BottomNav の上 (bottom-16) に出ること、押下可能
- Console エラーゼロ
- Network: `/assets/*` は SW 経由 (200 from ServiceWorker)、`/index.html` は network-first

成果物: `kintai/.company/design/reviews/2026-04-28-loop18-fix-verify/` 配下にスクショと所見

---

## 7. dual push 計画

1. `newWorld` リポで sw.js + ShiftPage.tsx の 2 ファイルをコミット
2. メッセージ案: `fix(kintai): P0 — SW を network-first 化 + SP sticky を BottomNav 上に退避`
3. `git push origin master`
4. **kintai 単独リポは subtree push**（メモリ `project_kintai_loop_b_done.md` 参照）:
   - `git subtree push --prefix=kintai kintai main`
   - 失敗時は `git subtree split --prefix=kintai HEAD` → 一時ブランチ → `git push kintai <split>:main` のフォールバック
5. Vercel が kintai/main を検知して Production デプロイ
6. デプロイ完了後 PM へ Slack 文面案を渡し、ユーザーへ「Cmd/Ctrl+R リロード推奨」アナウンス

---

## 8. ロールバック計画

- sw.js: `kintai-v1` 戻しは厳禁（再発するため）。問題が出た場合は新たに `kintai-v3` を切って fix-forward
- ShiftPage.tsx: 1 行差分なので revert 容易

---

## 9. 完了条件 (DoD)

- [ ] sw.js 書き換え + ビルド成功
- [ ] ShiftPage.tsx クラス変更 + ビルド成功
- [ ] Reviewer 集約レビュー approved
- [ ] Tech Lead 最終承認
- [ ] dual push (newWorld + kintai/main) 完了
- [ ] Vercel Production デプロイ完了
- [ ] Design Reviewer Playwright 再検証で P0 2 件解消確認
- [ ] タスク #106, #107 を completed に更新

---

## Appendix: 参考メモ

- BottomNav 定義: `kintai/src/components/layout/AppShell.tsx` L43
  ```
  className="md:hidden fixed bottom-0 inset-x-0 h-16 border-t ... z-30"
  ```
- 影響を受ける sticky 行: `kintai/src/pages/ShiftPage.tsx` L781-L783
- 既存 sw.js: 891 bytes / 30 行 / 2026-04-15 作成
- 直近の関連: `0557f9f fix(kintai): P0 本番復旧 — SPA rewrite を assets/api/拡張子除外に修正` — Vercel 側 rewrite 修正は完了済み。今回の SW は別レイヤの問題。
