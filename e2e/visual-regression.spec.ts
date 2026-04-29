/**
 * @fileoverview 勤怠アプリ ビジュアルリグレッションテストスペック。
 *               各画面×テーマごとにフルページ画像のスナップショットを検証する。
 *
 * 詳細: .company/engineering/docs/2026-04-30-kintai-loop29-techdesign.md §4.4.5
 *
 * 規則:
 * - baseline は `e2e/visual-regression.spec.ts-snapshots/` に commit する。
 * - baseline の更新は `npm run e2e:visual:update` で一括実行する。
 * - Playwright の `toHaveScreenshot` を用いて画像の差分を検出する。
 * - 動的要素（ユーザー情報・時刻など）は locator ベースの mask で中間グレー (`#808080`) 塗りつぶしを行う。
 * - フォントロードを document.fonts.ready で待機し（Noto Sans JP 遅延ロード対策）、
 *   アニメーションは reducedMotion エミュレートと disabled 設定で完全に抑制する。
 */
import { test, expect } from '@playwright/test';

/** キャプチャ対象のルート一覧 */
const ROUTES: readonly { readonly path: string; readonly name: string }[] = [
  { path: '/', name: 'dashboard' },
  { path: '/history', name: 'history' },
  { path: '/shift', name: 'shift' },
  { path: '/admin', name: 'admin' },
  { path: '/tenant', name: 'tenant' },
  { path: '/login', name: 'login' },
] as const;

/** 検証対象テーマ */
const THEMES = ['light', 'dark'] as const;

for (const route of ROUTES) {
  for (const theme of THEMES) {
    test(`visual: ${route.name} (${theme})`, async ({ page }) => {
      // storageState の値より優先してテーマを seed する
      await page.addInitScript((t: string) => {
        localStorage.setItem('kintai_theme', t);
      }, theme);

      // アニメーション停止を fonts.ready の前に設定
      await page.emulateMedia({ reducedMotion: 'reduce' });

      await page.goto(route.path);
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);

      // 動的要素のマスク locator 定義
      const dynamicMask = [
        page.locator('[title*="@"]'), // user.email (title 属性)
        page.getByRole('time'), // <time> 要素全般
        page.locator('text=/\\d{1,2}:\\d{2}(:\\d{2})?/'), // HH:MM
        page.locator('text=/\\d{4}年\\d{1,2}月\\d{1,2}日/'), // 和暦日付
        page.locator('[data-dynamic="true"]'), // 将来用フック
      ];

      await expect(page).toHaveScreenshot(`${route.name}-${theme}.png`, {
        fullPage: true,
        animations: 'disabled',
        mask: dynamicMask,
        maskColor: '#808080',
      });
    });
  }
}
