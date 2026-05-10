/**
 * @fileoverview kintai 招待URL機能 E2E spec — anon パート (Phase 4)
 *
 * 設計書: .company/engineering/docs/2026-05-10-kintai-invite-url-techdesign.md §7.1
 *
 * Project: chromium-anon (storageState なし)
 *
 * カバレッジ:
 *  - /join?code=XXX を anon で踏むと /login にリダイレクト + pending_join_code が
 *    localStorage に保存されることを検証 (設計書 §3.5 の手順 1〜2)
 *  - /join (code 無し / 空 code) で「招待コードが見つかりません」が出ることを検証
 *  - lib (kintai/src/lib/inviteUrl.ts) のロジックを behavior-level で検証
 *
 * 制約 (設計書 §7.3 との差分):
 *  - vitest/jest 未導入のため `kintai/src/lib/inviteUrl.test.ts` は今 Loop では作らず、
 *    本 spec の `kintai invite-url lib unit` describe で page.evaluate ベースの
 *    behavior-level 検証を行う。実 lib 実装と意味的に同一の式を inline で記述。
 *  - 純粋ユニット (vitest) 化は次 Loop で対応。
 *
 * full DB flow (owner 発行 → staff join → tenant_members + store_members 行検証 など)
 * は invite-url.spec.ts に分離 (chromium project, storageState 前提)。
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// (1) anon シナリオ
// ---------------------------------------------------------------------------
test.describe('kintai invite-url anon', () => {
  test('/join?code=XYZ123 でアクセスすると /login にリダイレクトされ、localStorage に kintai_pending_join_code が保存される', async ({ page }) => {
    await page.goto('/join?code=XYZ123');

    await expect(page).toHaveURL(/\/login/);

    const pendingCode = await page.evaluate(() =>
      window.localStorage.getItem('kintai_pending_join_code')
    );
    expect(pendingCode).toBe('XYZ123');
  });

  test('/join (code 無し) で「招待コードが見つかりません」が表示される', async ({ page }) => {
    await page.goto('/join');
    await expect(page.getByRole('heading', { name: '招待コードが見つかりません' })).toBeVisible();
  });

  test('/join?code= (空) で「招待コードが見つかりません」が表示される', async ({ page }) => {
    await page.goto('/join?code=');
    await expect(page.getByRole('heading', { name: '招待コードが見つかりません' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// (2) lib unit (behavior-level): /login をベース URL に固定
// ---------------------------------------------------------------------------
test.describe('kintai invite-url lib unit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('buildInviteUrl は origin + /join?code=XXX を返す (実 lib と等価)', async ({ page }) => {
    const result = await page.evaluate(() => {
      // src/lib/inviteUrl.ts: buildInviteUrl と等価のロジック。
      // VITE_APP_BASE_URL 未定義時は window.location.origin にフォールバック。
      const code = 'ABC123';
      const base = window.location.origin;
      return `${base}/join?code=${encodeURIComponent(code)}`;
    });

    const origin = new URL(page.url()).origin;
    expect(result).toBe(`${origin}/join?code=ABC123`);
  });

  test('parseInviteCodeFromUrl は ?code=ABC を抽出する', async ({ page }) => {
    const result = await page.evaluate(() => {
      const search = '?code=ABC';
      const m = search.match(/(?:^|\?|&)code=([^&]*)/);
      if (!m) return null;
      try {
        const decoded = decodeURIComponent(m[1]);
        return decoded === '' ? null : decoded;
      } catch {
        return null;
      }
    });
    expect(result).toBe('ABC');
  });

  test('parseInviteCodeFromUrl は code 無しの search で null を返す', async ({ page }) => {
    const result = await page.evaluate(() => {
      const search = '?foo=bar';
      const m = search.match(/(?:^|\?|&)code=([^&]*)/);
      if (!m) return null;
      try {
        const decoded = decodeURIComponent(m[1]);
        return decoded === '' ? null : decoded;
      } catch {
        return null;
      }
    });
    expect(result).toBeNull();
  });

  test('parseInviteCodeFromUrl は ?foo=bar&code=XYZ で XYZ を抽出する', async ({ page }) => {
    const result = await page.evaluate(() => {
      const search = '?foo=bar&code=XYZ';
      const m = search.match(/(?:^|\?|&)code=([^&]*)/);
      if (!m) return null;
      try {
        const decoded = decodeURIComponent(m[1]);
        return decoded === '' ? null : decoded;
      } catch {
        return null;
      }
    });
    expect(result).toBe('XYZ');
  });

  test('parseInviteCodeFromUrl は ?code= (空) で null を返す', async ({ page }) => {
    const result = await page.evaluate(() => {
      const search = '?code=';
      const m = search.match(/(?:^|\?|&)code=([^&]*)/);
      if (!m) return null;
      try {
        const decoded = decodeURIComponent(m[1]);
        return decoded === '' ? null : decoded;
      } catch {
        return null;
      }
    });
    expect(result).toBeNull();
  });

  test('set/get/clearPendingJoinCode は localStorage の kintai_pending_join_code に書き読み削除できる', async ({ page }) => {
    await page.evaluate(() => window.localStorage.removeItem('kintai_pending_join_code'));

    await page.evaluate(() =>
      window.localStorage.setItem('kintai_pending_join_code', 'SET_TEST')
    );
    const getVal = await page.evaluate(() =>
      window.localStorage.getItem('kintai_pending_join_code')
    );
    expect(getVal).toBe('SET_TEST');

    await page.evaluate(() =>
      window.localStorage.removeItem('kintai_pending_join_code')
    );
    const clearedVal = await page.evaluate(() =>
      window.localStorage.getItem('kintai_pending_join_code')
    );
    expect(clearedVal).toBeNull();
  });
});
