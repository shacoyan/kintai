import { test as setup, expect } from '@playwright/test';

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

  // Loop 41 — supabase 公式 API (window.__kintai_supabase.auth.getSession()) で session を取得し、
  // localStorage キー命名への依存を解消する。dev/test 限定 export は src/lib/supabase.ts 参照。

  // 2. session が取得できるまで poll (最大 5 秒)
  await expect.poll(
    async () =>
      await page.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sb = (window as any).__kintai_supabase;
        if (!sb) return null;
        const { data } = await sb.auth.getSession();
        return data.session?.access_token ?? null;
      }),
    {
      message: '[auth.setup] Supabase session not available via window.__kintai_supabase',
      timeout: 5_000,
      intervals: [200, 500, 1000],
    },
  ).not.toBeNull();

  // poll 後に最終的な access_token を取得
  const finalAccessToken = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = (window as any).__kintai_supabase;
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session?.access_token ?? null;
  });
  if (!finalAccessToken) {
    throw new Error('[auth.setup] Supabase session disappeared after poll');
  }

  // 3. JWT exp チェック + console log (Buffer.from で Node 互換)
  try {
    const payload = JSON.parse(
      Buffer.from(finalAccessToken.split('.')[1], 'base64').toString('utf-8'),
    );
    const exp: number = payload.exp;
    const expIso = new Date(exp * 1000).toISOString();
    const remainingSec = exp - Math.floor(Date.now() / 1000);
    console.log(`[auth.setup] JWT exp: ${expIso} (remaining ${Math.floor(remainingSec / 60)} min)`);
    if (remainingSec < 30 * 60) {
      console.warn(`[auth.setup] WARNING: JWT remaining < 30 min (${Math.floor(remainingSec / 60)} min)`);
    }
  } catch (e) {
    console.warn('[auth.setup] failed to decode JWT:', e);
  }

  // ブラウザコンテキストのストレージ状態（Cookie や localStorage 等）を保存
  await page.context().storageState({ path: AUTH_FILE });
});
