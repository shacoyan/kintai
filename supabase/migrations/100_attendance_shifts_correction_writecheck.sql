-- Migration 100: attendance / shifts / correction_requests UPDATE 横串 WITH CHECK + 列改ざんトリガ（P1-1 / P1-2 / P2-18）
--
-- 背景（本番 impersonate で実証済 2026-06-18）:
--   RLS の UPDATE は USING で「どの行を更新できるか」を絞るが、WITH CHECK が無いと
--   「更新後の行が満たすべき条件」が無制約になり、所有チェックを通した自分の行の
--   中身を別人/別状態に書き換えられる。さらに列の改ざんは WITH CHECK では止まらない
--   （更新後も user_id=自分 のままだから）ため、BEFORE UPDATE トリガで列単位ガードを
--   追加する二層防御とする。
--
--   - P1-1 attendance_records "Users update own records" (UPDATE, with_check=NULL):
--       staff 0b1e5162 が自分の過去打刻を correction フロー迂回で直 UPDATE。
--       total_work_minutes 529→10528 / clock_in -5h 成功 → 給与水増し。
--   - P1-2 shifts "shifts_update" (UPDATE, with_check=NULL):
--       staff が自分の approved シフトの end_time 21:00→00:00(+3h) を status='approved'
--       のまま直 UPDATE 成功 → 稼働水増し。054 トリガは status 不変なら冒頭 RETURN で素通り。
--   - P2-18 correction_requests "Managers can update requests" (UPDATE, with_check=NULL):
--       二層目 RLS で現状ブロック済 = 実害なし。WITH CHECK 欠落クラスの取り残し封鎖（防御多層化）。
--
-- 設計方針（非破壊）:
--   (1)(3)(5) ALTER POLICY ... WITH CHECK で USING は不変のまま WITH CHECK だけ付与。
--       (SELECT auth.uid()) / (SELECT get_my_tenant_ids()) の initplan ラップ形式を
--       本番現状（099）に合わせて維持（auth.uid() 裸書きは auth_rls_initplan WARN を再発させる）。
--   (2) 新規 BEFORE UPDATE トリガ trg_attendance_enforce_self_update:
--       staff 本人（owner/manager でない）の過去行の clock_in/clock_out/total_work_minutes/date
--       改ざんを拒否。当日アクティブ行（clock_out NULL→値）の clockOut 確定のみ許可
--       （かつ clock_in/date 不変要件で同時改ざんを封鎖）。
--   (4) 新規 BEFORE UPDATE トリガ trg_shifts_enforce_time_update:
--       owner/manager 以外の start_time/end_time/store_id 変更を拒否。
--       既存 054 トリガ trg_shifts_enforce_approval_order / 086 INSERT トリガには一切触れない。
--   - トリガ関数は通常 SECURITY（呼出ユーザ権限で auth.uid() を解決）。
--       review_correction_request / update_shift_time は SECURITY DEFINER だが、内部 auth.uid()
--       は呼出元 manager を返すため判定1（owner/manager）を通過し RPC を阻害しない。
--   - manager 編集導線 useTenantAdmin.updateAttendance（直 UPDATE）も判定1で通過。
--
-- 前提（本番実測済 2026-06-19）:
--   - 対象 3 ポリシーとも with_check=NULL。USING 式は本ファイルの WITH CHECK と論理一致。
--   - attendance_records に既存 UPDATE トリガ 0 件（pg_trigger 実測）。
--   - shifts に trg_shifts_enforce_approval_order(BEFORE UPDATE/054) と
--     trg_shifts_enforce_insert_status(BEFORE INSERT/086) が共存済。
--   - update_shift_time / review_correction_request は SECURITY DEFINER（prosecdef=true）。
--   - tenant_members(tenant_id,user_id,role) で owner/manager 判定可能。
--   - store manager は tenant_members.role='manager' を持つ（kintai ロールモデル）。
--     update_shift_time は is_store_manager を要求するが、その実行者は当該テナントで
--     owner か role='manager' のため判定1で通過する。
--
-- Depends:
--   - 012 (shifts) / 038 (shifts_insert/update policy) / 054 (BEFORE UPDATE トリガ)
--   - 086 (BEFORE INSERT トリガ・本トリガの基準実装) / 099 (initplan ラップ)
--   - attendance_records / correction_requests の RLS（既存）
--
-- Rollback / 検証SQL: 本ファイル末尾のコメントブロックを参照。

