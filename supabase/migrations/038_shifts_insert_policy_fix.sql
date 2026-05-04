-- 038_shifts_insert_policy_fix.sql
-- Migration version: 20260504210000
-- 目的: shifts_insert RLS が auth.uid() = user_id を要求し、店長/オーナーが
--       他スタッフのシフト希望承認時に shifts INSERT できないバグを修正。
-- 関連: 012_shifts.sql L30-34 (旧 policy), 017_multi_store_role_and_manager.sql
--       L180-193 (shifts_update の構造を踏襲)
-- 影響: useShiftPreference.approvePreference の INSERT が成功するようになる。
--       client コード修正不要 (RLS のみで完結)。
-- 冪等: DROP POLICY IF EXISTS で再適用可能。

BEGIN;

DROP POLICY IF EXISTS "shifts_insert" ON shifts;

CREATE POLICY "shifts_insert" ON shifts FOR INSERT
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      user_id = auth.uid()
      OR is_tenant_owner(tenant_id)
      OR EXISTS (
        SELECT 1 FROM tenant_members
        WHERE tenant_id = shifts.tenant_id
          AND user_id = auth.uid()
          AND role IN ('owner', 'manager')
      )
    )
  );

COMMIT;

-- ROLLBACK (012 由来の旧 policy へ戻す):
-- BEGIN;
-- DROP POLICY IF EXISTS "shifts_insert" ON shifts;
-- CREATE POLICY "shifts_insert" ON shifts FOR INSERT
--   WITH CHECK (
--     tenant_id IN (SELECT get_my_tenant_ids())
--     AND user_id = auth.uid()
--   );
-- COMMIT;
