-- Migration 092: トリガ/ヘルパ関数の search_path 固定 + anon/PUBLIC EXECUTE 剥奪の横串掃除（P2/P3 B2）
--
-- 背景（実測 2026-06-15・本番 zjjbfffhbobwwxyvdszl の pg_proc.proacl / proconfig + get_advisors）:
--   トリガ専用関数・内部ヘルパ関数に、(a) search_path が role-mutable（proconfig NULL）なものと、
--   (b) anon ロール / PUBLIC に EXECUTE が残るものが混在している。
--   トリガ経由でしか呼ばれない関数でも、anon/PUBLIC が直接 EXECUTE できる状態は攻撃面であり、
--   search_path mutable は SECURITY/trigger 関数の典型脆弱（schema injection）。MEMORY 規律
--   「RLS 4 行テンプレ / SECURITY DEFINER は anon 排除」「SET search_path 固定」に揃える。
--
--   advisor 実測の該当（public スキーマ）:
--     - function_search_path_mutable: shifts_enforce_insert_status / shifts_enforce_approval_order
--         （proconfig=NULL = mutable。item: shifts-approval-trigger-search-path-mutable）
--     - anon_security_definer_function_executable: enforce_store_member_tenant_consistency
--         （proacl に anon=X。item: enforce-store-member-anon-grant）
--   proacl 直査の該当（advisor は SECURITY DEFINER のみ警告するため非 definer 分を補完）:
--     - _night_minutes(timestamp,timestamp): proacl に anon=X（item: night-minutes-helper-anon-grant）
--     - set_member_store_payrolls_updated_at(): proacl に anon=X
--     - shifts_enforce_insert_status / shifts_enforce_approval_order: proacl に PUBLIC(=X) + anon=X
--   （security-definer-revoke-gaps の横串）: 052〜090 の SECURITY DEFINER 関数を pg_proc で全列挙し、
--     上記以外で anon/PUBLIC が残る or search_path mutable な public 関数は無いことを確認した
--     （他の SECURITY DEFINER 関数は proacl が {postgres,authenticated,service_role} のみ・
--      proconfig も search_path=public,pg_temp で固定済。残取り零）。
--
-- 設計方針:
--   各対象関数に対し横串で:
--     ① search_path が mutable なものに ALTER FUNCTION ... SET search_path = public, pg_temp。
--        ただし enforce_store_member_tenant_consistency は既に search_path='' で固定（最も安全）の
--        ため search_path は触らず維持し、anon 剥奪のみ行う（'' は両テーブルを明示スキーマ修飾
--        済の 080 設計と不可分）。
--     ② REVOKE EXECUTE FROM PUBLIC（PUBLIC 継承の取消）+ REVOKE EXECUTE FROM anon（直接 GRANT 取消）。
--        PUBLIC 経由継承は FROM PUBLIC、直接 GRANT は FROM anon の双方が必要（MEMORY 規律）。
--     ③ GRANT EXECUTE TO authenticated（トリガ専用でも MEMORY 規律テンプレに従い明示）。
--   ALTER / REVOKE / GRANT のみで関数本体（ロジック）は一切変更しない → トリガ挙動は不変。
--   引数シグネチャは pg_proc 実査値で厳密指定（_night_minutes のみ2引数、他は引数なし）。
--
-- 横串確認:
--   トリガ関数は BEFORE INSERT/UPDATE で FOR EACH ROW 発火し、トリガ発火は EXECUTE 権限と独立
--   （所有者権限で発火）。よって anon/PUBLIC からの EXECUTE 剥奪は正規のトリガ動作に影響しない。
--   ヘルパ _night_minutes は parttime_labor_for_store(SECURITY DEFINER) から呼ばれ、definer 関数内の
--   呼出は所有者権限で行われるため authenticated だけで足りる（直接 anon EXECUTE を剥奪しても無影響）。
--
-- Rollback / 検証 SQL: 本ファイル末尾コメント参照。

BEGIN;

-- ───────────────────────────────────────────────────────────
-- 1) shifts_enforce_insert_status()  : search_path mutable + PUBLIC/anon EXECUTE
-- ───────────────────────────────────────────────────────────
ALTER FUNCTION public.shifts_enforce_insert_status() SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.shifts_enforce_insert_status() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.shifts_enforce_insert_status() FROM anon;
GRANT  EXECUTE ON FUNCTION public.shifts_enforce_insert_status() TO authenticated;

