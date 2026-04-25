-- 020_store_id_not_null.sql
-- 目的: shifts.store_id / shift_preferences.store_id を NOT NULL 化
-- 前提: Phase 0 で本番 NULL 行 0 を確認済（2026-04-26）
-- ロールバック: ALTER TABLE ... ALTER COLUMN store_id DROP NOT NULL;

BEGIN;

-- 1. 念のため適用直前にも NULL 行が 0 であることを確認（あれば例外で停止）
DO $$
DECLARE
  shifts_null_count INTEGER;
  prefs_null_count INTEGER;
BEGIN
  SELECT count(*) INTO shifts_null_count FROM shifts WHERE store_id IS NULL;
  SELECT count(*) INTO prefs_null_count FROM shift_preferences WHERE store_id IS NULL;

  IF shifts_null_count > 0 THEN
    RAISE EXCEPTION 'shifts has % NULL store_id rows. Backfill required before NOT NULL.', shifts_null_count;
  END IF;

  IF prefs_null_count > 0 THEN
    RAISE EXCEPTION 'shift_preferences has % NULL store_id rows. Backfill required before NOT NULL.', prefs_null_count;
  END IF;
END $$;

-- 2. NOT NULL 制約付与
ALTER TABLE shifts ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE shift_preferences ALTER COLUMN store_id SET NOT NULL;

COMMIT;
