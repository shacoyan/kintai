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
