/**
 * @fileoverview 勤怠アプリ ビジュアルリグレッション用スクリーンショット収集スペック。
 *               各画面×テーマごとにフルページ画像を `tmp/l26-screenshots/` へ保存する。
 *
 * 詳細: .company/engineering/docs/2026-04-29-kintai-loop26-techdesign.md §4.4.5
 *
 * 規則:
 * - expect(page).toHaveScreenshot() は使わない（baseline 不在で初回必ず fail する）
 * - 純粋な page.screenshot() でファイル保存のみ → Reviewer / Tech Lead が目視確認
 * - フォントロードを document.fonts.ready で待機（Noto Sans JP 遅延ロード対策）
 * - tmp/l26-screenshots/ は .gitignore 対象
 */
import { test } from '@playwright/test';

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

      await page.goto(route.path);
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);

      await page.screenshot({
        path: `tmp/l26-screenshots/${route.name}-${theme}.png`,
        fullPage: true,
      });
    });
  }
}
