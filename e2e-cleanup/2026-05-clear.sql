-- =====================================================================
-- kintai 1ヶ月分 E2E テスト データクリア (2026-05-01 〜 2026-05-31)
--
-- 対象テナント: テスト株式会社 (786f041f-4d89-4d5e-bf1b-b4c23dd38b0c)
-- 対象期間   : 2026-05-01 〜 2026-05-31
--
-- ⚠ 必ず psql --single-transaction or DBeaver の transaction モードで実行
-- ⚠ tenant_id と date 範囲の二重 WHERE を絶対に削除しないこと
-- ⚠ Supabase MCP execute_sql で流す場合は確認のため SELECT 検証ブロックを残す
--
-- 使い方:
--   psql "$DATABASE_URL" --single-transaction -f e2e-cleanup/2026-05-clear.sql
-- =====================================================================

BEGIN;

-- 1. shift_preferences (テスト株式会社 + 5月の希望)
DELETE FROM public.shift_preferences
WHERE tenant_id = '786f041f-4d89-4d5e-bf1b-b4c23dd38b0c'
  AND date BETWEEN '2026-05-01' AND '2026-05-31';

-- 2. shifts (希望承認で生成された shifts)
DELETE FROM public.shifts
WHERE tenant_id = '786f041f-4d89-4d5e-bf1b-b4c23dd38b0c'
  AND date BETWEEN '2026-05-01' AND '2026-05-31';

-- 3. breaks (本テストでは打刻しないが、attendance_records 経由で念のため)
DELETE FROM public.breaks
WHERE attendance_id IN (
  SELECT id
  FROM public.attendance_records
  WHERE tenant_id = '786f041f-4d89-4d5e-bf1b-b4c23dd38b0c'
    AND date BETWEEN '2026-05-01' AND '2026-05-31'
);

-- 4. attendance_records
DELETE FROM public.attendance_records
WHERE tenant_id = '786f041f-4d89-4d5e-bf1b-b4c23dd38b0c'
  AND date BETWEEN '2026-05-01' AND '2026-05-31';

-- 5. notifications (シフト希望/承認関連のみ)
DELETE FROM public.notifications
WHERE tenant_id = '786f041f-4d89-4d5e-bf1b-b4c23dd38b0c'
  AND created_at >= '2026-05-01'
  AND type IN (
    'preference_unavailable_submitted',
    'shift_preference_submitted',
    'shift_approved',
    'shift_rejected'
  );

-- 6. 検証 SELECT (実行後の残件数を確認)
SELECT
  (SELECT COUNT(*)
   FROM public.shift_preferences
   WHERE tenant_id = '786f041f-4d89-4d5e-bf1b-b4c23dd38b0c'
     AND date BETWEEN '2026-05-01' AND '2026-05-31') AS shift_pref_remaining,
  (SELECT COUNT(*)
   FROM public.shifts
   WHERE tenant_id = '786f041f-4d89-4d5e-bf1b-b4c23dd38b0c'
     AND date BETWEEN '2026-05-01' AND '2026-05-31') AS shifts_remaining,
  (SELECT COUNT(*)
   FROM public.attendance_records
   WHERE tenant_id = '786f041f-4d89-4d5e-bf1b-b4c23dd38b0c'
     AND date BETWEEN '2026-05-01' AND '2026-05-31') AS attendance_remaining;

COMMIT;
