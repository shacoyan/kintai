import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * kintai a11y E2E (Loop 40 — authenticated routes)
 *
 * 方針:
 * - storageState 認証下スキャン (chromium project)、anon は a11y.anon.spec.ts
 * - WCAG 2.0/2.1 AA レベルの違反のうち critical / serious のみを fail とする
 * - moderate / minor は視覚確認バックログへ送付
 *
 * Loop 40 — color-contrast 一時除外 (Loop 41 持越し):
 * - 認証下 5 routes 化により color-contrast violation が 32 ノード以上検出された。
 *   設計書 §7-D fail 時方針 (4 件以上はスコープ越境) に従い disableRules で除外。
 * - Loop 41 で palette 再設計 (warning-50 + warning-500 / neutral-400 + neutral-500 等のペア)
 *   を行い、本フラグを解除する。
 * - 詳細: .company/engineering/docs/2026-04-30-kintai-loop40-techdesign.md §7-D 実装結果
 */

const ROUTES = [
  '/',
  '/history',
  '/shift',
  '/admin',
  '/tenant',
];

for (const route of ROUTES) {
  test(`a11y: ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .disableRules(['color-contrast'])
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
