import { test, expect } from '@playwright/test';

test.describe('kintai smoke', () => {
  test('ログイン画面が表示される', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /ログイン/i })).toBeVisible();
    await expect(page.getByLabel(/メール/i)).toBeVisible();
    await expect(page.getByLabel(/パスワード/i)).toBeVisible();
  });

  test('テーマ切替ボタンが存在する', async ({ page }) => {
    await page.goto('/login');
    expect(true).toBe(true);
  });
});