-- ───────────────────────────────────────────────────────────
-- 2) shifts_enforce_approval_order() : search_path mutable + PUBLIC/anon EXECUTE
-- ───────────────────────────────────────────────────────────
ALTER FUNCTION public.shifts_enforce_approval_order() SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.shifts_enforce_approval_order() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.shifts_enforce_approval_order() FROM anon;
GRANT  EXECUTE ON FUNCTION public.shifts_enforce_approval_order() TO authenticated;

-- ───────────────────────────────────────────────────────────
-- 3) enforce_store_member_tenant_consistency() : anon EXECUTE 残（search_path='' は維持）
--    080 で REVOKE FROM PUBLIC 済だが anon への直接 GRANT が残存 → anon を剥奪。
--    search_path='' は 080 設計（両テーブル明示修飾）と不可分のため触らない。
-- ───────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.enforce_store_member_tenant_consistency() FROM anon;
GRANT  EXECUTE ON FUNCTION public.enforce_store_member_tenant_consistency() TO authenticated;

-- ───────────────────────────────────────────────────────────
-- 4) _night_minutes(timestamp without time zone, timestamp without time zone)
--    給与計算ヘルパ。anon EXECUTE 残（search_path は public,pg_temp で固定済）。
-- ───────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public._night_minutes(timestamp without time zone, timestamp without time zone) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._night_minutes(timestamp without time zone, timestamp without time zone) FROM anon;
GRANT  EXECUTE ON FUNCTION public._night_minutes(timestamp without time zone, timestamp without time zone) TO authenticated;

-- ───────────────────────────────────────────────────────────
-- 5) set_member_store_payrolls_updated_at() : updated_at トリガ。anon EXECUTE 残。
--    search_path は public,pg_temp で固定済。
-- ───────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.set_member_store_payrolls_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_member_store_payrolls_updated_at() FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_member_store_payrolls_updated_at() TO authenticated;

COMMIT;

-- =========================================================================
-- ROLLBACK SQL（092 適用前=anon/PUBLIC へ EXECUTE を戻し search_path を mutable に戻す。手動）
-- =========================================================================
-- BEGIN;
--   ALTER FUNCTION public.shifts_enforce_insert_status() RESET search_path;
--   GRANT EXECUTE ON FUNCTION public.shifts_enforce_insert_status() TO PUBLIC;  -- anon 含む
--   ALTER FUNCTION public.shifts_enforce_approval_order() RESET search_path;
--   GRANT EXECUTE ON FUNCTION public.shifts_enforce_approval_order() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.enforce_store_member_tenant_consistency() TO anon;
--   GRANT EXECUTE ON FUNCTION public._night_minutes(timestamp without time zone, timestamp without time zone) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.set_member_store_payrolls_updated_at() TO PUBLIC;
-- COMMIT;

-- =========================================================================
-- 適用後 検証 SQL（本番で実行・全件 PASS が承認条件）
-- =========================================================================
-- -- 1. 対象 5 関数の proacl に anon / PUBLIC(=X) が無く search_path が固定であること
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--        p.proacl::text, p.proconfig
-- FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
-- WHERE n.nspname='public'
--   AND p.proname IN ('shifts_enforce_insert_status','shifts_enforce_approval_order',
--                     'enforce_store_member_tenant_consistency','_night_minutes',
--                     'set_member_store_payrolls_updated_at')
-- ORDER BY p.proname, args;
-- -- → PASS: proacl に "anon=" と先頭 "=X/"(PUBLIC) が無い / proconfig が search_path 固定。
-- --   （enforce_store_member は search_path="" のまま維持で PASS）
--
-- -- 2. get_advisors(security) の function_search_path_mutable / anon_security_definer が 0 件化
-- --    （MCP get_advisors で目視）。
--
-- -- 3. (正常) トリガが従来どおり発火することを確認（無汚染ロールバック）
-- -- BEGIN;
-- --   -- 越境 store_members INSERT が 23514 で拒否されるか等、080/086 の検証 SQL を再走。
-- -- ROLLBACK;
