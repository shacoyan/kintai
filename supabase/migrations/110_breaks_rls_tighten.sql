-- Migration 110: breaks の staff FOR ALL 全開放を封鎖（FG2 / 金額-捏造）
--
-- 背景（脆弱点）:
--   breaks(id, attendance_record_id→attendance_records ON DELETE CASCADE,
--          start_time NOT NULL, end_time NULL可, created_at)。
--   tenant_id / user_id 列は無し（所有・テナントは親 attendance_record 経由）。
--
--   staff policy "Users manage own breaks"（099:111-116）= FOR ALL で自分の
--   attendance に紐づく breaks を全 CRUD 可・列ガード無し。
--   攻撃: staff が過去の確定休憩(end_time セット済み)を DELETE または UPDATE
--   （end_time 前倒し / start_time 後ろ倒しで短縮）→ 078 の休憩控除が減る →
--   労働分=給与水増し。052 の承認再計算にも波及。
--
--   正規フロー（useAttendance.ts）:
--     breakStart = INSERT {attendance_record_id, start_time}（end_time NULL）
--     breakEnd   = 進行中(end_time NULL)行の end_time=now UPDATE
--     clockOut   = activeBreak の end_time=now UPDATE
--   breaks の DELETE は frontend に存在しない（grep 実測）。
--
-- 設計方針（非破壊・100 と同思想の二層防御）:
--   staff の FOR ALL を操作別に分割し、確定休憩の改変・削除を封鎖する。
--   start_time 不変・「進行中→終了」のみは RLS で表現しきれない部分
--   （NEW/OLD 比較）を BEFORE UPDATE トリガで補完する。
--   managerial policy "Managers can manage tenant breaks"（099:104・FOR ALL・
--   role IN owner/manager）は不変で維持。

BEGIN;

DROP POLICY IF EXISTS "Users manage own breaks" ON public.breaks;

-- SELECT: 自分の attendance に紐づく breaks（managerial は既存 FOR ALL でカバー）
DROP POLICY IF EXISTS "breaks_select_self" ON public.breaks;
CREATE POLICY "breaks_select_self" ON public.breaks
  FOR SELECT TO authenticated
  USING (attendance_record_id IN (
    SELECT id FROM public.attendance_records WHERE user_id = (SELECT auth.uid())));

-- INSERT: 自分の「勤務中(clock_out NULL)」セッションに対する休憩開始(end_time NULL)のみ
DROP POLICY IF EXISTS "breaks_insert_self" ON public.breaks;
CREATE POLICY "breaks_insert_self" ON public.breaks
  FOR INSERT TO authenticated
  WITH CHECK (
    end_time IS NULL
    AND attendance_record_id IN (
      SELECT id FROM public.attendance_records
      WHERE user_id = (SELECT auth.uid()) AND clock_out IS NULL)
  );

-- UPDATE: 自分の「進行中(OLD end_time NULL)」休憩のみ対象（確定休憩は USING で除外）
DROP POLICY IF EXISTS "breaks_update_self_end" ON public.breaks;
CREATE POLICY "breaks_update_self_end" ON public.breaks
  FOR UPDATE TO authenticated
  USING (
    end_time IS NULL
    AND attendance_record_id IN (
      SELECT id FROM public.attendance_records WHERE user_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    attendance_record_id IN (
      SELECT id FROM public.attendance_records WHERE user_id = (SELECT auth.uid()))
  );

-- staff DELETE policy は作らない → staff は breaks を削除不可
-- （managerial FOR ALL のみ削除可）

-- 二層目: start_time 改変・進行中以外の UPDATE を拒否（RLS が NEW/OLD 比較不可のため）
CREATE OR REPLACE FUNCTION public.breaks_enforce_self_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.attendance_records WHERE id = NEW.attendance_record_id;
  -- 判定1: owner/manager 素通し（manager 修正導線・cascade 等）
  IF EXISTS (SELECT 1 FROM public.tenant_members
             WHERE tenant_id = v_tenant AND user_id = auth.uid()
               AND role IN ('owner','manager')) THEN
    RETURN NEW;
  END IF;
  -- staff: 進行中(OLD.end_time NULL)の end_time 確定のみ。start_time / 紐付けの改変を拒否。
  IF OLD.end_time IS NOT NULL
     OR NEW.start_time IS DISTINCT FROM OLD.start_time
     OR NEW.attendance_record_id IS DISTINCT FROM OLD.attendance_record_id THEN
    RAISE EXCEPTION 'staff は進行中の休憩の終了時刻のみ設定できます（休憩開始時刻の変更・確定済み休憩の改変は不可）。修正が必要な場合は管理者へ依頼してください'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_breaks_enforce_self_update ON public.breaks;
CREATE TRIGGER trg_breaks_enforce_self_update
  BEFORE UPDATE ON public.breaks
  FOR EACH ROW EXECUTE FUNCTION public.breaks_enforce_self_update();

COMMIT;
