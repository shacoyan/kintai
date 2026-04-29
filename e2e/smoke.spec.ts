import { test, expect } from '@playwright/test';

/**
 * kintai E2E セレクタ規約 (Loop 15 L15-7)
 * - フォーム入力: page.getByLabel(/ラベル/i)
 * - ボタン / リンク / heading: page.getByRole('button|link|heading', { name: /…/ })
 * - エラーメッセージ等の本文: page.getByText(/…/)
 * - 上記で取れない場合のみ data-testid を新規付与し getByTestId を使う
 * - locator(css) は最終手段。極力使わない。
 *
 * 詳細: kintai/STYLE.md §セレクタ規約
 */

// TopBar (テーマトグルボタン) は ProtectedRoute 配下の Layout でのみ表示されるため、
// 本ループでは localStorage seed による静的検証のみ実装する。
// トグルボタンクリックの動的 E2E は Loop 16 以降で認証後画面に対して実装予定 (L15-5)。
test.describe('kintai smoke', () => {
  test('ログイン画面が表示される', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /ログイン/i })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'メールアドレス' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'パスワード' })).toBeVisible();
  });

  test('light テーマ seed で html に dark class が付かない', async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('kintai_theme', 'light'); });
    await page.goto('/login');
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('dark テーマ seed で html に dark class が付く', async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('kintai_theme', 'dark'); });
    await page.goto('/login');
    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});
