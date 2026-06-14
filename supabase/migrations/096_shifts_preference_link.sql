-- =============================================================================
-- 096_shifts_preference_link.sql  (P2/P3 batch B4)
-- =============================================================================
-- item: revert-preference-orphan-shift
--
-- public.shifts に `preference_id uuid` 列（FK→shift_preferences, ON DELETE SET NULL）
-- を additive に追加する。
--
-- 背景:
--   approvePreference（useShiftPreference.ts）は shift_preferences の承認時に
--   shifts へ status='tentative' の仮承認行を 1 件 INSERT する。
--   revertPreference は承認を保留へ戻す際、その仮承認 shifts を削除するが、
--   削除条件が
--     .match({ tenant_id, user_id, date, store_id, status:'tentative',
--              start_time: pref.start_time, end_time: pref.end_time })
--   と「希望の元時刻」一致に依存していた。
--   このため:
--     (a) override 承認（overrideStartTime/overrideEndTime で希望と異なる時刻で
--         仮承認した）ケースでは start_time/end_time が pref と一致せず、
--         DELETE が 0 行ヒット → 仮承認 shifts が孤児として残留する。
--     (b) 同一(date,store_id,user_id)で複数の tentative 行が存在する場合
--         （時刻違いの複数希望承認など）、時刻一致のみでは別申請由来の行を
--         取り違えて削除し得る。
--   いずれも shift_preferences と shifts の対応が「値の一致」に依存し、
--   同一性が保証されていないことが根因。
--
-- 設計方針（非破壊・additive）:
--   shifts に preference_id 列を追加し、approvePreference の INSERT 時に
--   承認元の shift_preferences.id を記録する。revertPreference は
--   .match({ preference_id }) で当該仮承認 shifts のみを厳密削除する
--   （override 時刻でも孤児化せず、複数 tentative も取り違えない）。
--   - nullable 列のため既存行・既存導線は影響なし（手動作成シフトは NULL）。
--   - FK は ON DELETE SET NULL: 希望レコードが物理削除されても shifts は
--     孤児化せず preference_id だけ NULL になる（人件費集計対象は残す）。
--   - 既存トリガ（086 BEFORE INSERT / 054 BEFORE UPDATE）・shifts RLS policy・
--     shift_preferences 側には一切触れない。
--
-- 前提（実測済 2026-06-15・prod zjjbfffhbobwwxyvdszl）:
--   - public.shifts に preference_id 列は存在しない。
--   - public.shift_preferences の PK = id (uuid)。
--
-- Depends:
--   - 012 (shifts 定義) / shift_preferences 定義
--
-- Rollback / 検証SQL: 本ファイル末尾のコメントブロックを参照。

BEGIN;

-- =========================================================================
-- 1. preference_id 列を additive 追加（nullable・FK→shift_preferences）
--    ON DELETE SET NULL: 希望削除時も shifts は孤児化せず NULL 化のみ。
-- =========================================================================
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS preference_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.shifts'::regclass
      AND conname = 'shifts_preference_id_fkey'
  ) THEN
    ALTER TABLE public.shifts
      ADD CONSTRAINT shifts_preference_id_fkey
      FOREIGN KEY (preference_id)
      REFERENCES public.shift_preferences(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- =========================================================================
-- 2. 既存 tentative シフトの preference_id 一意バックフィル
--    背景: 096 前に作成された status='tentative' 行は preference_id=NULL。
--    revertPreference が .match({ preference_id, status:'tentative' }) へ厳密化
--    されると、これら旧行は 0 行ヒット → throw となり「保留に戻す」が
--    既存データに対して機能不全（孤児 tentative の残留・希望 approved 固定）。
--    実測（prod zjjbfffhbobwwxyvdszl 2026-06-15）: tentative 34件・全件当月・
--    全件が approved 希望に対し exact 1 マッチ（多重マッチ 0 件＝曖昧性なし）。
--    そのため (tenant_id,user_id,date) の同一性で一意に link できる。
--    曖昧化防止のため、approved 希望が複数該当する shifts は除外（IS NULL の
--    sub-select 一意性ガード）し、誤 link を発生させない。
-- =========================================================================
UPDATE public.shifts sh
SET preference_id = sp.id
FROM public.shift_preferences sp
WHERE sh.preference_id IS NULL
  AND sh.status = 'tentative'
  AND sp.status = 'approved'
  AND sp.tenant_id = sh.tenant_id
  AND sp.user_id = sh.user_id
  AND sp.date = sh.date
  -- 同一(tenant_id,user_id,date)に approved 希望が複数ある場合は曖昧 → link しない
  AND (
    SELECT count(*) FROM public.shift_preferences sp2
    WHERE sp2.status = 'approved'
      AND sp2.tenant_id = sh.tenant_id
      AND sp2.user_id = sh.user_id
      AND sp2.date = sh.date
  ) = 1;

-- 3. revertPreference の .match({ preference_id }) 厳密削除を支える索引（部分索引）
CREATE INDEX IF NOT EXISTS idx_shifts_preference_id
  ON public.shifts (preference_id)
  WHERE preference_id IS NOT NULL;

COMMIT;

-- =========================================================================
-- ROLLBACK SQL（096 で追加した列・FK・索引を削除。手動実行）
-- =========================================================================
-- BEGIN;
--   DROP INDEX IF EXISTS public.idx_shifts_preference_id;
--   ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_preference_id_fkey;
--   ALTER TABLE public.shifts DROP COLUMN IF EXISTS preference_id;
-- COMMIT;

-- =========================================================================
-- 適用後 検証 SQL（本番で実行・全件 PASS が承認条件。read-only / 無汚染）
-- =========================================================================
-- -- 0. 列・FK・索引が想定どおり追加されたか
-- -- SELECT column_name, data_type, is_nullable
-- --   FROM information_schema.columns
-- --   WHERE table_schema='public' AND table_name='shifts' AND column_name='preference_id';
-- --   -- 期待: preference_id / uuid / YES
-- -- SELECT conname, confdeltype  -- confdeltype='n' = SET NULL
-- --   FROM pg_constraint
-- --   WHERE conrelid='public.shifts'::regclass AND conname='shifts_preference_id_fkey';
-- --   -- 期待: shifts_preference_id_fkey / n
-- -- SELECT indexname FROM pg_indexes
-- --   WHERE schemaname='public' AND tablename='shifts' AND indexname='idx_shifts_preference_id';
-- --   -- 期待: idx_shifts_preference_id
--
-- -- 1. バックフィル後、当月 tentative の link 件数を確認
-- -- SELECT count(*) FILTER (WHERE preference_id IS NOT NULL) AS linked,
-- --        count(*) FILTER (WHERE status='tentative') AS total_tentative,
-- --        count(*) FILTER (WHERE status='tentative' AND preference_id IS NULL) AS tentative_unlinked
-- --   FROM public.shifts;
-- --   -- 期待（prod 2026-06-15 実測）: linked=34 / total_tentative=34 / tentative_unlinked=0
-- --   -- （手動作成の確定シフト等 status<>'tentative' は NULL のまま）
-- --
-- -- 2. link 後に 34件が revert 可能か（BEGIN..ROLLBACK で非破壊検証）
-- -- BEGIN;
-- --   WITH d AS (
-- --     DELETE FROM public.shifts sh
-- --     USING public.shift_preferences sp
-- --     WHERE sh.preference_id = sp.id AND sh.status='tentative' AND sp.status='approved'
-- --     RETURNING sh.id
-- --   ) SELECT count(*) AS revertable FROM d;  -- 期待: 34
-- -- ROLLBACK;
