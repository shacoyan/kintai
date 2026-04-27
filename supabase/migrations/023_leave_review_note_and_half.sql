-- =============================================================================
-- 023_leave_review_note_and_half.sql
--
-- 目的:
--   Engineer A 設計書 §023 に基づく leave_requests テーブルの変更
--
-- 概要:
--   A. leave_requests に却下理由カラム (review_note) を追加
--      - NULL 許容、manager が UPDATE で記入
--   B. 半休タイプの細分化 (half_paid → half_am / half_pm)
--      - 既存データの half_paid を half_am にデフォルト変換
--      - CHECK 制約の置き換え ('paid', 'half_am', 'half_pm', 'absence', 'other')
--
-- 冪等性:
--   - ADD COLUMN は IF NOT EXISTS を使用
--   - 制約は DROP IF EXISTS → ADD の順で安全に置換
--
-- スキーマ前提:
--   public.leave_requests(id, leave_type, ...) が存在し、
--   leave_type に CHECK 制約が設定されていること。
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A. review_note カラム追加（却下理由・備考）
-- ---------------------------------------------------------------------------

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS review_note TEXT;

-- ---------------------------------------------------------------------------
-- B. 半休タイプの細分化と CHECK 制約の再設定
-- ---------------------------------------------------------------------------

-- B-1. 既存の CHECK 制約を削除
ALTER TABLE public.leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_leave_type_check;

-- B-2. 既存データの 'half_paid' を 'half_am' に更新
UPDATE public.leave_requests
  SET leave_type = 'half_am'
  WHERE leave_type = 'half_paid';

-- B-3. 新しい CHECK 制約を追加
ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_leave_type_check
  CHECK (leave_type IN ('paid', 'half_am', 'half_pm', 'absence', 'other'));

COMMIT;

-- =============================================================================
-- ロールバック手順（参考・通常実行しない）
-- =============================================================================
--   BEGIN;
--   ALTER TABLE public.leave_requests
--     DROP CONSTRAINT IF EXISTS leave_requests_leave_type_check;
--
--   UPDATE public.leave_requests
--     SET leave_type = 'half_paid'
--     WHERE leave_type = 'half_am';
--
--   ALTER TABLE public.leave_requests
--     ADD CONSTRAINT leave_requests_leave_type_check
--     CHECK (leave_type IN ('paid', 'half_paid', 'absence', 'other'));
--
--   ALTER TABLE public.leave_requests
--     DROP COLUMN IF EXISTS review_note;
--   COMMIT;
-- =============================================================================
