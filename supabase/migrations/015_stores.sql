-- stores テーブル
CREATE TABLE stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, name)
);

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

-- store_members テーブル（多対多: メンバー↔店舗）
CREATE TABLE store_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES tenant_members(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(store_id, member_id)
);

ALTER TABLE store_members ENABLE ROW LEVEL SECURITY;

-- 既存テーブルに store_id を追加（NULL許容＝後方互換）
ALTER TABLE attendance_records ADD COLUMN store_id UUID REFERENCES stores(id) ON DELETE SET NULL;
ALTER TABLE shifts ADD COLUMN store_id UUID REFERENCES stores(id) ON DELETE SET NULL;
ALTER TABLE shift_presets ADD COLUMN store_id UUID REFERENCES stores(id) ON DELETE SET NULL;

-- RLS for stores
CREATE POLICY "Tenant members can view stores" ON stores
  FOR SELECT USING (
    tenant_id IN (SELECT get_my_tenant_ids())
  );

CREATE POLICY "Admins can manage stores" ON stores
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM tenant_members
      WHERE tenant_members.tenant_id = stores.tenant_id
        AND tenant_members.user_id = auth.uid()
        AND tenant_members.role IN ('owner', 'admin')
    )
  );

-- RLS for store_members
CREATE POLICY "Tenant members can view store_members" ON store_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM stores s
      JOIN tenant_members tm ON tm.tenant_id = s.tenant_id
      WHERE s.id = store_members.store_id
        AND tm.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage store_members" ON store_members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM stores s
      JOIN tenant_members tm ON tm.tenant_id = s.tenant_id
      WHERE s.id = store_members.store_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'admin')
    )
  );

-- Performance indexes
CREATE INDEX idx_stores_tenant ON stores(tenant_id);
CREATE INDEX idx_store_members_store ON store_members(store_id);
CREATE INDEX idx_store_members_member ON store_members(member_id);
CREATE INDEX idx_attendance_records_store ON attendance_records(store_id);
CREATE INDEX idx_shifts_store ON shifts(store_id);