BEGIN;

-- =========================================================================
-- (1) attendance_records "Users update own records" に WITH CHECK 付与
--     USING は不変（user_id = (SELECT auth.uid())）。
-- =========================================================================
ALTER POLICY "Users update own records" ON public.attendance_records
  WITH CHECK (user_id = (SELECT auth.uid()));

-- =========================================================================
-- (2) Trigger 関数 + トリガ: attendance_enforce_self_update
--     staff 本人の過去行 clock_in/clock_out/total_work_minutes/date 改ざんを拒否。
--     当日アクティブ行（clock_out NULL→値）の clockOut 確定は許可（clock_in/date 不変要件付き）。
--     通常 SECURITY（auth.uid() は呼出元を解決）。
-- =========================================================================
CREATE OR REPLACE FUNCTION public.attendance_enforce_self_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- 判定1: 実行者が当該テナントの owner/manager なら無条件で通す
  --   （manager 編集導線 useTenantAdmin.updateAttendance / review_correction_request RPC を阻害しない）
  IF EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = NEW.tenant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'manager')
  ) THEN
    RETURN NEW;
  END IF;

  -- 以降は staff 本人（RLS USING で user_id = auth.uid() は保証済）

  -- 正規 clockOut 例外: 出勤中レコードの退勤確定（clock_out NULL→値）。
  --   useAttendance.ts:278 の正規 clockOut は clock_out=now と total_work_minutes のみ UPDATE。
  --   clock_in / date は不変であることを併せて要求し、clockOut にかこつけた同時改ざんを封鎖。
  IF OLD.clock_out IS NULL AND NEW.clock_out IS NOT NULL
     AND NEW.clock_in IS NOT DISTINCT FROM OLD.clock_in
     AND NEW.date     IS NOT DISTINCT FROM OLD.date THEN
    RETURN NEW;
  END IF;

  -- 上記例外に該当しない staff UPDATE で、改ざん対象 4 列のいずれかが変化していれば拒否。
  -- IS DISTINCT FROM で NULL 安全に比較（= は NULL で UNKNOWN になり誤判定する）。
  IF NEW.clock_in           IS DISTINCT FROM OLD.clock_in
     OR NEW.clock_out       IS DISTINCT FROM OLD.clock_out
     OR NEW.total_work_minutes IS DISTINCT FROM OLD.total_work_minutes
     OR NEW.date            IS DISTINCT FROM OLD.date THEN
    RAISE EXCEPTION 'staff cannot modify finalized attendance fields (clock_in/clock_out/total_work_minutes/date); use correction_requests'
      USING ERRCODE = '42501';
  END IF;

  -- 4 列がすべて不変の staff UPDATE（note 等の無害列）は通す（過剰ブロック回避）
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_enforce_self_update ON public.attendance_records;
CREATE TRIGGER trg_attendance_enforce_self_update
  BEFORE UPDATE ON public.attendance_records
  FOR EACH ROW
  EXECUTE FUNCTION public.attendance_enforce_self_update();

-- =========================================================================
-- (3) shifts "shifts_update" に WITH CHECK（USING 同条件）付与
--     USING は不変。本番実測の USING 式と論理完全一致。
-- =========================================================================
ALTER POLICY "shifts_update" ON public.shifts
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      user_id = (SELECT auth.uid())
      OR is_tenant_owner(tenant_id)
      OR EXISTS (
        SELECT 1 FROM public.tenant_members
        WHERE tenant_members.tenant_id = shifts.tenant_id
          AND tenant_members.user_id = (SELECT auth.uid())
          AND tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])
      )
    )
  );

