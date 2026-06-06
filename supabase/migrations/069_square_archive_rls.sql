-- 目的: 閲覧不要の退避テーブル（旧 start_hour=13 データ）の RLS を有効化する。
--       advisor critical（RLS 無効=anon が全行 SELECT 可能）を解消する。
--       ポリシーは一切作らない＝全 SELECT 遮断（anon/authenticated とも 0 行）。
--       可逆（ALTER TABLE ... DISABLE ROW LEVEL SECURITY で復帰可）。データは一切変更しない。
-- 対象 project: kintai prod（zjjbfffhbobwwxyvdszl）
--               ※本番 apply はファイル作成後に秘書が supabase MCP で慎重に行う。
--                 apply 先は必ず project name=kintai を list_projects で確認すること
--                 （receipt-scanner=zzopayofegpmdkwckstq への誤投入事故が既知）。
-- 作成日: 2026-06-06
-- 参照: .company/engineering/docs/2026-06-06-kintai-square-integration-impl.md L156-165（Loop 5）
--       square-dashboard/supabase/migrations/sdb_006_archive_start_hour_13.sql（テーブル定義元）
--
-- 対象テーブル2本（sdb_006 で CREATE 済み・確定）:
--   1. square_dashboard.daily_sales_archive_start_hour_13              （日次 / 約 6,160 行）
--   2. square_dashboard.daily_sales_by_category_archive_start_hour_13  （カテゴリ / 約 19,841 行）
--
-- ※ apply 前の念のため確認（秘書向け・任意）:
--     SELECT tablename FROM pg_tables
--     WHERE schemaname = 'square_dashboard' AND tablename LIKE '%archive%';
--   2本（上記）が返ることを確認してから ALTER を実行する。
--   万一テーブル名が上記と異なる場合は実名に置換すること。

ALTER TABLE square_dashboard.daily_sales_archive_start_hour_13 ENABLE ROW LEVEL SECURITY;

ALTER TABLE square_dashboard.daily_sales_by_category_archive_start_hour_13 ENABLE ROW LEVEL SECURITY;

-- ポリシーは意図的に作らない。
-- RLS 有効 + ポリシー無し = 全ロール（anon / authenticated）で SELECT 0 行となり、
-- 退避テーブルが完全に遮断される（= advisor critical 解消）。
