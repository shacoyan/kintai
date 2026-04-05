-- Fix: infinite recursion in tenant_members RLS policy
-- tenant_members のSELECTポリシーが自己参照していたため無限再帰が発生

-- 1. 問題のあるポリシーを削除
DROP POLICY IF EXISTS "Members can view their tenants" ON tenants;
DROP POLICY IF EXISTS "Members can view co-members" ON tenant_members;
DROP POLICY IF EXISTS "Owner/admin can insert members" ON tenant_members;
DROP POLICY IF EXISTS "Admin view tenant records" ON attendance_records;

-- 2. SECURITY DEFINER関数（RLSをバイパスしてtenant_idを取得）
CREATE OR REPLACE FUNCTION get_my_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid();
$$;

-- 3. 修正版ポリシー
CREATE POLICY "Members can view their tenants" ON tenants
  FOR SELECT USING (id IN (SELECT get_my_tenant_ids()));

CREATE POLICY "Members can view co-members" ON tenant_members
  FOR SELECT USING (tenant_id IN (SELECT get_my_tenant_ids()));

CREATE POLICY "Users can insert own membership" ON tenant_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admin view tenant records" ON attendance_records
  FOR SELECT USING (tenant_id IN (
    SELECT tenant_id FROM tenant_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
