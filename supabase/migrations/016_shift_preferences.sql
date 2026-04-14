-- shift_preferences テーブル（シフト希望提出）
CREATE TABLE shift_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  date DATE NOT NULL,
  preference_type TEXT NOT NULL CHECK (preference_type IN ('available', 'preferred', 'unavailable')),
  start_time TIME,  -- available/preferred の場合のみ
  end_time TIME,    -- available/preferred の場合のみ
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id, date)
);

ALTER TABLE shift_preferences ENABLE ROW LEVEL SECURITY;

-- 自分の希望は自分で管理
CREATE POLICY "Users manage own shift_preferences" ON shift_preferences
  FOR ALL USING (
    user_id = auth.uid()
    AND tenant_id IN (SELECT get_my_tenant_ids())
  );

-- 管理者は全員分閲覧可
CREATE POLICY "Admins can view all shift_preferences" ON shift_preferences
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tenant_members
      WHERE tenant_members.tenant_id = shift_preferences.tenant_id
        AND tenant_members.user_id = auth.uid()
        AND tenant_members.role IN ('owner', 'admin')
    )
  );

CREATE INDEX idx_shift_preferences_tenant_date ON shift_preferences(tenant_id, date);
CREATE INDEX idx_shift_preferences_user ON shift_preferences(user_id);
