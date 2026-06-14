-- Migration 086: shifts INSERT status 強制（P1-3）
--
-- 背景:
--   本番 policy "shifts_insert"（038 由来）は
--     WITH CHECK = tenant_id IN (get_my_tenant_ids())
--                  AND (user_id=auth.uid() OR is_tenant_owner(tenant_id)
--                       OR EXISTS(... role IN('owner','manager')))
--   で status に一切制約が無い。shifts.status CHECK は
--     ('pending','tentative','approved','rejected','modified','cancelled')
--   を許容するため、staff 本人が status='approved'（または 'tentative'）の行を
--   直 INSERT し、2 段階承認をバイパスして人件費を水増しできる。
--   既存 enforce トリガ trg_shifts_enforce_approval_order は **BEFORE UPDATE のみ**
--   （本番 pg_trigger 実測: timing=BEFORE / events=UPDATE）で INSERT には非発火。
--
-- 設計方針（非破壊）:
--   BEFORE INSERT トリガを新規追加し、INSERT 実行者が当該テナントの owner/manager
--   でない場合（= staff 本人 INSERT）は NEW.status を 'pending' に矯正する。
--   owner/manager の場合は NEW をそのまま通す（tentative/approved INSERT を温存）。
--   - submitShift は status 未指定 = DB default 'pending' のため矯正しても正規導線は無影響。
--   - addShiftForMember（status='tentative', owner/manager 経由）/
--     approvePreference（owner/manager が staff 分を status='tentative' で INSERT）は
--     owner/manager 判定を通るので温存される。
--   - approve_shift_final / approve_store_shifts_final 等の RPC は UPDATE 経路のため
--     本 INSERT トリガとは無関係（BEFORE UPDATE トリガ側で従来どおり処理）。
--   既存 BEFORE UPDATE トリガ trg_shifts_enforce_approval_order と関数
--   shifts_enforce_approval_order() には一切触れない（DROP/ALTER/CREATE しない）。
--   shifts_insert RLS policy も変更しない（status 制約はトリガ側で担保）。
--
-- 前提（実測済 2026-06-14）:
--   - trg_shifts_enforce_approval_order = BEFORE UPDATE（INSERT 非発火）
--   - shifts.status default = 'pending'
--   - tenant_members(tenant_id,user_id,role) で owner/manager 判定可能
--
-- Depends:
--   - 012 (shifts 定義) / 038 (shifts_insert policy) / 054 (BEFORE UPDATE トリガ)
--
-- Rollback / 検証SQL: 本ファイル末尾のコメントブロックを参照。

BEGIN;

-- =========================================================================
-- 1. Trigger 関数: shifts_enforce_insert_status
--    BEFORE INSERT で、owner/manager 以外（staff 本人 INSERT）の status を
--    'pending' に矯正する。SECURITY は通常（呼出ユーザ権限。auth.uid() が解決
--    できればよい）。既存 BEFORE UPDATE トリガ関数とは別関数。
-- =========================================================================
CREATE OR REPLACE FUNCTION public.shifts_enforce_insert_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- INSERT 実行者が当該テナントの owner/manager か判定
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = NEW.tenant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'manager')
  ) THEN
    -- staff 本人 INSERT: status の捏造を 'pending' へ矯正（黙って無害化）
    -- submitShift は status 未指定 = default 'pending' なので正規導線は無影響。
    IF NEW.status IS DISTINCT FROM 'pending' THEN
      NEW.status := 'pending';
    END IF;
  END IF;
  -- owner/manager の場合は NEW をそのまま通す（tentative/approved INSERT 温存）

  RETURN NEW;
END;
$$;

-- =========================================================================
-- 2. Trigger 作成（BEFORE INSERT・既存 BEFORE UPDATE トリガとは別名）
-- =========================================================================
DROP TRIGGER IF EXISTS trg_shifts_enforce_insert_status ON public.shifts;
CREATE TRIGGER trg_shifts_enforce_insert_status
  BEFORE INSERT ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.shifts_enforce_insert_status();

COMMIT;

-- =========================================================================
-- ROLLBACK SQL（086 で追加した新トリガ・新関数を削除。手動実行）
--   ※ 既存 BEFORE UPDATE トリガ trg_shifts_enforce_approval_order /
--      関数 shifts_enforce_approval_order() は 086 で触れていないため対象外。
-- =========================================================================
-- BEGIN;
--   DROP TRIGGER  IF EXISTS trg_shifts_enforce_insert_status ON public.shifts;
--   DROP FUNCTION IF EXISTS public.shifts_enforce_insert_status();
-- COMMIT;

