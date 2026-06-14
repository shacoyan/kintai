-- Migration 091: 旧 RPC の DROP（P2/P3 B2）
--
-- 背景（実測 2026-06-15・本番 zjjbfffhbobwwxyvdszl）:
--   ① get_monthly_report_all には2引数版(p_year,p_month)と3引数版(p_year,p_month,p_tenant_id)が
--      並存している。2引数版(item: old-monthly-report-all-cross-tenant)は p_tenant_id を取らず
--      テナント横断で集計し得る旧 API で、081 で 3引数版に置換済。フロントは
--      useMonthlyReportAll.ts:62-63 が `{ p_year, p_month, p_tenant_id }` で 3引数版のみ呼ぶ
--      （実査済）。2引数版は実行可能なまま残置 = 越境集計の口が開いている。
--   ② join_tenant_with_invite(text,text) / join_tenant_with_invite_v2(text,text) は
--      v3(per-store invite + 行ロック)へ統合済の旧版(item: legacy-join-rpc-v1-v2-still-executable)。
--      v1 は search_path=public(pg_temp 無し)、v2 も authenticated に EXECUTE 権が残り、
--      フロント(TenantContext.tsx:301)は v3 のみ呼ぶ（実査済）。旧版は招待参加ロジックの
--      二重実装として残り、攻撃面・保守負債。
--
-- 設計方針:
--   フロント実査で参照ゼロを確認した 3 関数を DROP し、正規導線(3引数 monthly_report_all / v3 join)
--   に一本化する。pg_proc 実シグネチャに合わせて引数型を厳密指定し、IF EXISTS で冪等化。
--   3引数版 get_monthly_report_all / join_tenant_with_invite_v3 は残す（DROP しない）。
--   types/supabase.ts の型残骸は B2 では触らない（無害・別バッチ）。
--
-- 横串確認:
--   - get_monthly_report_all(int,int,uuid) は残存（useMonthlyReportAll が使用）。
--   - join_tenant_with_invite_v3(text,text) は残存（TenantContext.joinTenant が使用）。
--   - これらの関数を参照する他 RPC は無し（pg_proc 実査の依存なし）。
--
-- Rollback / 検証 SQL: 本ファイル末尾コメント参照。

BEGIN;

-- ① 旧 2引数版 monthly_report_all（越境集計の口）を除去。3引数版は残す。
DROP FUNCTION IF EXISTS public.get_monthly_report_all(integer, integer);

-- ② 招待参加 v1 / v2 を除去。v3 に一本化。
DROP FUNCTION IF EXISTS public.join_tenant_with_invite(text, text);
DROP FUNCTION IF EXISTS public.join_tenant_with_invite_v2(text, text);

COMMIT;

-- =========================================================================
-- ROLLBACK SQL（091 適用前=旧関数を復元する。手動。本来は復活不要だが緊急時用）
-- =========================================================================
-- 注意: 旧関数の本体は 076/旧 join migration に存在。完全復元が必要なら
--       当該 migration の CREATE OR REPLACE FUNCTION ブロックを再実行すること。
--       本 migration では DROP のみのため、ここでの 1 行復元は不可。

-- =========================================================================
-- 適用後 検証 SQL（本番で実行・全件 PASS が承認条件）
-- =========================================================================
-- -- 1. 旧 3 関数が消滅し、正規版のみ残ることを確認
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
-- FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
-- WHERE n.nspname='public'
--   AND p.proname IN ('get_monthly_report_all','join_tenant_with_invite',
--                     'join_tenant_with_invite_v2','join_tenant_with_invite_v3')
-- ORDER BY p.proname, args;
-- -- → 期待: get_monthly_report_all(p_year integer, p_month integer, p_tenant_id uuid) のみ /
-- --        join_tenant_with_invite_v3(p_invite_code text, p_display_name text) のみ。
-- --        2引数 monthly_report_all / v1 / v2 が結果に出なければ PASS。
