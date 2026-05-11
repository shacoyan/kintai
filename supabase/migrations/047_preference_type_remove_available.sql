-- ============================================================
-- Migration: 047_preference_type_remove_available.sql
-- Purpose  : shift_preferences.preference_type から 'available' を削除し、
--            既存の 'available' レコードを 'preferred' に変更する。
-- Owner Dir: status / start_time / end_time は保持（NULL 許容のまま）。
-- ============================================================

BEGIN;

-- ============================================================
-- 【参考】事前件数確認 SQL（実行前に別セッションで確認用）
-- ============================================================
-- SELECT preference_type, status, COUNT(*)
--   FROM public.shift_preferences
--  GROUP BY 1, 2
--  ORDER BY 1, 2;
--
-- -- 特に 'available' の件数を確認
-- SELECT COUNT(*) AS available_count
--   FROM public.shift_preferences
--  WHERE preference_type = 'available';

-- ============================================================
-- 【参考】ロールバック SQL（緊急時対応用、UPDATE 復元は backup 必須）
-- ============================================================
-- BEGIN;
-- ALTER TABLE public.shift_preferences
--   DROP CONSTRAINT IF EXISTS shift_preferences_preference_type_check;
-- ALTER TABLE public.shift_preferences
--   ADD CONSTRAINT shift_preferences_preference_type_check
--   CHECK (preference_type IN ('available', 'preferred', 'unavailable'));
-- -- ※ 'preferred' から 'available' への復元は backup から個別判断で対応
-- COMMIT;

-- ------------------------------------------------------------
-- 1. 既存の 'available' レコードを 'preferred' に更新
--    （status / start_time / end_time はそのまま保持）
-- ------------------------------------------------------------
UPDATE public.shift_preferences
   SET preference_type = 'preferred'
 WHERE preference_type = 'available';

-- ------------------------------------------------------------
-- 2. 既存の CHECK 制約を削除
--    016_shift_preferences.sql で付与されたインライン CHECK 由来の
--    Postgres 命名規則 shift_preferences_preference_type_check を想定
-- ------------------------------------------------------------
ALTER TABLE public.shift_preferences
  DROP CONSTRAINT IF EXISTS shift_preferences_preference_type_check;

-- ------------------------------------------------------------
-- 3. 'available' を除外した新しい CHECK 制約を追加
-- ------------------------------------------------------------
ALTER TABLE public.shift_preferences
  ADD CONSTRAINT shift_preferences_preference_type_check
  CHECK (preference_type IN ('preferred', 'unavailable'));

COMMIT;
