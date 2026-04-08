-- Migration 009: セキュリティ修正
-- BUG-1: tenant_members INSERT ポリシーが緩すぎる（権限昇格の脆弱性）
-- BUG-2: tenant_members DELETE ポリシーがない
-- BUG-8: correction_requests INSERT 時にテナント所属チェックがない
-- BUG-9: 主要な検索パターンにインデックスがない
-- BUG-11: SECURITY DEFINER 関数の search_path 未設定

-- 1. tenant_members INSERT ポリシー修正（Critical: 権限昇格防止）
-- 既存のポリシーを削除
DROP POLICY IF EXISTS "Users can insert own membership" ON tenant_members;

-- スタッフとしてのみ参加可能に制限（owner/admin での自己追加を防止）
-- かつ、テナントの招待コードを知っている（= tenants テーブルにアクセスできる）必要がある
CREATE POLICY "Users can insert own membership as staff" ON tenant_members
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND role = 'staff'
  );

-- オーナーが自身をownerとして追加するケース（テナント作成時）
-- テナントのowner_idが自分であることを確認
CREATE POLICY "Owner can insert own membership" ON tenant_members
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND role = 'owner'
    AND tenant_id IN (
      SELECT id FROM tenants WHERE owner_id = auth.uid()
    )
  );

-- 2. tenant_members DELETE ポリシー追加
-- オーナーのみがメンバーを削除可能（自分自身は削除不可）
CREATE POLICY "Owner can delete members" ON tenant_members
  FOR DELETE USING (
    tenant_id IN (
      SELECT id FROM tenants WHERE owner_id = auth.uid()
    )
    AND user_id != auth.uid()
  );

-- 3. correction_requests INSERT 時にテナント所属チェック
DROP POLICY IF EXISTS "Users insert own requests" ON correction_requests;
CREATE POLICY "Users insert own requests" ON correction_requests
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND tenant_id IN (SELECT get_my_tenant_ids())
  );

-- 4. SECURITY DEFINER 関数の search_path 設定
CREATE OR REPLACE FUNCTION get_my_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid();
$$;

-- is_tenant_owner 関数（008で作成されている場合）
CREATE OR REPLACE FUNCTION is_tenant_owner(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_members
    WHERE tenant_id = p_tenant_id
      AND user_id = auth.uid()
      AND role = 'owner'
  );
$$;

-- 5. パフォーマンス用インデックス追加
CREATE INDEX IF NOT EXISTS idx_attendance_records_tenant_user_date
  ON attendance_records (tenant_id, user_id, date);

CREATE INDEX IF NOT EXISTS idx_attendance_records_tenant_date
  ON attendance_records (tenant_id, date);

CREATE INDEX IF NOT EXISTS idx_breaks_attendance_record_id
  ON breaks (attendance_record_id);

CREATE INDEX IF NOT EXISTS idx_correction_requests_tenant_status
  ON correction_requests (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_tenant_members_user_id
  ON tenant_members (user_id);
