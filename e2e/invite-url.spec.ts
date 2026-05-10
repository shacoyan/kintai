/**
 * @fileoverview kintai 招待URL機能 E2E spec — authenticated パート (Phase 4)
 *
 * 設計書: .company/engineering/docs/2026-05-10-kintai-invite-url-techdesign.md §7.1
 *
 * Project: chromium (storageState 前提 = ログイン済)
 *
 * カバレッジ:
 *  - 不正コードで /join → notFound 分岐 (codeInvalid) UI 検証
 *  - full DB flow (owner 発行 + staff join + 期限切れ + 上限到達 + 既メンバー)
 *    は環境変数 E2E_INVITE_URL_FULL=1 のときのみ実走。骨格のみ用意。
 *
 * full DB flow を実走する前提:
 *  - migration 044 が適用済 (zjjbfffhbobwwxyvdszl prod or dev branch)
 *  - e2e-cleanup/2026-05-invite-url-clear.sql で事前/事後クリーンアップ
 *  - E2E_STAFF_USER_EMAIL / E2E_STAFF_USER_PASSWORD などの追加 env が必要
 *
 * anon パート (storageState なし) は invite-url.anon.spec.ts に分離。
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// (1) authenticated 単体: 既存 storageState で /join に不正 code を投げると notFound
// ---------------------------------------------------------------------------
test.describe('kintai invite-url authenticated', () => {
  test('明らかに無効な code で /join を開くと「招待コードが無効です」が表示される', async ({ page }) => {
    // 実在しない 6 桁コード。preview lookup が NULL → notFound 分岐 UI へ
    await page.goto('/join?code=ZZZZZZ');
    await expect(page.getByRole('heading', { name: '招待コードが無効です' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// (2) full DB flow: 環境変数 E2E_INVITE_URL_FULL=1 のときのみ実走
// ---------------------------------------------------------------------------
test.describe('kintai invite-url full DB flow', () => {
  test.skip(
    process.env.E2E_INVITE_URL_FULL !== '1',
    'set E2E_INVITE_URL_FULL=1 to run full DB flow (requires migration 044 + seed)'
  );

  test('owner が招待URLを発行してコピーできる', async () => {
    // TODO(Loop+1): /admin → InviteCodeSettingsSection → 「招待URLを発行」ボタン
    //   → InviteUrlIssueModal で店舗複数選択 + 期限/上限指定 → 発行
    //   → URL 表示エリアに `/join?code=XXXXXX` 形式で表示されることを検証
    //   → コピーボタンで navigator.clipboard 経由のコピーを検証
  });

  test('未ログイン staff が /join URL を踏む → /login → ログイン後に /join 復帰 → 加入成功 → / へ遷移', async () => {
    // TODO(Loop+1): 別 browser context で実行
    //   - page.goto('/join?code=' + ownerが発行した code) → /login へ自動遷移
    //   - email/password で signIn → /join に復帰 → 表示名入力 → 「参加する」
    //   - / (Dashboard) に遷移し、tenant_members + store_members に行が追加されていることを
    //     Service Role キー or admin RPC で検証
  });

  test('期限切れ code で /join を踏むと「招待コードの有効期限が切れています」が表示される', async () => {
    // TODO(Loop+1): seed 済の expired code で /join → expired 分岐 UI 検証
  });

  test('使用上限到達 code で /join を踏むと「使用回数の上限に達しています」が表示される', async () => {
    // TODO(Loop+1): seed 済の max_uses 到達 code で /join → maxUsesReached 分岐 UI 検証
  });

  test('既メンバーが自テナントの /join URL を踏むと「すでに参加しています」が表示される', async () => {
    // TODO(Loop+1): storageState で既参加ユーザー → /join?code=自テナントのcode → alreadyMember 分岐
  });
});