-- =========================================================================
-- (4) Trigger 関数 + トリガ: shifts_enforce_time_update
--     owner/manager 以外（staff 本人）の start_time/end_time/store_id 変更を拒否。
--     update_shift_time RPC（SECURITY DEFINER / is_store_manager）の UPDATE は
--     呼出元が owner/manager のため判定1で通過する。
--     既存 054 trg_shifts_enforce_approval_order とは別名で共存（086 で共存パターン実証済）。
--     通常 SECURITY。
-- =========================================================================
CREATE OR REPLACE FUNCTION public.shifts_enforce_time_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- 判定1: owner/manager なら無条件で通す（update_shift_time RPC / addShiftForMember 等）
  IF EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = NEW.tenant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'manager')
  ) THEN
    RETURN NEW;
  END IF;

  -- staff 本人: 時刻・店舗の変更を拒否（NULL 安全比較）。
  --   時刻・店舗が不変の UPDATE（submitShift の status 操作等）は阻害しない。
  IF NEW.start_time IS DISTINCT FROM OLD.start_time
     OR NEW.end_time IS DISTINCT FROM OLD.end_time
     OR NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    RAISE EXCEPTION 'staff cannot modify shift time/store (start_time/end_time/store_id); use update_shift_time RPC'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shifts_enforce_time_update ON public.shifts;
CREATE TRIGGER trg_shifts_enforce_time_update
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.shifts_enforce_time_update();

-- =========================================================================
-- (5) correction_requests "Managers can update requests" に WITH CHECK（USING 同条件）付与
--     review_correction_request（SECURITY DEFINER）は RLS をバイパスするので影響なし。
--     直 UPDATE 導線にのみ WITH CHECK が効く。トリガ不要。
-- =========================================================================
ALTER POLICY "Managers can update requests" ON public.correction_requests
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_members.tenant_id FROM public.tenant_members
      WHERE tenant_members.user_id = (SELECT auth.uid())
        AND tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])
    )
  );

COMMIT;

-- =========================================================================
-- ROLLBACK SQL（100 で追加/変更した内容を戻す。手動実行）
--   ※ WITH CHECK は ALTER POLICY で「外す」直接構文が無いため、
--     既存ポリシーを DROP→CREATE で with_check=NULL に再作成する（USING は本番現状式）。
--   ※ 既存 054/086 トリガ・関数は 100 で触れていないため対象外。
-- =========================================================================
-- BEGIN;
--   -- 新規トリガ・関数の撤去
--   DROP TRIGGER  IF EXISTS trg_attendance_enforce_self_update ON public.attendance_records;
--   DROP FUNCTION IF EXISTS public.attendance_enforce_self_update();
--   DROP TRIGGER  IF EXISTS trg_shifts_enforce_time_update ON public.shifts;
--   DROP FUNCTION IF EXISTS public.shifts_enforce_time_update();
--
--   -- WITH CHECK を NULL に戻す（DROP→CREATE で再作成。USING は本番現状式に一致）
--   DROP POLICY IF EXISTS "Users update own records" ON public.attendance_records;
--   CREATE POLICY "Users update own records" ON public.attendance_records
--     FOR UPDATE USING (user_id = (SELECT auth.uid()));
--
--   DROP POLICY IF EXISTS "shifts_update" ON public.shifts;
--   CREATE POLICY "shifts_update" ON public.shifts
--     FOR UPDATE USING (
--       tenant_id IN (SELECT get_my_tenant_ids())
--       AND (user_id = (SELECT auth.uid()) OR is_tenant_owner(tenant_id)
--            OR EXISTS (SELECT 1 FROM public.tenant_members
--                       WHERE tenant_members.tenant_id = shifts.tenant_id
--                         AND tenant_members.user_id = (SELECT auth.uid())
--                         AND tenant_members.role = ANY (ARRAY['owner'::text,'manager'::text]))));
--
--   DROP POLICY IF EXISTS "Managers can update requests" ON public.correction_requests;
--   CREATE POLICY "Managers can update requests" ON public.correction_requests
--     FOR UPDATE USING (
--       tenant_id IN (SELECT tenant_members.tenant_id FROM public.tenant_members
--                     WHERE tenant_members.user_id = (SELECT auth.uid())
--                       AND tenant_members.role = ANY (ARRAY['owner'::text,'manager'::text])));
-- COMMIT;

