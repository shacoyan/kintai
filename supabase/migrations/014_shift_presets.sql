CREATE TABLE shift_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX idx_shift_presets_tenant ON shift_presets(tenant_id);

ALTER TABLE shift_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shift_presets_select" ON shift_presets FOR SELECT
  USING (tenant_id IN (SELECT get_my_tenant_ids()));

CREATE POLICY "shift_presets_insert" ON shift_presets FOR INSERT
  WITH CHECK (
    is_tenant_owner(tenant_id)
    OR EXISTS (
      SELECT 1 FROM tenant_members
      WHERE tenant_id = shift_presets.tenant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "shift_presets_update" ON shift_presets FOR UPDATE
  USING (
    is_tenant_owner(tenant_id)
    OR EXISTS (
      SELECT 1 FROM tenant_members
      WHERE tenant_id = shift_presets.tenant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "shift_presets_delete" ON shift_presets FOR DELETE
  USING (
    is_tenant_owner(tenant_id)
    OR EXISTS (
      SELECT 1 FROM tenant_members
      WHERE tenant_id = shift_presets.tenant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  );
