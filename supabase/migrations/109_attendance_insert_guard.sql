-- Migration 109: attendance_records の staff INSERT 捏造封鎖（FG1 / 金額・認可 緊急バッチ）
--
-- 背景（脆弱点）:
--   最終 INSERT policy "Users insert own records"（099:57-60）は WITH CHECK (user_id = auth.uid()) のみ。
--   tenant 所属も date/clock/total_work_minutes の妥当性も無検証で、attendance_records には
--   BEFORE INSERT トリガが 0 件（100 は UPDATE トリガのみ・086 は shifts）。
--   このため staff が POST /attendance_records で
--     {user_id:自分, tenant_id:任意, date:先週, clock_in:先週09:00, clock_out:先週19:00, total_work_minutes:600}
--   を投入すると、078 が期間内・clock 両有り行として計上 → 給与水増し。
--   tenant_id 無検証のため他テナント汚染も可能。
--
-- 対策（二層）:
--   (a) INSERT policy に tenant 所属チェックを追加（DROP+CREATE・initplan 形維持）。
--       USING は INSERT に無いため WITH CHECK のみ。
--   (b) 086/100 と同型の BEFORE INSERT トリガを新設。
--       判定1: owner/manager は無条件通過（manager 直 INSERT / review_correction_request RPC の
--       INSERT 経路は auth.uid()=呼出 manager のため素通り）。
--       staff 本人: 「当日(JST・サーバ基準)・clock_out NULL・total_work_minutes NULL・clock_in≈now」の
--       打刻開始行のみ許可、他は全文 RAISE（42501）。
--
--   clock_in 上下限が必須である理由: clock_out IS NULL だけ強制しても、staff が clock_in を
--   過去に捏造 → 正規 clockOut(UPDATE) で確定 → 078 が clock_out−clock_in を再計算し過去分を
--   丸ごと計上できてしまう（clockOut UPDATE は 100 トリガが clock_in 不変を要求するため、
--   INSERT 時点の clock_in が確定値になる）。故に当日・現在時刻付近に限定する。
--
--   トリガ関数は SECURITY DEFINER 不要（100/086 と同じ通常トリガ・auth.uid() は呼出元解決）。
--   is_tenant_owner は使わず inline の owner/manager EXISTS（100 と逐語同型）。
--   100 の BEFORE UPDATE トリガとは別イベント（INSERT）・別名で共存（二重発火なし）。
--
-- 参照: 099:48-95 / 100:1-114 / 086:47-78 / useAttendance.ts:236-266。

BEGIN;

-- (a) INSERT policy: tenant 所属を WITH CHECK に追加（USING は INSERT に無い）
DROP POLICY IF EXISTS "Users insert own records" ON public.attendance_records;
CREATE POLICY "Users insert own records" ON public.attendance_records
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id IN (SELECT get_my_tenant_ids())
  );

-- (b) BEFORE INSERT トリガ（通常 SECURITY・auth.uid() は呼出元解決）
CREATE OR REPLACE FUNCTION public.attendance_enforce_self_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- 判定1: owner/manager は無条件通過（manager 直 INSERT / review_correction_request RPC の呼出元）
  IF EXISTS (SELECT 1 FROM public.tenant_members
             WHERE tenant_id = NEW.tenant_id AND user_id = auth.uid()
               AND role IN ('owner','manager')) THEN
    RETURN NEW;
  END IF;
  -- staff 本人: 打刻開始行のみ許可。以下いずれか該当で拒否。
  IF NEW.clock_out IS NOT NULL
     OR NEW.total_work_minutes IS NOT NULL
     OR NEW.clock_in IS NULL
     OR NEW.date <> (now() AT TIME ZONE 'Asia/Tokyo')::date       -- 当日(JST・サーバ基準)
     OR NEW.clock_in < now() - interval '1 hour'                  -- 過去捏造ブロック
     OR NEW.clock_in > now() + interval '1 hour' THEN             -- 未来捏造ブロック
    RAISE EXCEPTION 'staff は当日の打刻開始行のみ登録できます（clock_out と total_work_minutes は NULL、date は当日(JST)、clock_in は現在時刻付近が必須）。過去打刻の追加・修正は修正申請(correction_requests)を使用してください'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_attendance_enforce_self_insert ON public.attendance_records;
CREATE TRIGGER trg_attendance_enforce_self_insert
  BEFORE INSERT ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.attendance_enforce_self_insert();

COMMIT;
