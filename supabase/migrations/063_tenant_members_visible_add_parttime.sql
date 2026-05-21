-- Migration 063: tenant_members_visible view に is_parttime 列を追加
--
-- 背景:
--   056_tenant_members_parttime.sql で tenant_members.is_parttime BOOLEAN を追加したが、
--   037_consolidated_catchup.sql §C で定義された tenant_members_visible view は
--   固定列リストで is_parttime を含まない。
--   結果として useTenantAdmin.fetchMembers (view 経由 SELECT) で is_parttime が undefined となり、
--   MemberManagement のバイトトグルが checked 常に false に固定され、UI が DB を反映しない。
--
-- 修正方針 (設計書 §14 v5 Q-T1 案 B):
--   CREATE OR REPLACE VIEW で view を再定義し、末尾に tm.is_parttime を追加。
--   security_invoker = true は維持。GRANT は CREATE OR REPLACE で保持される (再 GRANT 不要)。
--
-- 列追加の安全性:
--   is_parttime は給与情報ではなく、tenant_members の他列と同様の可視性で問題なし
--   (legal_name のような owner/manager 限定列ではない)。
--   security_invoker = true により既存 tenant_members SELECT RLS が view 経由でも適用される。
--
-- Depends:
--   - 037_consolidated_catchup.sql (元 view 定義)
--   - 056_tenant_members_parttime.sql (is_parttime 列)
--   - 061_tenant_members_grant_parttime.sql (列 GRANT)

BEGIN;

CREATE OR REPLACE VIEW public.tenant_members_visible
WITH (security_invoker = true) AS
SELECT
  tm.id,
  tm.tenant_id,
  tm.user_id,
  tm.role,
  tm.display_name,
  CASE
    WHEN tm.user_id = auth.uid() THEN tm.legal_name
    WHEN EXISTS (
      SELECT 1 FROM public.tenant_members me
      WHERE me.tenant_id = tm.tenant_id
        AND me.user_id = auth.uid()
        AND me.role IN ('owner','manager')
    ) THEN tm.legal_name
    ELSE NULL
  END AS legal_name,
  tm.onboarded_at,
  tm.hourly_rate,
  tm.night_shift_enabled,
  tm.pay_type,
  tm.monthly_salary,
  tm.paid_leave_days,
  tm.role_id,
  tm.created_at,
  tm.is_parttime                                              -- ← 追加 (v5 P1-1 修正)
FROM public.tenant_members tm;

COMMENT ON VIEW public.tenant_members_visible IS
  'security_invoker view: tenant_members を SELECT。'
  'legal_name は本人 OR owner/manager のみ非 NULL。'
  '2026-05-22 v5: is_parttime 列を追加 (056 列追加に view が追従していなかった P1-1 を修正)。';

COMMIT;
