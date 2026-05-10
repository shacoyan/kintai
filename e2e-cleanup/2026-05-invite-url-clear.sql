-- =====================================================================
-- kintai 招待URL E2E full DB flow 用クリーンアップ SQL
--
-- 用途:
--   E2E_INVITE_URL_FULL=1 で invite-url.spec.ts の "full DB flow" describe を
--   実走する際の前後処理。テスト用に発行した招待コード由来のメンバー追加・
--   invite_code_stores 紐付けを巻き戻す。
--
-- 設計書: .company/engineering/docs/2026-05-10-kintai-invite-url-techdesign.md §7
--
-- 対象テナント: テスト株式会社 (786f041f-4d89-4d5e-bf1b-b4c23dd38b0c)
-- 対象 user: E2E 用 staff (E2E_STAFF_USER_EMAIL に対応する auth.users.id を E2E 側で指定)
--
-- 使い方:
--   psql "$DATABASE_URL" --single-transaction \
--     -v staff_user_id="'<UUID>'" \
--     -f e2e-cleanup/2026-05-invite-url-clear.sql
--
-- ⚠ 必ず --single-transaction で流す。tenant_id ガードは絶対に削除しないこと。
-- ⚠ migration 044 が適用されていない環境では invite_code_stores の DELETE が
--    "relation does not exist" でエラーになる。その場合は full DB flow 自体を
--    実走しない (E2E_INVITE_URL_FULL=1 を立てない) こと。
-- =====================================================================

\set ON_ERROR_STOP on

BEGIN;

-- 1. invite_code_stores: テスト用テナントの紐付けを全削除
--    (テスト前に固定 seed を再投入する想定)
DELETE FROM public.invite_code_stores
WHERE tenant_id = '786f041f-4d89-4d5e-bf1b-b4c23dd38b0c';

-- 2. store_members: テスト用 staff (UUID 引数) のテスト テナント所属行を削除
--    join_tenant_with_invite_v2 が SECURITY DEFINER で INSERT した行を巻き戻す
DELETE FROM public.store_members
WHERE member_id IN (
  SELECT id FROM public.tenant_members
  WHERE tenant_id = '786f041f-4d89-4d5e-bf1b-b4c23dd38b0c'
    AND user_id = :staff_user_id
);

-- 3. tenant_members: テスト用 staff のテスト テナント所属行を削除
DELETE FROM public.tenant_members
WHERE tenant_id = '786f041f-4d89-4d5e-bf1b-b4c23dd38b0c'
  AND user_id = :staff_user_id
  AND role = 'staff';  -- owner は決して消さない

-- 4. tenants.invite_code_used_count を 0 にリセット (再実行可能性確保)
UPDATE public.tenants
   SET invite_code_used_count = 0,
       invite_code_expires_at = NULL,
       invite_code_max_uses   = NULL
 WHERE id = '786f041f-4d89-4d5e-bf1b-b4c23dd38b0c';

-- 5. 検証 SELECT (実行後の残件数を確認)
SELECT
  (SELECT COUNT(*)
     FROM public.invite_code_stores
    WHERE tenant_id = '786f041f-4d89-4d5e-bf1b-b4c23dd38b0c') AS invite_code_stores_remaining,
  (SELECT COUNT(*)
     FROM public.tenant_members
    WHERE tenant_id = '786f041f-4d89-4d5e-bf1b-b4c23dd38b0c'
      AND user_id = :staff_user_id
      AND role = 'staff') AS test_staff_member_remaining,
  (SELECT invite_code_used_count
     FROM public.tenants
    WHERE id = '786f041f-4d89-4d5e-bf1b-b4c23dd38b0c') AS used_count_after;

COMMIT;
