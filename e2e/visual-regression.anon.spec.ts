/**
 * @fileoverview 勤怠アプリ ビジュアルリグレッション (完全 anon) スペック。
 *               storageState を持たない `chromium-anon` project 上で動作し、
 *               未認証ユーザーのみアクセス可能なルート (`/login`) のスナップショットを検証する。
 *
 * 設計:
 *   - .company/engineering/docs/2026-04-30-kintai-loop40-techdesign.md §2 #4 (project 分離)
 *
 * Project ルーティング:
 *   - playwright.config.ts:
 *       projects[name='chromium']      → testIgnore: /.*\.anon\.spec\.ts/
 *       projects[name='chromium-anon'] → testMatch: [/smoke\.spec\.ts/, /.*\.anon\.spec\.ts/]
 *   - つまり本ファイルは storageState 無しの素のブラウザで実行される。
 *
 * baseline:
 *   - `e2e/visual-regression.anon.spec.ts-snapshots/` に commit。
 *   - 更新は `npm run e2e:visual:update`。
 */
import { test, expect, type Page } from '@playwright/test';

/** 完全 anon (storageState 無し) で撮影するルート */
const ANON_ROUTES: readonly { readonly path: string; readonly name: string }[] = [
  { path: '/login', name: 'login' },
] as const;

/** 検証対象テーマ */
const THEMES = ['light', 'dark'] as const;

/** 動的要素マスク locator を生成 (login 画面ではほぼ該当しないが念のため共通化) */
function buildDynamicMask(page: Page) {
  return [
    page.locator('[title*="@"]'),
    page.getByRole('time'),
    page.locator('text=/\\d{1,2}:\\d{2}(:\\d{2})?/'),
    page.locator('text=/\\d{4}年\\d{1,2}月\\d{1,2}日/'),
    page.locator('[data-dynamic="true"]'),
  ];
}

for (const route of ANON_ROUTES) {
  for (const theme of THEMES) {
    test(`visual (anon): ${route.name} (${theme})`, async ({ page }) => {
      // テーマ seed (anon でも localStorage は使える)
      await page.addInitScript((t: string) => {
        localStorage.setItem('kintai_theme', t);
      }, theme);

      await page.emulateMedia({ reducedMotion: 'reduce' });

      await page.goto(route.path);
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);

      await expect(page).toHaveScreenshot(`${route.name}-${theme}.png`, {
        fullPage: true,
        animations: 'disabled',
        mask: buildDynamicMask(page),
        maskColor: '#808080',
      });
    });
  }
}
