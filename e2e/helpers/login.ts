import { Page, expect } from '@playwright/test';

/**
 * 指定した資格情報で kintai アプリにログインし、テナントを選択してセッションを確立します。
 * 1month テストなど複数アカウントを切り替える際に、テストごとに呼び出して使用します。
 *
 * @param page - Playwright の Page オブジェクト
 * @param email - ログイン用のメールアドレス
 * @param password - ログイン用のパスワード
 * @param tenantName - 選択するテナント名（ボタン名の部分一致で検索）
 * @throws {Error} 必須引数が空文字の場合、またはセッション確立に失敗した場合
 *
 * @example
 * ```ts
 * import { test } from '@playwright/test';
 * import { loginAs } from '../helpers/login';
 *
 * test('複数ユーザーでのテスト', async ({ page }) => {
 *   await loginAs(page, 'user1@example.com', 'password123', 'テスト企業A');
 *   // テスト操作...
 *
 *   // 別ユーザーとして再ログイン
 *   await loginAs(page, 'user2@example.com', 'password456', 'テスト企業B');
 *   // テスト操作...
 * });
 * ```
 */
export async function loginAs(
  page: Page,
  email: string,
  password: string,
  tenantName: string,
): Promise<void> {
  // 引数のバリデーション
  if (!email || !password || !tenantName) {
    throw new Error('[loginAs] email/password/tenantName required');
  }

  // ログインフォーム入力・送信
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'メールアドレス' }).fill(email);
  await page.getByRole('textbox', { name: 'パスワード' }).fill(password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.waitForURL(
    (url) => !url.pathname.startsWith('/login'),
    { timeout: 10_000 },
  );

  // テナント選択（別テナントの残存セッション対策として強制的に再選択）
  await page.goto('/tenant');
  const escapedTenantName = tenantName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('button', { name: new RegExp(escapedTenantName) }).first().click();
  await page.waitForURL(
    (url) => !url.pathname.startsWith('/tenant'),
    { timeout: 10_000 },
  );

  // localStorage に kintai_current_tenant が保存されるまで待機
  await page.waitForFunction(
    () => localStorage.getItem('kintai_current_tenant') !== null,
    { timeout: 5_000 },
  );

  // supabase セッション確立確認
  let sessionEstablished = false;
  await expect
    .poll(
      async () => {
        const token = await page.evaluate(async () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sb = (window as any).__kintai_supabase;
          if (!sb) return null;
          const { data } = await sb.auth.getSession();
          return data.session?.access_token ?? null;
        });
        if (token) {
          sessionEstablished = true;
        }
        return token;
      },
      { timeout: 5_000, intervals: [200, 500, 1000] },
    )
    .not.toBeNull();

  if (!sessionEstablished) {
    throw new Error('[loginAs] supabase session not established');
  }
}