-- =========================================================================
-- 適用後 検証 SQL（本番で実行・全件 PASS が承認条件。BEGIN..ROLLBACK で無汚染）
--   fixture テナント候補: 786f041f-4d89-4d5e-bf1b-b4c23dd38b0c（owner1/manager2/staff7）
--                        または 6650e979-1777-44f4-a01b-a1752a37f92c（owner1/manager2/staff10）
--   <OWNER_UID>/<MANAGER_UID>/<STAFF_UID> は当該テナントの実 UID に置換。
--   <STORE_ID> / <DATE> / 時刻列は shifts NOT NULL 制約を満たす実値に置換。
-- =========================================================================
-- -- 0. トリガが想定どおり追加されたか / 既存 UPDATE トリガが不変か（read-only）
-- -- SELECT tgname, tgenabled,
-- --        (tgtype & 2)  <> 0 AS is_before,
-- --        (tgtype & 4)  <> 0 AS on_insert,
-- --        (tgtype & 16) <> 0 AS on_update
-- -- FROM pg_trigger WHERE tgrelid='public.shifts'::regclass AND NOT tgisinternal ORDER BY tgname;
-- -- 期待: trg_shifts_enforce_insert_status = BEFORE INSERT（新規） /
-- --       trg_shifts_enforce_approval_order = BEFORE UPDATE（不変）。
--
-- -- 1.(攻撃) staff が user_id=自分, status='approved' で INSERT → PASS=status が 'pending' に矯正
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<STAFF_UID>','role','authenticated')::text, true);
-- --   INSERT INTO public.shifts (tenant_id, store_id, user_id, date, status /*, time 列…*/)
-- --     VALUES ('786f041f-4d89-4d5e-bf1b-b4c23dd38b0c','<STORE_ID>','<STAFF_UID>','<DATE>','approved')
-- --   RETURNING status;   -- → 'pending' が返れば PASS
-- -- ROLLBACK;
--
-- -- 2.(攻撃) staff が user_id=自分, status='tentative' で INSERT → PASS=status が 'pending' に矯正
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<STAFF_UID>','role','authenticated')::text, true);
-- --   INSERT INTO public.shifts (tenant_id, store_id, user_id, date, status /*, time 列…*/)
-- --     VALUES ('786f041f-4d89-4d5e-bf1b-b4c23dd38b0c','<STORE_ID>','<STAFF_UID>','<DATE>','tentative')
-- --   RETURNING status;   -- → 'pending' が返れば PASS
-- -- ROLLBACK;
--
-- -- 3.(正規) staff が status 未指定で INSERT（submitShift 相当）→ PASS=status='pending' で 1行作成
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<STAFF_UID>','role','authenticated')::text, true);
-- --   INSERT INTO public.shifts (tenant_id, store_id, user_id, date /*, time 列…*/)
-- --     VALUES ('786f041f-4d89-4d5e-bf1b-b4c23dd38b0c','<STORE_ID>','<STAFF_UID>','<DATE>')
-- --   RETURNING status;   -- → 'pending' が返れば PASS
-- -- ROLLBACK;
--
-- -- 4.(正規) owner/manager が user_id=他staff, status='tentative' で INSERT
-- --          （addShiftForMember / approvePreference 相当）→ PASS=tentative のまま 1行作成
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<MANAGER_UID>','role','authenticated')::text, true);
-- --   INSERT INTO public.shifts (tenant_id, store_id, user_id, date, status /*, time 列…*/)
-- --     VALUES ('786f041f-4d89-4d5e-bf1b-b4c23dd38b0c','<STORE_ID>','<STAFF_UID>','<DATE>','tentative')
-- --   RETURNING status;   -- → 'tentative' が返れば PASS
-- -- ROLLBACK;
--
-- -- 5.(正規) approve_shift_final RPC（tentative→approved）が従来どおり成功
-- --          （BEFORE UPDATE トリガ経路・086 で不変）→ PASS
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<MANAGER_UID>','role','authenticated')::text, true);
-- --   SELECT status FROM public.approve_shift_final('<TENTATIVE_SHIFT_ID>');  -- → 'approved' が返れば PASS
-- -- ROLLBACK;
