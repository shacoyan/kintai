-- tenants テーブル
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  owner_id UUID REFERENCES auth.users(id) NOT NULL
);

-- tenant_members テーブル
CREATE TABLE tenant_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT CHECK (role IN ('owner', 'admin', 'staff')) DEFAULT 'staff',
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

-- attendance_records テーブル
CREATE TABLE attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  clock_in TIMESTAMPTZ,
  clock_out TIMESTAMPTZ,
  break_start TIMESTAMPTZ,
  break_end TIMESTAMPTZ,
  total_work_minutes INTEGER,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id, date)
);

-- RLS有効化
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

-- tenants ポリシー
CREATE POLICY "Members can view their tenants" ON tenants
  FOR SELECT USING (id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

CREATE POLICY "Authenticated users can create tenants" ON tenants
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

-- tenant_members ポリシー
CREATE POLICY "Members can view co-members" ON tenant_members
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

CREATE POLICY "Owner/admin can insert members" ON tenant_members
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
    OR NOT EXISTS (SELECT 1 FROM tenant_members WHERE tenant_id = tenant_members.tenant_id)
  );

-- attendance_records ポリシー
CREATE POLICY "Users view own records" ON attendance_records
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admin view tenant records" ON attendance_records
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')));

CREATE POLICY "Users insert own records" ON attendance_records
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own records" ON attendance_records
  FOR UPDATE USING (user_id = auth.uid());
