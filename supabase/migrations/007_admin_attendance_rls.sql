-- Migration 007: Admin/owner can update and delete attendance records
-- 修正申請承認時に管理者が他スタッフの勤怠レコードを更新・削除するために必要

CREATE POLICY "Admin update tenant records" ON attendance_records
  FOR UPDATE USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM tenant_members
      WHERE tenant_members.user_id = auth.uid()
        AND tenant_members.tenant_id = attendance_records.tenant_id
        AND tenant_members.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Admin delete tenant records" ON attendance_records
  FOR DELETE USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM tenant_members
      WHERE tenant_members.user_id = auth.uid()
        AND tenant_members.tenant_id = attendance_records.tenant_id
        AND tenant_members.role IN ('owner', 'admin')
    )
  );
