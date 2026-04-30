import { test as setup } from '@playwright/test';

/**
 * 認証済みセッションをストレージ状態ファイルとして保存するセットアップ。
 * 依存テストは projects[].dependencies でこのファイルを指定することで、
 * ログイン処理をスキップしてブラウザコンテキストを再利用できます。
 */

const AUTH_FILE = 'e2e/.auth/user.json';
const SUPABASE_TOKEN_KEY_PATTERN = /^sb-.+-auth-token$/;

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

  // Tenant selection 処理
  const tenantName = process.env.E2E_TENANT_NAME ?? 'E2E Test';
  if (tenantName === '') {
    setup.skip(true, 'no tenant configured');
  }

  const currentUrl = page.url();
  if (!currentUrl.includes('/tenant')) {
    await page.goto('/tenant');
  }

  await page.getByRole('button', { name: new RegExp(tenantName) }).first().click();
  await page.waitForURL((url) => !url.pathname.startsWith('/tenant'), { timeout: 10_000 });

  // 1. tenant 選択完了の堅牢な待機
  await page.waitForFunction(() =>
    localStorage.getItem('kintai_current_tenant') !== null,
    { timeout: 5000 }
  );

  const currentTenant = await page.evaluate(() => localStorage.getItem('kintai_current_tenant'));
  if (currentTenant === null) {
    throw new Error('Failed to set tenant: kintai_current_tenant is null');
  }

  // TODO(loop-41+): src 側に dev/E2E 限定の window.__kintai_supabase export を入れて
  // supabase.auth.getSession() 経由で取得するように移行する。
  // 現状は Supabase JS の localStorage キー命名 (sb-<ref>-auth-token) に依存しており fragility が残る。

  // 2. storageState 保存直前の assertion: Supabase auth token の存在確認
  const supabaseTokenKey = await page.evaluate((pattern: string) => {
    const re = new RegExp(pattern);
    const keys = Object.keys(localStorage);
    return keys.find(k => re.test(k)) ?? null;
  }, SUPABASE_TOKEN_KEY_PATTERN.source);
  if (!supabaseTokenKey) {
    throw new Error('[auth.setup] Supabase auth token not in localStorage');
  }

  // 3. JWT exp チェック + console log
  const tokenInfo = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      const session = JSON.parse(raw);
      const accessToken = session.access_token ?? session.currentSession?.access_token;
      if (!accessToken) return null;
      const payload = JSON.parse(atob(accessToken.split('.')[1]));
      return { exp: payload.exp, expIso: new Date(payload.exp * 1000).toISOString() };
    } catch { return null; }
  }, supabaseTokenKey);
  if (tokenInfo) {
    const remainingSec = tokenInfo.exp - Math.floor(Date.now() / 1000);
    console.log(`[auth.setup] JWT exp: ${tokenInfo.expIso} (remaining ${Math.floor(remainingSec/60)} min)`);
    if (remainingSec < 30 * 60) {
      console.warn(`[auth.setup] WARNING: JWT remaining < 30 min (${Math.floor(remainingSec/60)} min)`);
    }
  }

  // ブラウザコンテキストのストレージ状態（Cookie や localStorage 等）を保存
  await page.context().storageState({ path: AUTH_FILE });
});
