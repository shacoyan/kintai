-- ============================================================
-- 039: shift_preferences マネージャー UPDATE RLS policy 追加
-- ============================================================
--
-- version: 20260505000000
--
-- 【目的】
--   prod の shift_preferences には現状 PERMISSIVE policy が 2 本のみ
--   ("Managers can view all shift_preferences" = SELECT 限定 /
--    "Users manage own shift_preferences" = FOR ALL かつ user_id = auth.uid())。
--   manager / owner が他スタッフ行を UPDATE しようとすると後者の qual で 0 行に
--   絞られ、supabase-js は error なし success 扱いとなり approvePreference /
--   rejectPreference / revertPreference の status 更新が無音失敗していた。
--   本 migration は UPDATE 専用の追加 PERMISSIVE policy を 1 本足し、
--   manager / owner が同テナント内の任意の shift_preferences 行を UPDATE
--   できるようにする。PostgreSQL は同 command への複数 PERMISSIVE policy を
--   OR 結合するため、staff の self UPDATE は既存 policy 経由、manager / owner
--   の他人行 UPDATE は本 policy 経由で両立する。
--
-- 【前提】
--   - 035 適用済 (shift_preferences.status カラム + unavailable 自動承認 trigger)
--   - 038 適用済 (shifts INSERT policy 修正)
--   - 037 (consolidated_catchup) は prod 未適用
--   - get_my_tenant_ids() / public.tenant_members(role) は既存
--
-- 【関連 (037 適用時の注意 — DROP 群への追記必須)】
--   037 §6 が "Users manage own shift_preferences" を DROP し
--   shift_preferences_update_with_deadline (manager/owner OR self & 締切前)
--   を CREATE する。本 039 policy は 037 適用後も論理的に subset (manager/owner
--   部分集合) なので動作変化はないが、policy の二重定義を避けるため
--   037 適用 PR では DROP 群に
--     DROP POLICY IF EXISTS "shift_preferences_manager_update" ON public.shift_preferences;
--   を必ず追記すること。
--
-- 【prod 適用順序】
--   035 → 038 → 039  (037 は依然未適用)
--
-- 【既存 policy への影響】
--   - "Users manage own shift_preferences"        : 変更しない
--   - "Managers can view all shift_preferences"   : 変更しない
--
-- ============================================================

BEGIN;

-- 冪等性のため再走時は DROP してから CREATE
DROP POLICY IF EXISTS "shift_preferences_manager_update" ON public.shift_preferences;

-- マネージャー / オーナー UPDATE 用の追加 PERMISSIVE policy
CREATE POLICY "shift_preferences_manager_update"
  ON public.shift_preferences
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND EXISTS (
      SELECT 1
        FROM public.tenant_members tm
       WHERE tm.tenant_id = shift_preferences.tenant_id
         AND tm.user_id = auth.uid()
         AND tm.role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND EXISTS (
      SELECT 1
        FROM public.tenant_members tm
       WHERE tm.tenant_id = shift_preferences.tenant_id
         AND tm.user_id = auth.uid()
         AND tm.role IN ('owner', 'manager')
    )
  );

COMMIT;

-- ============================================================
-- [ROLLBACK]
-- ============================================================
-- 以下 1 行で本 migration を取り消せる:
--   DROP POLICY IF EXISTS "shift_preferences_manager_update" ON public.shift_preferences;
--
-- BEGIN;
--   DROP POLICY IF EXISTS "shift_preferences_manager_update" ON public.shift_preferences;
-- COMMIT;
-- ============================================================
