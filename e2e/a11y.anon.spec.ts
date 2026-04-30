import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * kintai a11y E2E — Loop 40 — anon route a11y (chromium-anon project)
 *
 * 方針:
 * - 未認証（匿名）でアクセス可能なルートのみを検証する
 * - WCAG 2.0/2.1 AA レベルの違反のうち critical / serious のみを fail とする
 * - moderate / minor は視覚確認バックログへ
 * - AxeBuilder は withTags のみ使用し、disableRules は行わない
 */

const ROUTES = [
  '/login',
];

for (const route of ROUTES) {
  test(`a11y (anon): ${route}`, async ({ page }) => {
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
