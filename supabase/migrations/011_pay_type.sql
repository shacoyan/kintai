-- 給与タイプと月給カラムを追加
ALTER TABLE tenant_members
  ADD COLUMN pay_type TEXT NOT NULL DEFAULT 'hourly'
    CHECK (pay_type IN ('hourly', 'monthly')),
  ADD COLUMN monthly_salary INTEGER DEFAULT 0;

-- 既存のRLSポリシーでカバー済み（owner/adminのみ更新可能）
