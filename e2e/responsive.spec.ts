/**
 * @fileoverview 勤怠アプリ レスポンシブビジュアルリグレッションテストスペック。
 *               各画面×ビューポートごとにフルページ画像のスナップショットを検証する。
 *
 * 詳細: .company/engineering/docs/2026-04-30-kintai-loop35-techdesign.md §3.1
 *
 * 規則:
 * - baseline は `e2e/responsive.spec.ts-snapshots/` に commit する。
 * - baseline の更新は `npm run e2e:visual:update` で一括実行する。
 * - Playwright の `toHaveScreenshot` を用いて画像の差分を検出する。
 * - 動的要素（ユーザー情報・時刻など）は locator ベースの mask で中間グレー (`#808080`) 塗りつぶしを行う。
 * - フォントロードを document.fonts.ready で待機し（Noto Sans JP 遅延ロード対策）、
 *   アニメーションは reducedMotion エミュレートと disabled 設定で完全に抑制する。
 * - 横方向のスクロール（オーバーフロー）が発生していないか追加で検証する。
 */

import { test, expect } from '@playwright/test';

/** キャプチャ対象のビューポート一覧 */
const VIEWPORTS = [
  { name: 'sm', width: 375, height: 667 },
  { name: 'md', width: 768, height: 1024 },
  { name: 'lg', width: 1024, height: 768 },
  { name: 'xl', width: 1440, height: 900 },
] as const;

/** キャプチャ対象のルート一覧 (visual-regression.spec.ts の 6 ルート + reset-password) */
const ROUTES: readonly { readonly path: string; readonly name: string }[] = [
  { path: '/', name: 'dashboard' },
  { path: '/history', name: 'history' },
  { path: '/shift', name: 'shift' },
  { path: '/admin', name: 'admin' },
  { path: '/tenant', name: 'tenant' },
  { path: '/login', name: 'login' },
  { path: '/auth/reset-password', name: 'reset-password' },
] as const;

for (const viewport of VIEWPORTS) {
  for (const route of ROUTES) {
    test(`responsive: ${route.name} (${viewport.name})`, async ({ page }) => {
      // ビューポートサイズの設定
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

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

      // フルページスクリーンショットの検証
      await expect(page).toHaveScreenshot(`${route.name}-${viewport.name}.png`, {
        fullPage: true,
        animations: 'disabled',
        mask: dynamicMask,
        maskColor: '#808080',
      });

      // 横方向 overflow 検出（documentElement.scrollWidth - clientWidth）
      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth - document.documentElement.clientWidth;
      });
      expect(
        overflow,
        `horizontal overflow detected on ${route.name} @ ${viewport.name} (${viewport.width}x${viewport.height}): ${overflow}px`,
      ).toBeLessThanOrEqual(1);
    });
  }
}
