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
 * Loop 41 — color-contrast 解除済:
 * - tailwind.config.js の warning/info/neutral palette を WCAG AA 4.5:1 達成値へ再設計し、
 *   disableRules(['color-contrast']) を撤去。認証下 5 routes + anon /login で color-contrast 違反 0 件。
 * - 詳細: .company/engineering/docs/2026-04-30-kintai-loop41-techdesign.md §2
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
