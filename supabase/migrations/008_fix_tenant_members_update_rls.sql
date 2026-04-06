-- Migration 008: Fix infinite recursion in tenant_members UPDATE policy
-- owner_can_update_hourly_rate の EXISTS が tenant_members 自身を参照し無限再帰していた

-- SECURITY DEFINER 関数でオーナー判定（RLSバイパス）
CREATE OR REPLACE FUNCTION is_tenant_owner(tid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_members
    WHERE tenant_id = tid AND user_id = auth.uid() AND role = 'owner'
  );
$$;

-- 再帰する旧ポリシーを削除
DROP POLICY IF EXISTS "owner_can_update_hourly_rate" ON tenant_members;
DROP POLICY IF EXISTS "Owner can update member rates" ON tenant_members;

-- 新ポリシー（SECURITY DEFINER関数を使用）
CREATE POLICY "owner_can_update_tenant_members" ON tenant_members
  FOR UPDATE
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND is_tenant_owner(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND is_tenant_owner(tenant_id)
  );
