-- ============================================================
-- File: kintai/supabase/migrations/055_revert_shift_to_tentative.sql
-- Path: .company/engineering/docs/2026-05-21-kintai-loop5-revert-shift-to-tentative-techdesign.md
-- Date: 2026-05-21
-- Desc: RPC public.revert_shift_to_tentative (approved → tentative)
-- ============================================================

BEGIN;

-- 1. RPC: revert_shift_to_tentative (新規)
--    承認済み (approved) のシフトを仮確定 (tentative) に差し戻す。
--    reviewed_by / reviewed_at はクリア。GUC による trigger 054 ガードを通過させる。
-- ============================================================
CREATE OR REPLACE FUNCTION public.revert_shift_to_tentative(
  p_shift_id uuid
)
RETURNS public.shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift  public.shifts%ROWTYPE;
  v_result public.shifts%ROWTYPE;
BEGIN
  -- 1. auth.uid() NULLチェック
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth.uid is null';
  END IF;

  -- 2. 対象シフトを行ロック付きで取得
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  -- 3. 存在チェック
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift not found: %', p_shift_id;
  END IF;

  -- 4. 権限チェック (tenant_members JOIN store_members AND 二段ゲート):
  --    tenant_members.role IN ('owner','manager') AND store_members.is_manager = true
  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    JOIN public.store_members sm ON sm.member_id = tm.id
    WHERE tm.user_id = auth.uid()
      AND tm.tenant_id = v_shift.tenant_id
      AND tm.role IN ('owner', 'manager')
      AND sm.store_id = v_shift.store_id
      AND sm.is_manager = true
  ) THEN
    RAISE EXCEPTION 'permission denied (store manager required)'
      USING ERRCODE = '42501';
  END IF;

  -- 5. 状態遷移チェック: approvedのみ差し戻し可能
  IF v_shift.status <> 'approved' THEN
    RAISE EXCEPTION 'cannot revert: not in approved state, current=%', v_shift.status;
  END IF;

  -- 6. escape hatch: trigger 経由 RPC として通過させる
  PERFORM set_config('app.allow_direct_tentative', '1', true);

  -- 7. approved → tentative へ更新
  --    tentative_approved_by / tentative_approved_at は触らない
  UPDATE public.shifts
  SET status      = 'tentative',
      reviewed_by = NULL,
      reviewed_at = NULL
  WHERE id = p_shift_id
  RETURNING * INTO v_result;

  -- 8. 結果返却
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revert_shift_to_tentative(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_shift_to_tentative(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.revert_shift_to_tentative(uuid) TO authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK 手順
-- ============================================================
-- DROP FUNCTION IF EXISTS public.revert_shift_to_tentative(uuid);
