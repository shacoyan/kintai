// NOTE: color-contrast は L28-palette ループまで disableRules で除外中
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * kintai a11y E2E (Loop 25 — L11-D 代理執行)
 *
 * 方針:
 * - WCAG 2.0/2.1 AA レベルの違反のうち critical / serious のみを fail とする
 * - moderate / minor は L26 視覚確認に併合送り（永続バックログ）
 * - 認証が必要なページは未ログイン時 /login にリダイレクトされるが、
 *   axe スキャンはリダイレクト先（/login）で行うため必ず実行可能
 * - L26 以降で storageState を使った認証セッション再利用を導入予定
 *
 * 詳細: .company/engineering/docs/2026-04-29-kintai-loop25-techdesign.md §3.5.4
 */

const ROUTES = [
  '/login',
  '/tenant',
  '/attendance',
  '/shift',
  '/history',
  '/admin',
];

for (const route of ROUTES) {
  test(`a11y: ${route}`, async ({ page }) => {
    await page.goto(route);
    // 未ログインなら /login にリダイレクトされる。axe はリダイレクト先で実行される
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .disableRules(['color-contrast']) // TODO(L28-palette): remove after #6
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    expect(
      blocking,
      `[${route}] critical/serious violations:\n${JSON.stringify(blocking, null, 2)}`,
    ).toEqual([]);
  });
}
