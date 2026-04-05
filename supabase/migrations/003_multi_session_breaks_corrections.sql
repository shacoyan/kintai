-- Migration 003: Multiple sessions per day, breaks table, correction requests
-- Remove UNIQUE constraint to allow multiple clock-in/out per day
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_tenant_id_user_id_date_key;

-- Create breaks table (separate from attendance_records)
CREATE TABLE breaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_record_id UUID REFERENCES attendance_records(id) ON DELETE CASCADE NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE breaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own breaks" ON breaks
  FOR ALL USING (
    attendance_record_id IN (
      SELECT id FROM attendance_records WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admin view tenant breaks" ON breaks
  FOR SELECT USING (
    attendance_record_id IN (
      SELECT id FROM attendance_records WHERE tenant_id IN (
        SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

-- Create correction_requests table
CREATE TABLE correction_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  attendance_record_id UUID REFERENCES attendance_records(id) ON DELETE SET NULL,
  requested_clock_in TIMESTAMPTZ,
  requested_clock_out TIMESTAMPTZ,
  reason TEXT NOT NULL,
  status TEXT CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE correction_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own requests" ON correction_requests
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admin view tenant requests" ON correction_requests
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Users insert own requests" ON correction_requests
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admin update requests" ON correction_requests
  FOR UPDATE USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );
