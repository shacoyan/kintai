-- ============================================================================
-- 071_square_sales_by_location_scoped_rpc.sql
-- ----------------------------------------------------------------------------
-- 目的:
--   owner/manager の「店舗別比較（LocationBarChart）」と YoY（前年同期比）の
--   byLocation 取得のために、店舗別に売上を SUM して返す新 RPC
--   square_dashboard.get_sales_by_location_scoped(date,date,text[]) を追加する。
--   既存 070 の get_sales_range_scoped（byDate 全店合算）は **無改変で温存**し、
--   本 071 は byLocation 分解専用の追加 RPC。スコープ強制は 070 と同じ
--   get_allowed_location_ids(text[]) を再利用して staff 他店遮断を 100% 継承する。
--   オーナー裁定 2026-06-09「案B 採用（店舗別比較・YoY を Loop2 に取り込む）」の実装。
--
-- 対象 project:
--   kintai  = zjjbfffhbobwwxyvdszl   （★ apply 前に list_projects で name 必ず確認。
--                                       receipt-scanner=zzopayofegpmdkwckstq への
--                                       誤投入事故防止）
--
-- 内容:
--   (A) square_dashboard.get_sales_by_location_scoped(date,date,text[])
--       … 許可店ごとに daily_sales を SUM した byLocation 配列 + meta（jsonb）。
--       categories は返さない（byLocation 比較に不要・軽量化）。
--   (B) 権限 4 行テンプレ（PUBLIC/anon REVOKE + authenticated GRANT）。
--
-- スコープ強制（070 と同一・分岐を作らない）:
--   v_loc_ids := square_dashboard.get_allowed_location_ids(p_location_names)
--   で許可集合を再導出。staff は自店のみ・空集合は fail-closed。
--   独自に tenant_members を引き直さない（070 とロジック分岐を作らない）。
--
-- start_hour 二重計上回避（070 と同一）:
--   JOIN locations_meta lm ON lm.location_id = ds.location_id
--                          AND ds.start_hour = lm.business_day_start_hour
--   で「店の正本境界に一致する 1 行」だけを拾う。固定 WHERE start_hour=11 は禁止。
--   同一 (business_date, location_id) に複数 start_hour 行があっても二重計上しない。
--
-- 可逆性:
--   付加的・非破壊。データ変更なし（関数追加のみ）。
--   ロールバックは DROP FUNCTION square_dashboard.get_sales_by_location_scoped(date,date,text[]);
--   で除去可。070 の全店合算は生存（byLocation だけ無効化）。
--
-- 冪等性:
--   CREATE OR REPLACE FUNCTION / REVOKE（不在でも非エラー）で再実行安全。
--
-- ★ apply 前に秘書/Tech Lead が確認すべき事項:
--   1) project name = kintai (zjjbfffhbobwwxyvdszl) であること。
--   2) 070（get_allowed_location_ids / get_sales_range_scoped）が apply 済みであること。
--   3) apply 後に pg_get_functiondef で SECURITY DEFINER / search_path=public,pg_temp /
--      get_allowed_location_ids 呼び出し / start_hour=business_day_start_hour JOIN を確認。
--      acl が {postgres=X, authenticated=X}（anon/PUBLIC 無し）であること。
--   4) apply 後に get_advisors（security/performance）を再チェック。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (A) byLocation RPC: 許可店ごとに daily_sales を SUM して返す。
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION square_dashboard.get_sales_by_location_scoped(
  p_from           date,
  p_to             date,
  p_location_names text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_loc_ids      text[];
  v_by_location  jsonb;
BEGIN
  -- 1. 許可 location 集合を 070 と同一関数で再導出。空なら fail-closed。
  --    staff は自店のみ・他店 inject は intersection で捨てられる（DB 遮断）。
  v_loc_ids := square_dashboard.get_allowed_location_ids(p_location_names);
  IF v_loc_ids IS NULL OR array_length(v_loc_ids, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'byLocation', '[]'::jsonb,
      'meta', jsonb_build_object(
        'source', 'aggregate',
        'location_ids', '[]'::jsonb,
        'use_aggregate', true,
        'empty', true
      )
    );
  END IF;

  -- 2. 期間ガード（070 と同一 = 1 年上限・順序チェック）。
  IF p_to < p_from THEN
    RAISE EXCEPTION 'p_to must be >= p_from';
  END IF;
  IF (p_to - p_from) > 366 THEN
    RAISE EXCEPTION 'date range too large (max 366 days)';
  END IF;

  -- 3. 店舗別 SUM。
  --    二重行回避: ds.start_hour = lm.business_day_start_hour（=正本 11）で JOIN。
  --    客数は 4(5) セグ生値を返す（new/repeat/regular/staff/unlisted）。
  --    customer_count（ユニーク ID 系）も後方互換で返すがフロントは表示/YoY に使わない。
  --    categories は返さない（byLocation 比較に不要・軽量化）。
  WITH per_loc AS (
    SELECT
      lm.location_id                        AS location_id,
      lm.location_name                      AS location_name,
      sum(ds.total_amount)                  AS total_amount,
      sum(ds.open_total_amount)             AS open_total_amount,
      sum(ds.transaction_count)             AS transaction_count,
      sum(ds.customer_count)                AS customer_count,
      sum(ds.new_customer_count)            AS new_customer_count,
      sum(ds.repeat_customer_count)         AS repeat_customer_count,
      sum(ds.regular_customer_count)        AS regular_customer_count,
      sum(ds.staff_customer_count)          AS staff_customer_count,
      sum(ds.unlisted_customer_count)       AS unlisted_customer_count,
      sum(ds.new_sales)                     AS new_sales,
      sum(ds.repeat_sales)                  AS repeat_sales,
      sum(ds.regular_sales)                 AS regular_sales,
      sum(ds.staff_sales)                   AS staff_sales,
      sum(ds.unlisted_sales)                AS unlisted_sales
    FROM square_dashboard.daily_sales ds
    JOIN square_dashboard.locations_meta lm
      ON lm.location_id = ds.location_id
     AND ds.start_hour  = lm.business_day_start_hour
    WHERE ds.location_id = ANY (v_loc_ids)
      AND ds.business_date BETWEEN p_from AND p_to
    GROUP BY lm.location_id, lm.location_name
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'location_id',            p.location_id,
      'location_name',          p.location_name,
      'total_amount',           p.total_amount,
      'open_total_amount',      p.open_total_amount,
      'transaction_count',      p.transaction_count,
      'customer_count',         p.customer_count,
      'new_customer_count',     p.new_customer_count,
      'repeat_customer_count',  p.repeat_customer_count,
      'regular_customer_count', p.regular_customer_count,
      'staff_customer_count',   p.staff_customer_count,
      'unlisted_customer_count',p.unlisted_customer_count,
      'new_sales',              p.new_sales,
      'repeat_sales',           p.repeat_sales,
      'regular_sales',          p.regular_sales,
      'staff_sales',            p.staff_sales,
      'unlisted_sales',         p.unlisted_sales
    )
    ORDER BY p.total_amount DESC
  )
  INTO v_by_location
  FROM per_loc p;

  v_by_location := COALESCE(v_by_location, '[]'::jsonb);

  -- 4. meta（Loop2 は常に aggregate）。
  RETURN jsonb_build_object(
    'byLocation', v_by_location,
    'meta', jsonb_build_object(
      'source', 'aggregate',
      'location_ids', to_jsonb(v_loc_ids),
      'use_aggregate', true,
      'empty', (v_by_location = '[]'::jsonb)
    )
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- (B) 権限テンプレ（MEMORY RLS 4 行）。
--     search_path は関数定義に内包済み。PUBLIC/anon REVOKE + authenticated GRANT。
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION square_dashboard.get_sales_by_location_scoped(date, date, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION square_dashboard.get_sales_by_location_scoped(date, date, text[]) FROM anon;
GRANT  EXECUTE ON FUNCTION square_dashboard.get_sales_by_location_scoped(date, date, text[]) TO authenticated;
