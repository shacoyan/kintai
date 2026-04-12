CREATE TABLE shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'modified', 'cancelled')),
  original_start_time TIME,
  original_end_time TIME,
  note TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id, date)
);

-- インデックス
CREATE INDEX idx_shifts_tenant_date ON shifts(tenant_id, date);
CREATE INDEX idx_shifts_tenant_user ON shifts(tenant_id, user_id);
CREATE INDEX idx_shifts_status ON shifts(tenant_id, status);

-- RLS
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shifts_select" ON shifts FOR SELECT
  USING (tenant_id IN (SELECT get_my_tenant_ids()));

CREATE POLICY "shifts_insert" ON shifts FOR INSERT
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND user_id = auth.uid()
  );

CREATE POLICY "shifts_update" ON shifts FOR UPDATE
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      user_id = auth.uid()
      OR is_tenant_owner(tenant_id)
      OR EXISTS (
        SELECT 1 FROM tenant_members
        WHERE tenant_id = shifts.tenant_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'admin')
      )
    )
  );

CREATE POLICY "shifts_delete" ON shifts FOR DELETE
  USING (is_tenant_owner(tenant_id));

-- 15分刻みバリデーション
ALTER TABLE shifts ADD CONSTRAINT shifts_start_time_quarter
  CHECK (EXTRACT(MINUTE FROM start_time)::int % 15 = 0 AND EXTRACT(SECOND FROM start_time)::int = 0);
ALTER TABLE shifts ADD CONSTRAINT shifts_end_time_quarter
  CHECK (EXTRACT(MINUTE FROM end_time)::int % 15 = 0 AND EXTRACT(SECOND FROM end_time)::int = 0);
