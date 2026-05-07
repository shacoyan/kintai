-- Migration 041: Supabase advisor WARN 修正 (Loop 2)
-- Scope A: function_search_path_mutable × 2 を SET search_path = public, pg_temp で固定
-- Scope B: anon_security_definer_function_executable × 8 を REVOKE EXECUTE FROM anon
-- 影響範囲: アプリ UI / RLS / trigger いずれにも副作用なし (詳細は設計書 §4.4)
-- 冪等性: ALTER FUNCTION SET / REVOKE EXECUTE は何度実行しても安全
-- 関連設計書: .company/engineering/docs/2026-05-07-kintai-backlog-loop2-techdesign.md

-- Scope A-1: enforce_unavailable_auto_approve() (元: migration 035)
ALTER FUNCTION public.enforce_unavailable_auto_approve()
  SET search_path = public, pg_temp;

-- Scope A-2: is_tenant_owner(uuid) (元: migration 008/009 オーバーロード)
ALTER FUNCTION public.is_tenant_owner(uuid)
  SET search_path = public, pg_temp;

-- Scope B-1: complete_onboarding (元: migration 037 L695-)
REVOKE EXECUTE ON FUNCTION public.complete_onboarding(UUID, TEXT, TEXT) FROM anon;

-- Scope B-2: get_my_tenant_ids (元: migration 037 L402- / 031 L21- / 009 L52-)
REVOKE EXECUTE ON FUNCTION public.get_my_tenant_ids() FROM anon;

-- Scope B-3: increment_invite_code_use (元: migration 037 L522- / 033 L20-)
REVOKE EXECUTE ON FUNCTION public.increment_invite_code_use(UUID) FROM anon;

-- Scope B-4: is_tenant_owner (元: migration 008 L5- / 009 L61-)
REVOKE EXECUTE ON FUNCTION public.is_tenant_owner(UUID) FROM anon;

-- Scope B-5: join_tenant_with_invite (元: migration 037 L561- / 033 L70-)
REVOKE EXECUTE ON FUNCTION public.join_tenant_with_invite(TEXT, TEXT) FROM anon;

-- Scope B-6: notify_admins_of_unavailable_preference (元: migration 035 L54-)
REVOKE EXECUTE ON FUNCTION public.notify_admins_of_unavailable_preference() FROM anon;

-- Scope B-7: soft_delete_tenant (元: migration 037 L416- / 031 L35-)
REVOKE EXECUTE ON FUNCTION public.soft_delete_tenant(UUID) FROM anon;

-- Scope B-8: transfer_tenant_ownership (元: migration 037 L447- / 032 L9-)
REVOKE EXECUTE ON FUNCTION public.transfer_tenant_ownership(UUID, UUID) FROM anon;

-- 適用後検証 (運用者用、コメントアウト):
-- 1. search_path 確認:
--   SELECT proname, prosecdef, proconfig FROM pg_proc
--   WHERE proname IN ('enforce_unavailable_auto_approve', 'is_tenant_owner');
--   → proconfig に {search_path=public, pg_temp} が含まれること
--
-- 2. anon 権限確認 (8 関数とも false 期待):
--   SELECT has_function_privilege('anon', 'public.complete_onboarding(uuid, text, text)', 'EXECUTE');
--   ... (他 7 関数も同様)
