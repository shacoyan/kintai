# kintai 本番デプロイ復旧 (P0)

- **発行日**: 2026-04-28
- **発行者**: Tech Lead
- **優先度**: P0 (本番完全停止)
- **対象プロジェクト**: kintai (https://shahu-kintai.vercel.app/)
- **直前の正常 SHA (master)**: `a95b7f7`（=現 HEAD。ロールバック先候補は同 SHA で `vercel.json` を旧版に戻すか、Vercel ダッシュボードから 1 デプロイ前の Production を Promote）

---

## 1. 症状

| 項目 | 観測値 |
|---|---|
| `/` | 200, `text/html`, index.html 正常返却 |
| `/assets/index-DOJIjaY7.js`（HTML が参照する実体） | **200 だが `content-type: text/html` で index.html を返却** |
| `/assets/<存在しないファイル>.js` | **200 + index.html**（=fallback が暴走） |
| `/icon-192.png` | **200 + index.html**（しかも `public/` に元ファイル不在） |
| ブラウザ | `Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"` → 真っ白 |

**結論**: ビルド/デプロイは届いているが、Vercel の rewrite が**全リクエストを index.html にすり替えている**ため、`<script type="module">` がアセットを取得できず SPA が起動しない。

---

## 2. 根本原因

### 2-1. 主因 — `vercel.json` の SPA fallback が広すぎる

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

**問題点**:
- Vercel の rewrites 評価順序は「filesystem → rewrites」が原則だが、`source: "/(.*)"` のような**全捕捉パターンに正規表現群を含めると Vercel のルーティング層で filesystem より優先扱い**となるケースがあり（`content-disposition: inline; filename="index.html"` が全パスで返る挙動と一致）、`/assets/*.js` まで index.html にすり替わる。
- 実害: モジュール JS の MIME mismatch で SPA が一切起動しない。

### 2-2. 副因 — PWA アイコンが存在しない

- `public/manifest.json` は `/icon-192.png` `/icon-512.png` を参照
- `public/` 実体: `manifest.json`, `sw.js` のみ（PNG 不在）
- 主因解消後も manifest 警告が継続するため同時に解決する。

### 2-3. なぜ今まで動いていたのか（推測）

- `bdd1623 fix(kintai): SPA フォールバック設定追加（vercel.json）` 投入後、tenant route 初回アクセス時の 404 は解消したように見えていたが、本来 `assets/*` は filesystem hit すべきところを Vercel 側のルール変更/評価順変更で巻き込まれた可能性。
- いずれにせよ「除外パターンを書いていない」のが構造上の欠陥。

---

## 3. 修正方針

### 3-1. `kintai/vercel.json` を SPA-safe な形に書き換え

**修正後（採用案）**:

```json
{
  "rewrites": [
    {
      "source": "/((?!assets/|api/|.*\\.).*)",
      "destination": "/index.html"
    }
  ]
}
```

**意図**:
- `assets/` で始まるパスは rewrite しない（=filesystem 配信）
- `api/` で始まるパスは rewrite しない（将来のサーバレス用予約）
- **任意の `.` を含むパス**（`favicon.ico`, `manifest.json`, `icon-192.png`, `sw.js` など拡張子付き全般）は rewrite しない
- それ以外（`/`, `/admin`, `/tenant`, `/shift/2026-04-28` 等の React Router 経路）のみ index.html へフォールバック

**代替案（不採用）**: `cleanUrls: true` + `trailingSlash`、`headers` で MIME を強制、など複数あるが、最小差分・実績パターンとして上記 negative lookahead を採用。

### 3-2. PWA アイコン欠損の解消

選択肢を提示し、Engineer に **(B) を採用させる**（最小工数で警告解消）:

- (A) 192/512 PNG を新規生成して `public/` に配置 → デザイン作業発生
- (B) **manifest.json の icons 配列を空にするか、既存の SVG/favicon に差し替えて 404 を消す**（採用）
- (C) manifest.json 自体を削除（PWA 機能放棄）

**採用 (B) の具体案**:

```json
{
  "name": "勤怠管理 - Kintai",
  "short_name": "勤怠",
  "description": "勤怠管理・シフト管理アプリ",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1e40af",
  "theme_color": "#1e40af",
  "orientation": "portrait",
  "icons": []
}
```

将来 Art Director がアイコンを納品し次第、`icons` を埋め直す（別タスク化、本 P0 では対応しない）。

### 3-3. その他の確認結果

- `vite.config.ts`: `base` 未指定 = デフォルト `/` で問題なし。`build.outDir` も未指定 = デフォルト `dist` で `vercel.json` 暗黙の `outputDirectory` (Vite preset) と整合。**変更不要**。
- `package.json` の `build`: `tsc && vite build` 正常、ローカル dist 生成済み確認済。**変更不要**。
- `index.html`: `<script type="module" src="/src/main.tsx"></script>` は dev 専用。`vite build` で `/assets/index-XXX.js` に置換されているため**変更不要**。

---

## 4. チーム割り当て

**並列度: 1 (Engineer A 単独)** — 変更は 2 ファイルかつ依存関係単純、分割の旨味なし。

### Engineer A 担当

| ファイル | 操作 | 内容 |
|---|---|---|
| `kintai/vercel.json` | 上書き | 上記 §3-1 の JSON に置き換え |
| `kintai/public/manifest.json` | 上書き | 上記 §3-2 の JSON に置き換え（`icons: []`） |

**禁止事項**:
- `vite.config.ts` 触らない
- `package.json` 触らない
- `index.html` 触らない
- `dist/` を git に commit しない（.gitignore 済み）
- 新規 PNG 等のバイナリ追加禁止

---

## 5. 検証手順

Engineer A → Reviewer の順で実施。

### 5-1. ローカル検証 (Engineer A)

```bash
cd kintai
npm run build           # tsc 型エラー無し + dist 生成成功
ls dist/assets/         # JS/CSS が出ていること
npm run preview         # http://localhost:4173 で起動 → / と /admin が真っ白でないこと
```

### 5-2. デプロイ前確認 (Reviewer)

- `git diff kintai/vercel.json kintai/public/manifest.json` が**期待 diff のみ**であること
- 他ファイル変更なし
- `vercel.json` の正規表現を実際にテスト:
  - `/` → match (rewrite される: 期待動作)
  - `/admin` → match (rewrite)
  - `/shift/2026-04-28` → match (rewrite)
  - `/assets/index-XXX.js` → no match (filesystem) ✓
  - `/manifest.json` → no match (filesystem, ドット含む) ✓
  - `/sw.js` → no match (ドット含む) ✓

### 5-3. 本番デプロイ後検証 (Tech Lead 最終承認時)

```bash
# ビルドハッシュは本番 HTML から動的取得
HASH=$(curl -s https://shahu-kintai.vercel.app/ | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
echo "Latest hash: $HASH"

curl -sI "https://shahu-kintai.vercel.app/assets/$HASH" | grep -i 'content-type'
# 期待: content-type: application/javascript（または text/javascript）

curl -sI https://shahu-kintai.vercel.app/manifest.json | grep -i 'content-type'
# 期待: application/json または application/manifest+json

curl -sI https://shahu-kintai.vercel.app/icon-192.png | head -3
# 期待: 404（manifest 側で参照を消したので呼ばれないはずだが filesystem は 404 を返す = OK）
```

最後にブラウザ（または Playwright）で:
- https://shahu-kintai.vercel.app/ にアクセス
- DevTools Console に MIME エラーが**出ない**こと
- ログイン画面 (or root) が描画されること
- `/admin` `/tenant` への直接アクセスでも index.html が返り SPA 起動すること

---

## 6. ロールバックプラン

### Plan A — Vercel ダッシュボード即時復元 (RTO < 1 分)

修正デプロイで悪化した場合、Vercel Dashboard → Deployments → **直前の Production デプロイを "Promote to Production"**。これで即座に現状復帰（=ただし現状自体が壊れているので意味は薄い、Plan B 推奨）。

### Plan B — vercel.json を空 rewrites に戻す (RTO < 5 分)

```json
{ "rewrites": [] }
```

を commit & push。`/` `/assets/*` は filesystem で 200、ただし `/admin` 等の React Router 経路は直接アクセスで 404 になる（=ブックマーク経由が壊れるが、トップから操作する分には起動する）。**P0 緊急避難として最低ライン稼働を確保**。

### Plan C — git revert

```bash
cd kintai
git revert <修正コミット SHA> --no-edit
git push origin master
git subtree push --prefix=kintai kintai-remote main   # dual push
```

---

## 7. 推定所要時間

| フェーズ | 担当 | 時間 |
|---|---|---|
| Engineer A 実装 | Engineer (GLM) | 5 分 |
| ローカル `npm run build` + preview 確認 | Engineer | 5 分 |
| Reviewer 集約レビュー | Reviewer (GLM) | 5 分 |
| Tech Lead 統合 + 承認 | Tech Lead | 3 分 |
| commit + dual push (newWorld + kintai/main) | 秘書 | 2 分 |
| Vercel 自動デプロイ完了待ち | — | 約 2 分 |
| 本番検証 (curl + ブラウザ) | Tech Lead | 3 分 |
| **合計** | | **約 25 分** |

---

## 8. 完了条件 (DoD)

- [ ] `kintai/vercel.json` が §3-1 の内容に更新されている
- [ ] `kintai/public/manifest.json` の icons が空配列に更新されている
- [ ] ローカル `npm run build` が成功する
- [ ] ローカル `npm run preview` で `/`, `/admin` が真っ白でない
- [ ] Vercel 本番デプロイが Ready
- [ ] 本番 `/assets/index-*.js` の `content-type` が `application/javascript`
- [ ] 本番ブラウザで Console にモジュール MIME エラーが出ない
- [ ] React Router 直接アクセス (`/admin` 等) で SPA が起動する
- [ ] newWorld + kintai/main の両方に push 済み

---

## 9. 後続タスク（本 P0 スコープ外、別チケット化推奨）

- PWA アイコン (192/512 PNG) を Art Director に発注し manifest 復元
- `vercel.json` の rewrite 正規表現を CI でユニットテスト化（regression 防止）
- `vercel.json` 変更時の必須 review チェックリスト整備
