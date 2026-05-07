-- Migration 042: Loop 2 追補 — PUBLIC 経由の anon 継承を遮断
-- 041 で REVOKE FROM anon を実行したが、3 関数は PUBLIC GRANT (=X/postgres)
-- が残存しており anon が PUBLIC 経由で実行可能だった。PUBLIC からも REVOKE する。
-- 影響範囲: authenticated/service_role は proacl で個別 GRANT 済 → 影響なし
-- 冪等性: REVOKE EXECUTE は何度実行しても安全
-- 関連設計書: .company/engineering/docs/2026-05-07-kintai-backlog-loop2-techdesign.md §8

REVOKE EXECUTE ON FUNCTION public.get_my_tenant_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_tenant_owner(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_admins_of_unavailable_preference() FROM PUBLIC;

-- 検証 (運用者用、コメントアウト):
-- SELECT has_function_privilege('anon', 'public.get_my_tenant_ids()', 'EXECUTE');                       -- false 期待
-- SELECT has_function_privilege('anon', 'public.is_tenant_owner(uuid)', 'EXECUTE');                     -- false 期待
-- SELECT has_function_privilege('anon', 'public.notify_admins_of_unavailable_preference()', 'EXECUTE'); -- false 期待
-- SELECT has_function_privilege('authenticated', 'public.get_my_tenant_ids()', 'EXECUTE');              -- true 維持期待
-- SELECT has_function_privilege('authenticated', 'public.is_tenant_owner(uuid)', 'EXECUTE');            -- true 維持期待
