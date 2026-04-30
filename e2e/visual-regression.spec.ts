/**
 * @fileoverview 勤怠アプリ ビジュアルリグレッションテストスペック (認証必須ルート)。
 *               各画面×テーマごとにフルページ画像のスナップショットを検証する。
 *
 * 詳細:
 *   - .company/engineering/docs/2026-04-30-kintai-loop29-techdesign.md §4.4.5 (初版設計)
 *   - .company/engineering/docs/2026-04-30-kintai-loop40-techdesign.md §2 #4 (project 分離)
 *
 * 規則:
 * - baseline は `e2e/visual-regression.spec.ts-snapshots/` に commit する。
 * - baseline の更新は `npm run e2e:visual:update` で一括実行する。
 * - Playwright の `toHaveScreenshot` を用いて画像の差分を検出する。
 * - 動的要素（ユーザー情報・時刻など）は locator ベースの mask で中間グレー (`#808080`) 塗りつぶしを行う。
 * - フォントロードを document.fonts.ready で待機し（Noto Sans JP 遅延ロード対策）、
 *   アニメーションは reducedMotion エミュレートと disabled 設定で完全に抑制する。
 *
 * Project 分離 (Loop 40 #4):
 * - 認証必須 (chromium project, storageState 利用): `/`, `/history`, `/shift`, `/admin`
 * - 認証あり tenant 未選択 (chromium project + addInitScript で kintai_current_tenant 削除): `/tenant`
 * - 完全 anon (`chromium-anon` project, storageState 無し): `/login` → `visual-regression.anon.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test';

/** キャプチャ対象の認証必須ルート一覧 (tenant 選択済み前提) */
const ROUTES: readonly { readonly path: string; readonly name: string }[] = [
  { path: '/', name: 'dashboard' },
  { path: '/history', name: 'history' },
  { path: '/shift', name: 'shift' },
  { path: '/admin', name: 'admin' },
] as const;

/** 検証対象テーマ */
const THEMES = ['light', 'dark'] as const;

/** 動的要素マスク locator を生成 */
function buildDynamicMask(page: Page) {
  return [
    page.locator('[title*="@"]'), // user.email (title 属性)
    page.getByRole('time'), // <time> 要素全般
    page.locator('text=/\\d{1,2}:\\d{2}(:\\d{2})?/'), // HH:MM
    page.locator('text=/\\d{4}年\\d{1,2}月\\d{1,2}日/'), // 和暦日付
    page.locator('[data-dynamic="true"]'), // 将来用フック
  ];
}

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

      await expect(page).toHaveScreenshot(`${route.name}-${theme}.png`, {
        fullPage: true,
        animations: 'disabled',
        mask: buildDynamicMask(page),
        maskColor: '#808080',
      });
    });
  }
}

/**
 * `/tenant` (テナント選択画面) は認証済 + tenant 未選択の状態が必要。
 * storageState 利用の chromium project 上で、addInitScript で
 * `kintai_current_tenant` を削除した状態で goto する。
 */
test.describe('tenant select page (authenticated, tenant cleared)', () => {
  for (const theme of THEMES) {
    test(`visual: tenant (${theme})`, async ({ page }) => {
      // 1) 現在選択中のテナント情報を消す → /tenant へ留まる
      await page.addInitScript(() => {
        localStorage.removeItem('kintai_current_tenant');
      });
      // 2) テーマ seed
      await page.addInitScript((t: string) => {
        localStorage.setItem('kintai_theme', t);
      }, theme);

      await page.emulateMedia({ reducedMotion: 'reduce' });

      await page.goto('/tenant');
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);

      await expect(page).toHaveScreenshot(`tenant-${theme}.png`, {
        fullPage: true,
        animations: 'disabled',
        mask: buildDynamicMask(page),
        maskColor: '#808080',
      });
    });
  }
});
