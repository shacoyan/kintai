import { test as setup } from '@playwright/test';

/**
 * 認証済みセッションをストレージ状態ファイルとして保存するセットアップ。
 * 依存テストは projects[].dependencies でこのファイルを指定することで、
 * ログイン処理をスキップしてブラウザコンテキストを再利用できます。
 */

const AUTH_FILE = 'e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;

  // 環境変数が未設定の場合はセットアップ全体をスキップ
  if (!email || !password) {
    setup.skip(true, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — auth fixture skipped');
  }

  // ログインページを開き、認証情報を入力して送信
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'メールアドレス' }).fill(email!);
  await page.getByRole('textbox', { name: 'パスワード' }).fill(password!);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();

  // ログイン完了（URL が /login 以外へ遷移）を待機
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 10_000 });

  // ブラウザコンテキストのストレージ状態（Cookie や localStorage 等）を保存
  await page.context().storageState({ path: AUTH_FILE });
});
