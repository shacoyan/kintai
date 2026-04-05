-- Migration 004: Add hourly_rate to tenant_members
ALTER TABLE tenant_members ADD COLUMN IF NOT EXISTS hourly_rate INTEGER DEFAULT 0;

-- Owner can update member hourly_rate (uses get_my_tenant_ids from migration 002)
CREATE POLICY "owner_can_update_hourly_rate"
  ON tenant_members
  FOR UPDATE
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM tenant_members tm
      WHERE tm.tenant_id = tenant_members.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role = 'owner'
    )
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM tenant_members tm
      WHERE tm.tenant_id = tenant_members.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role = 'owner'
    )
  );
