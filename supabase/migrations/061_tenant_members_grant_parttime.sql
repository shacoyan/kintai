-- Loop 1 GRANT 漏れの追補
-- 037_consolidated_catchup.sql で tenant_members の列単位 GRANT を設定したが、
-- 056 で追加した is_parttime 列の GRANT が漏れていた。
-- 結果として TenantContext.fetchMyParttime() が permission denied で常に false に倒れ、
-- バイト権限制限 (§3-5) が機能しない P0 問題が発生。

BEGIN;

GRANT SELECT (is_parttime) ON public.tenant_members TO authenticated;

COMMENT ON COLUMN public.tenant_members.is_parttime IS
  'バイト判定フラグ。true でアルバイト権限制限 (tasks INSERT 不可 / DELETE 不可 / UPDATE は自分 assignee のみ / projects は SELECT のみ) が RLS で適用される。本人が自分の値を SELECT 可。UPDATE は owner/manager のみ。';

COMMIT;
