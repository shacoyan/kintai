import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './helpers/login';
import { attachReporter, flushReport } from './helpers/reporter';
import { CALENDAR, PREF_FORM, ROUTES } from './helpers/selectors';
import { SHIFT_TEMPLATE, TEST_DATES_2026_05 } from './helpers/shift-data';

/**
 * 1ヶ月分 (2026-05-01 〜 2026-05-31) シフト希望提出 E2E。
 *
 * 3 スタッフ × 31 日 = 93 件をブラウザ実走で登録する。
 * - 各 spec は serial 実行 (mode: 'serial')。
 * - 各日付は reporter.step でラップし、失敗時は screenshot 取得 + reporter.error に
 *   記録した上で次の日付へ continue (テスト全体は中断しない)。
 * - 全 spec 完了後、Team C (1month-shift-approve.spec.ts) で承認フローを行う想定。
 *
 * @see ../../.company/engineering/docs/2026-05-07-kintai-1month-shift-e2e-techdesign.md (§6)
 */

test.describe.configure({ mode: 'serial' });

/**
 * 月ヘッダ表示を見ながら次月/前月ボタンを押し、目的の (year, month) まで遷移する。
 *
 * 月ヘッダは `<p class="tabular-nums">YYYY年M月</p>` 形式 (ShiftPreferenceCalendar)。
 * 24 回試行しても到達しない場合はエラー。
 */
async function navigateToMonth(page: Page, year: number, month: number): Promise<void> {
  for (let i = 0; i < 24; i++) {
    const heading = await page
      .locator('p.tabular-nums', { hasText: CALENDAR.monthHeadingPattern })
      .first()
      .innerText();
    const m = heading.match(CALENDAR.monthHeadingPattern);
    if (!m) break;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (y === year && mo === month) return;
    if (y * 12 + mo < year * 12 + month) {
      await page.getByRole('button', { name: CALENDAR.nextMonthButton.name }).click();
    } else {
      await page.getByRole('button', { name: CALENDAR.prevMonthButton.name }).click();
    }
    // カレンダー再描画待ち (アニメーション + データ fetch)
    await page.waitForTimeout(150);
  }
  throw new Error(`navigateToMonth ${year}-${month} failed`);
}

/**
 * 'YYYY-MM-DD' から該当日付セル (role=gridcell, aria-label='YYYY年M月D日 (曜)' 形式) を click。
 */
async function openDateCell(page: Page, dateStr: string): Promise<void> {
  const [yStr, mStr, dStr] = dateStr.split('-');
  const labelPrefix = CALENDAR.cellAriaLabelPrefix(Number(yStr), Number(mStr), Number(dStr));
  await page.locator(`[role="gridcell"][aria-label^="${labelPrefix}"]`).first().click();
}

for (const spec of SHIFT_TEMPLATE) {
  test(`${spec.staffEnv} が 31 日分のシフト希望を登録`, async ({ page }) => {
    const reporter = attachReporter(page, `${spec.staffEnv}-submit`);

    const emailEnvKey = `E2E_USER_${spec.staffEnv}_EMAIL` as const;
    const passwordEnvKey = `E2E_USER_${spec.staffEnv}_PASSWORD` as const;
    const email = process.env[emailEnvKey];
    const password = process.env[passwordEnvKey];
    if (!email || !password) {
      throw new Error(`Missing credentials: ${emailEnvKey} or ${passwordEnvKey}`);
    }
    const tenantName = process.env.E2E_TENANT_NAME ?? 'テスト株式会社';

    await loginAs(page, email, password, tenantName);

    await page.goto(ROUTES.shiftPreferenceTab);

    const grid = page.getByRole(CALENDAR.grid.role, { name: CALENDAR.grid.name });
    await expect(grid).toBeVisible({ timeout: 10_000 });

    await navigateToMonth(page, 2026, 5);

    let successCount = 0;
    let failCount = 0;
    const failedDates: string[] = [];

    for (const dateStr of TEST_DATES_2026_05) {
      try {
        await reporter.step(`submit ${dateStr}`, async () => {
          await openDateCell(page, dateStr);

          // 希望タイプボタン (id 指定)
          const typeButtonId = PREF_FORM.typeButtonId(spec.preferenceType);
          await page.locator(`#${typeButtonId}`).click();

          // 店舗 select は selectableStores が 1 件のみだと表示されない場合あり
          const storeSelectLocator = page.getByLabel(PREF_FORM.storeSelect.label, {
            exact: PREF_FORM.storeSelect.exact,
          });
          if ((await storeSelectLocator.count()) > 0) {
            await storeSelectLocator.selectOption({ label: spec.storeName });
          }

          // 開始/終了時刻
          await page
            .getByLabel(PREF_FORM.startTimeSelect.label, { exact: PREF_FORM.startTimeSelect.exact })
            .selectOption(spec.startTime);
          await page
            .getByLabel(PREF_FORM.endTimeSelect.label, { exact: PREF_FORM.endTimeSelect.exact })
            .selectOption(spec.endTime);

          // submit (新規 = "登録する" / 既存 = "上書きする" 両対応)
          const submitButton = page.getByRole('button', {
            name: PREF_FORM.submitButton.namePattern,
          });
          await submitButton.click();

          // submit ボタンが消えたら成功
          await expect(submitButton).toBeHidden({ timeout: 5_000 });
        });
        successCount++;
      } catch (err) {
        failCount++;
        failedDates.push(dateStr);
        const message = err instanceof Error ? err.message : String(err);
        reporter.error(`submit ${dateStr} failed: ${message}`);
        // モーダルが開いたままの可能性があるので Escape で閉じておく
        try {
          await page.keyboard.press('Escape');
        } catch {
          // ignore
        }
      }
    }

    const total = TEST_DATES_2026_05.length;
    const summary = `[${spec.staffEnv} submit summary] total=${total} success=${successCount} fail=${failCount}`;
    reporter.log(summary);
    // eslint-disable-next-line no-console
    console.log(summary);
    if (failedDates.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[${spec.staffEnv} failed dates] ${failedDates.join(', ')}`);
    }

    // 各 spec 終了時に最新のレポートを書き出し (entries はモジュールスコープ共有なので追記される)
    flushReport();
  });
}
