# kintai E2E (Playwright スモーク)

## ローカル実行

```bash
npm run e2e:install        # 初回のみ
npm run dev                # 別ターミナルで開発サーバー起動
npm run e2e:smoke          # smoke テスト実行
```

## 本格的なシナリオテスト

login → tenant 作成 → 招待コード発行 → join → clock-in → history 表示 等は
staging 環境とテスト用 Supabase project を別途用意してから拡張する (Loop 14+)。

## L29 ビジュアルリグレッション

### 通常実行（baseline と比較）
```bash
npm run e2e:visual
```
diff があると fail し、`playwright-report/` に actual / expected / diff の 3 枚が出力されます。

### baseline 更新（意図的に変更した場合のみ）
```bash
npm run e2e:visual:update
```
- 12 枚すべてが上書きされます
- **必ず PR の diff で「期待される視覚変更」かレビュアー確認**してください
- L30 以降の UI 改修で baseline 更新が必要な場合、設計書側で明示する

### mask 対象
- 時刻 / 日付の文字列
- `user.email`
- `<time>` 要素
- `data-dynamic="true"` 属性（将来追加用フック）

詳細: `.company/engineering/docs/2026-04-30-kintai-loop29-techdesign.md`
