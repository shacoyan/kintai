-- ============================================================================
-- 051_attendance_records_manager_insert_policy.sql
--
-- P0 修正: attendance_records の INSERT policy が `user_id = auth.uid()` のみで、
-- Manager / Owner が他人レコードを INSERT する policy が欠落していた。
--
-- 影響:
--   - useCorrection.reviewRequest の attendance_record_id IS NULL パスで、
--     承認者 (Manager/Owner) が申請者 (target.user_id) の打刻を INSERT しようと
--     する際に RLS で 0 行に弾かれ、`.select()` 未使用のため silent success として
--     握りつぶされていた。
--   - AttendanceAdmin.tsx の手動 INSERT (店長が他スタッフの打刻を新規登録) も同根。
--
-- 修正方針:
--   - 既存 self policy ("Users insert own records") は残し、Manager/Owner 用の
--     INSERT policy を追加 (OR 評価)。
--   - SELECT / UPDATE / DELETE には Manager 専用 policy が既にあるため、INSERT を
--     追加することで 4 操作の横串が揃う (MEMORY: "RLS policy 修正の鉄則")。
--
-- 設計書: .company/engineering/docs/2026-05-15-kintai-correction-approval-bug-techdesign.md
-- ============================================================================

CREATE POLICY "Managers can insert tenant records"
  ON public.attendance_records
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );
