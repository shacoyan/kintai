-- ============================================================
-- Migration: 029_leave_type_extend.sql
-- Purpose : leave_requests.leave_type CHECK 制約に法定休暇 5 種追加
-- Author  : system
-- Date    : 2024-01-01
-- ============================================================
-- 変更概要:
--   leave_requests テーブルの leave_type CHECK 制約を拡張し、
--   以下の法定休暇タイプを追加します。
--
-- 追加項目:
--   special       : 慶弔休暇
--   maternity     : 産前産後休暇
--   paternity     : 育児休暇
--   compassionate : 忌引休暇
--   comp_holiday  : 振替休日
--
-- 既存項目 (変更なし):
--   paid          : 有給休暇
--   half_am       : 半日休暇 (午前)
--   half_pm       : 半日休暇 (午後)
--   absence       : 欠勤
--   other         : その他
-- ============================================================

BEGIN;

-- 既存の CHECK 制約を削除
ALTER TABLE public.leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_leave_type_check;

-- 新しい CHECK 制約を追加 (法定休暇 5 種を追加)
ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_leave_type_check
  CHECK (leave_type IN (
    'paid','half_am','half_pm','absence','other',
    'special','maternity','paternity','compassionate','comp_holiday'
  ));

COMMIT;

-- ============================================================
-- ロールバック手順:
-- ============================================================
-- 以下の SQL を実行することで、本マイグレーションを
-- ロールバックできます。
--
-- BEGIN;
-- ALTER TABLE public.leave_requests
--   DROP CONSTRAINT IF EXISTS leave_requests_leave_type_check;
-- ALTER TABLE public.leave_requests
--   ADD CONSTRAINT leave_requests_leave_type_check
--   CHECK (leave_type IN (
--     'paid','half_am','half_pm','absence','other'
--   ));
-- COMMIT;
--
-- 注意: ロールバック前に、追加した leave_type 値
-- ('special','maternity','paternity','compassionate','comp_holiday')
-- を使用しているレコードが存在しないことを確認してください。
-- ============================================================
