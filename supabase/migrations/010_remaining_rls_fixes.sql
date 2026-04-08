-- Migration 010: 残存RLS/スキーマ修正

-- R7-3: breaks テーブルに管理者用 UPDATE/DELETE ポリシー追加
CREATE POLICY "Admin manage tenant breaks" ON breaks
  FOR ALL USING (
    attendance_record_id IN (
      SELECT id FROM attendance_records WHERE tenant_id IN (
        SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

-- R7-4: correction_requests に管理者用 DELETE ポリシー追加
CREATE POLICY "Admin delete requests" ON correction_requests
  FOR DELETE USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- R7-6: 同一ユーザーが同時に複数の未退勤セッションを持てないようにする
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_one_open_session
  ON attendance_records (tenant_id, user_id)
  WHERE clock_out IS NULL;

-- R7-7: tenants テーブルに UPDATE/DELETE ポリシー追加
CREATE POLICY "Owner can update tenant" ON tenants
  FOR UPDATE USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owner can delete tenant" ON tenants
  FOR DELETE USING (owner_id = auth.uid());

-- R7-10: attendance_records の旧カラム削除
ALTER TABLE attendance_records DROP COLUMN IF EXISTS break_start;
ALTER TABLE attendance_records DROP COLUMN IF EXISTS break_end;

-- R7-12: 管理者用 attendance_records UPDATE ポリシーに WITH CHECK 追加
DROP POLICY IF EXISTS "Admin update attendance" ON attendance_records;
CREATE POLICY "Admin update attendance" ON attendance_records
  FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );
