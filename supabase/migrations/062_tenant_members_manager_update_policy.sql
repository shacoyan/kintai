-- Migration 062: tenant_members UPDATE policy を manager にも開放
--
-- 背景:
--   Loop 5 で TenantPage の「バイト判定 (is_parttime)」UI を manager にも開放するため、
--   tenant_members UPDATE を manager にも許可する必要がある。
--   既存 008 の "owner_can_update_tenant_members" は owner のみ UPDATE 可。
--
-- 方針:
--   - 008 既存 policy は DROP しない (owner 用として残置)。
--   - 新規 policy "tenant_members_managerial_update" を追加し、
--     is_tenant_managerial(tenant_id) (= owner OR manager) なら UPDATE 可とする。
--   - 列レベル制御は行わない (manager の権限範囲は UI 側 + Loop 5 で TenantPage の編集対象列を制御)。
--     設計書 §7-Loop-5 には列レベル制限の明記がないため、policy 拡張のみで完結させる。
--   - cross-tenant 偽装防止は is_tenant_managerial() が SECURITY DEFINER で
--     auth.uid() と tenant_id を厳密に照合するため担保される。
--
-- Depends:
--   - 008_fix_tenant_members_update_rls.sql (is_tenant_owner / owner_can_update_tenant_members)
--   - 058_tasks_projects_rls_and_helpers.sql (is_tenant_managerial)
--   - 061_tenant_members_grant_parttime.sql (is_parttime 列 GRANT)

BEGIN;

-- 新規 policy: manager (含 owner) が同一 tenant の tenant_members を UPDATE 可能
-- 既存 008 policy と OR 評価される (Postgres の RLS は同一 cmd の複数 policy を OR 結合)。
CREATE POLICY "tenant_members_managerial_update"
  ON public.tenant_members
  FOR UPDATE
  TO authenticated
  USING (
    is_tenant_managerial(tenant_id)
  )
  WITH CHECK (
    is_tenant_managerial(tenant_id)
  );

COMMENT ON POLICY "tenant_members_managerial_update" ON public.tenant_members IS
  'Loop 5: TenantPage バイト判定 UI を manager に開放するため UPDATE を許可。'
  '列レベル制限なし (manager の編集対象列は UI 側で制御)。'
  '既存 008 owner_can_update_tenant_members と OR 結合される。';

COMMIT;
