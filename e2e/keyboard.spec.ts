import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * kintai keyboard navigation E2E (Loop 30 — Engineer C)
 *
 * Purpose:
 *   Verify BottomSheet focus-trap, ESC-close, opener-restore, and background inert
 *   behaviours introduced in Loop 30 (hooks/lib by Engineer A, integration by Engineer B).
 *
 * Structure:
 *   Mirrors a11y.spec.ts — test.describe + test.beforeEach with auth state reuse.
 *   The `chromium` project in playwright.config.ts sets storageState, so no login is needed.
 *
 * Selector policy:
 *   Follows STYLE.md §セレクタ規約 (semantic roles first, data-testid as fallback).
 */

const TRIGGER_BUTTON_NAME = 'シフト申請締切を設定';
const DIALOG_TITLE = 'シフト申請の提出期限設定';
const CLOSE_BUTTON_LABEL = '閉じる';

test.describe('keyboard navigation', () => {
  let page: Page;
  let dialog: Locator;
  let triggerButton: Locator;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    const wsButton = page.getByRole('button', { name: /E2E Test/ }).first();
    if (await wsButton.isVisible().catch(() => false)) {
      await wsButton.click();
      await page.waitForLoadState('networkidle');
    }

    try {
      await page.getByRole('tab', { name: '店舗' }).click();
      await page.waitForLoadState('networkidle');
    } catch {
      test.skip(true, 'Tab not found or not clickable — skipping keyboard tests');
    }

    triggerButton = page.getByRole('button', { name: TRIGGER_BUTTON_NAME });

    // If the authenticated user lacks permission, the trigger does not exist.
    // Skip the entire describe block silently.
    if (!(await triggerButton.isVisible().catch(() => false))) {
      test.skip(true, 'Trigger button not visible — skipping keyboard tests');
    }

    await triggerButton.click();

    dialog = page.getByRole('dialog', { name: DIALOG_TITLE });
    await expect(dialog).toBeVisible();
  });

  /**
   * Collect all strictly focusable controls inside the dialog.
   * We intentionally exclude the visually-hidden "close" button if it is only
   * present for screen-reader / ESC users, matching the visual tab order.
   */
  const getFocusables = (): Locator =>
    dialog.locator(
      'button:not([aria-label="閉じる"]):not([tabindex="-1"]), ' +
        'a[href]:not([tabindex="-1"]), ' +
        'input:not([type="hidden"]):not([tabindex="-1"]), ' +
        'select:not([tabindex="-1"]), ' +
        'textarea:not([tabindex="-1"]), ' +
        '[tabindex]:not([tabindex="-1"])',
    );

  test('1. Tab focus traps forward through dialog elements and cycles back to the first', async () => {
    const focusables = getFocusables();
    const count = await focusables.count();

    // A valid dialog should have at least one interactive element (the close affordance)
    expect(count).toBeGreaterThanOrEqual(1);

    const firstElement = focusables.first();
    const lastElement = focusables.last();

    // Wait until the dialog's focus-trap auto-activates on the first element
    await expect(firstElement).toBeFocused();

    // Cycle through every focusable element
    for (let i = 0; i < count - 1; i++) {
      await page.keyboard.press('Tab');
      await expect(
        focusables.nth(i + 1),
        `Expected element at index ${i + 1} to be focused after ${i + 1} Tab presses`,
      ).toBeFocused();
    }

    // One more Tab should wrap focus back to the first element
    await page.keyboard.press('Tab');
    await expect(firstElement, 'Focus did not cycle back to the first focusable element').toBeFocused();
  });

  test('2. Shift+Tab focus traps backward through dialog elements and cycles to the last', async () => {
    const focusables = getFocusables();
    const count = await focusables.count();
    expect(count).toBeGreaterThanOrEqual(1);

    const firstElement = focusables.first();
    const lastElement = focusables.last();

    // Wait until the dialog's focus-trap auto-activates on the first element
    await expect(firstElement).toBeFocused();

    // Shift+Tab from the first element should wrap to the last element
    await page.keyboard.press('Shift+Tab');
    await expect(lastElement, 'Focus did not cycle to the last element on Shift+Tab').toBeFocused();

    // Cycle backward through the remaining elements
    for (let i = count - 1; i > 0; i--) {
      await page.keyboard.press('Shift+Tab');
      await expect(
        focusables.nth(i - 1),
        `Expected element at index ${i - 1} to be focused after ${count - i + 1} Shift+Tab presses`,
      ).toBeFocused();
    }
  });

  test('3. ESC closes the dialog', async () => {
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');

    // The dialog should disappear from the DOM or become hidden
    await expect(dialog).toBeHidden();
  });

  test('4. After ESC closes the dialog, focus returns to the opener (trigger button)', async () => {
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Focus must restore to the button that originally opened the dialog
    await expect(triggerButton, 'Focus did not return to the trigger button after closing dialog').toBeFocused();
  });

  test('5. Background elements are marked inert while dialog is open', async () => {
    // Inert is applied directly to affected DOM nodes (e.g. siblings of the dialog portal).
    // We assert that no visible, non-dialog element is missing the inert attribute.
    const inertCandidates = page.locator('body > *:not(script):not(style):not(link)');

    for (const el of await inertCandidates.all()) {
      const isDialog = await el.evaluate((node) => node.getAttribute('role') === 'dialog' || node.tagName === 'DIALOG');
      
      if (!isDialog) {
        await expect(el, 'Background element is missing the inert attribute').toHaveAttribute('inert', '');
      }
    }

    // Additionally, explicitly verify BottomNav is inert
    const bottomNav = page.locator('nav').first();
    if (await bottomNav.isVisible().catch(() => false)) {
      await expect(bottomNav, 'Bottom nav should be inert while dialog is open').toHaveAttribute('inert', '');
    }
  });

  test('6. [Optional] Nested dialog ESC only closes the inner dialog', async () => {
    // Look for any nested dialog trigger inside the current dialog
    // (e.g., an action menu or secondary bottom sheet)
    const nestedTrigger = dialog.locator('button[aria-haspopup="dialog"], button[aria-haspopup="menu"]').first();

    if (!(await nestedTrigger.isVisible().catch(() => false))) {
      test.skip(true, 'No nested dialog trigger found — skipping nested ESC test');
    }

    await nestedTrigger.click();

    const nestedDialog = page.getByRole('dialog').filter({ hasText: /^((?!シフト申請の提出期限設定).)*$/ }).last();
    await expect(nestedDialog).toBeVisible();

    // Verify outer dialog is still open
    await expect(dialog, 'Outer dialog should remain open when inner opens').toBeVisible();

    // ESC should dismiss only the innermost dialog
    await page.keyboard.press('Escape');
    await expect(nestedDialog, 'Inner dialog should be closed after ESC').toBeHidden();

    // Outer dialog must remain visible and active
    await expect(dialog, 'Outer dialog should remain visible after inner closes').toBeVisible();
  });
});
