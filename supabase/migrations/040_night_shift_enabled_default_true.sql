-- ========================================================================
-- File : 040_night_shift_enabled_default_true.sql
-- Purpose : tenant_members.night_shift_enabled を全行 true に backfill
--           + 列 DEFAULT を true へ変更
-- Background : バグ #62
--   DEFAULT false のため深夜給 ×1.25 計算が全メンバーでスキップされていた。
--   フロント側ロジックは正しいため、DB 値のみを是正する。
-- Idempotency :
--   WHERE で IS NULL OR = false を除外するため、再実行しても既 true 行に影響なし。
--   036 / 037 適用との順序前後でも安全。
-- ========================================================================

BEGIN;

-- 1) backfill: NULL または false を true へ
UPDATE public.tenant_members
   SET night_shift_enabled = true
 WHERE night_shift_enabled IS NULL
    OR night_shift_enabled = false;

-- 2) DEFAULT 変更: 以後の INSERT で省略時は true
ALTER TABLE public.tenant_members
  ALTER COLUMN night_shift_enabled SET DEFAULT true;

COMMIT;

-- ======================================================================
-- ROLLBACK SECTION
-- ======================================================================
-- BEGIN;
-- ALTER TABLE public.tenant_members
--   ALTER COLUMN night_shift_enabled SET DEFAULT false;
-- COMMIT;
--
-- 注意:
-- ・UPDATE で false→true に書き換えた行は本 migration 単体では元に戻せない
--   （どの行が元 false だったかを保持していないため）。
-- ・個別メンバーで深夜計算 OFF が必要な場合は Admin > MemberManagement の
--   night_shift_enabled トグル UI から個別 OFF してください。
-- ======================================================================
