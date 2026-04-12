CREATE TABLE leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  date DATE NOT NULL,
  leave_type TEXT NOT NULL
    CHECK (leave_type IN ('paid', 'half_paid', 'absence', 'other')),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id, date)
);

-- 有給残日数管理
ALTER TABLE tenant_members
  ADD COLUMN paid_leave_days NUMERIC(4,1) DEFAULT 0;

CREATE INDEX idx_leave_requests_tenant_date ON leave_requests(tenant_id, date);
CREATE INDEX idx_leave_requests_status ON leave_requests(tenant_id, status);

-- RLS
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_select" ON leave_requests FOR SELECT
  USING (tenant_id IN (SELECT get_my_tenant_ids()));

CREATE POLICY "leave_insert" ON leave_requests FOR INSERT
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND user_id = auth.uid()
  );

CREATE POLICY "leave_update" ON leave_requests FOR UPDATE
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      user_id = auth.uid()
      OR is_tenant_owner(tenant_id)
      OR EXISTS (
        SELECT 1 FROM tenant_members
        WHERE tenant_id = leave_requests.tenant_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'admin')
      )
    )
  );

CREATE POLICY "leave_delete" ON leave_requests FOR DELETE
  USING (
    (user_id = auth.uid() AND status = 'pending')
    OR is_tenant_owner(tenant_id)
  );