-- =========================================================================
-- 適用後 検証 SQL（本番で実行・全件 PASS が承認条件。BEGIN..ROLLBACK で無汚染）
--   fixture テナント: 6650e979-1777-44f4-a01b-a1752a37f92c
--     owner   = 3a881ea3-34a9-421b-aea6-1412980ad541
--     manager = 40a9ecca-6e37-435f-a447-c1c5a87cfef1
--     staff   = 0b1e5162-270d-45a7-a1db-65e075ff78e9
--     store   = bc8e08b5-c736-4012-9f66-3989d3fed5b9
--     過去 attendance(staff) = 36bb573e-5a55-4762-99dc-05df82a14a43 (date 2026-06-13, twm 529)
--     approved shift(staff)  = ec... use 0ec0faf1-569b-41e9-a84a-47b79f54206b (2026-06-27 13:00-21:00)
--     pending correction     = ddb32534-49f5-4727-b98c-9c3b90a26f35 (user 628d2df1)
-- =========================================================================
-- -- 0.(read-only) トリガ追加/既存不変の確認
-- -- SELECT c.relname, t.tgname, (t.tgtype&2)<>0 AS is_before,
-- --        (t.tgtype&4)<>0 AS on_insert, (t.tgtype&16)<>0 AS on_update
-- -- FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
-- -- WHERE c.relname IN ('attendance_records','shifts') AND NOT t.tgisinternal ORDER BY 1,2;
--
-- -- 攻撃 4-1（拒否=PASS）: staff が過去 attendance の total_work_minutes 改変
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','0b1e5162-270d-45a7-a1db-65e075ff78e9','role','authenticated')::text, true);
-- --   UPDATE public.attendance_records SET total_work_minutes=10528 WHERE id='36bb573e-5a55-4762-99dc-05df82a14a43';
-- -- ROLLBACK;   -- → EXCEPTION 42501 が出れば PASS
--
-- -- 攻撃 4-2（拒否=PASS）: staff が過去 attendance の clock_in を -5h
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','0b1e5162-270d-45a7-a1db-65e075ff78e9','role','authenticated')::text, true);
-- --   UPDATE public.attendance_records SET clock_in=clock_in - interval '5 hours' WHERE id='36bb573e-5a55-4762-99dc-05df82a14a43';
-- -- ROLLBACK;   -- → EXCEPTION
--
-- -- 攻撃 4-3（拒否=PASS）: clockOut にかこつけて clock_in も改ざん（要 clock_out IS NULL の行）
-- --   ※ アクティブ行が無ければ一時 INSERT で再現。clock_in 不変要件で拒否されることを確認。
--
-- -- 攻撃 4-4（拒否=PASS）: staff が approved シフトの end_time を status 不変のまま変更
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','0b1e5162-270d-45a7-a1db-65e075ff78e9','role','authenticated')::text, true);
-- --   UPDATE public.shifts SET end_time='00:00:00' WHERE id='0ec0faf1-569b-41e9-a84a-47b79f54206b';
-- -- ROLLBACK;   -- → EXCEPTION
--
-- -- 攻撃 4-5（拒否=PASS）: staff が自分シフトの store_id を別店舗へ
-- -- 攻撃 (c)（拒否=PASS）: staff が attendance の user_id を他人へ → WITH CHECK 違反で EXCEPTION
--
-- -- 正規 5-1（成功=PASS）: staff が当日アクティブ行を clockOut 確定（clock_in/date 不変）
-- -- 正規 5-2（成功=PASS）: manager が updateAttendance 相当（clock_in/clock_out/total_work_minutes 更新）
-- -- 正規 5-3（成功=PASS）: manager が update_shift_time(<approved_shift>,'10:00','18:00',NULL)
-- -- 正規 5-4（成功=PASS）: manager が review_correction_request(<pending>, 'approved')
-- -- 正規 5-5（成功=PASS）: staff submitShift 相当 INSERT（本トリガは UPDATE のみで非干渉・086 矯正）
