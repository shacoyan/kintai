-- ============================================================================
-- 077_square_sales_by_location_daily_scoped_rpc.sql
-- ----------------------------------------------------------------------------
-- 目的:
--   Wave3 の「店舗別 × 日別トレンド」（B22 LocationTrendChart / 曜日×店舗ヒート
--   マップ WeekdayLocation*）のために、店舗ごとに「日別」の売上・客数セグメントを
--   返す新 RPC square_dashboard.get_sales_by_location_daily_scoped(date,date,text[])
--   を追加する。
--   既存 070 get_sales_range_scoped（byDate 全店合算）・071
--   get_sales_by_location_scoped（byLocation 期間合算）は **無改変で温存**し、
--   本 077 は「店舗別 × 日別」分解専用の追加 RPC。スコープ強制は 070/071/072 と
--   同じ get_allowed_location_ids(text[]) を再利用し staff 他店遮断を 100% 継承する。
--   categories は返さない（byLocation トレンドに不要・レスポンス軽量化）。
--
-- 対象 project:
--   kintai  = zjjbfffhbobwwxyvdszl   （★ apply 前に list_projects で name 必ず確認。
--                                       receipt-scanner=zzopayofegpmdkwckstq への
--                                       誤投入事故防止）
--
-- スコープ強制（070/071/072 と同一・分岐を作らない）:
--   v_loc_ids := square_dashboard.get_allowed_location_ids(p_location_names)
--   で許可集合を再導出。staff は自店のみ・空集合は fail-closed（空構造を返す）。
--   独自に tenant_members を引き直さない（070/071/072 とロジック分岐を作らない）。
--
-- start_hour 二重計上回避（070/071 と同一）:
--   JOIN locations_meta lm ON lm.location_id = ds.location_id
--                          AND ds.start_hour = lm.business_day_start_hour
--   で「店の正本境界に一致する 1 行」だけを拾う。固定 WHERE start_hour=11 は禁止
--   （cron 巻き戻し耐性のため列駆動）。同一 (business_date, location_id) に複数
--   start_hour 行があっても二重計上しない。
--
-- 可逆性:
--   付加的・非破壊。データ変更なし（関数追加のみ）。
--   ロールバックは
--     DROP FUNCTION square_dashboard.get_sales_by_location_daily_scoped(date,date,text[]);
--   で除去可。070/071 は生存（店舗別×日別だけ無効化）。
--
-- 冪等性:
--   CREATE OR REPLACE FUNCTION / REVOKE（不在でも非エラー）で再実行安全。
--
-- ★ apply 前に秘書/Tech Lead が確認すべき事項:
--   1) project name = kintai (zjjbfffhbobwwxyvdszl) であること。
--   2) 070（get_allowed_location_ids）が apply 済みであること。
--   3) apply 後に pg_get_functiondef で SECURITY DEFINER / search_path=public,pg_temp /
--      get_allowed_location_ids 呼び出し / start_hour=business_day_start_hour JOIN を確認。
--      acl が {postgres=X, authenticated=X}（anon/PUBLIC 無し）であること。
--   4) apply 後に get_advisors（security/performance）を再チェック。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (A) byLocationDaily RPC: 許可店ごとに daily_sales を「日別」に SUM して返す。
--     返り契約:
--       {
--         byLocationDaily: [
--           { location_id, location_name,
--             days: { 'YYYY-MM-DD': {...070 byDate per-day と同型（categories 除く）...} } }
--           // total_amount 総和 DESC 並び
--         ],
--         allDates: ['YYYY-MM-DD', ...],   // 全店横断・昇順 distinct
--         meta: { source, location_ids, use_aggregate, empty }
--       }
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION square_dashboard.get_sales_by_location_daily_scoped(
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
  v_loc_ids            text[];
  v_by_location_daily  jsonb;
  v_all_dates          text[];
BEGIN
  -- 1. 許可 location 集合。空なら fail-closed（空構造）。
  v_loc_ids := square_dashboard.get_allowed_location_ids(p_location_names);
  IF v_loc_ids IS NULL OR array_length(v_loc_ids, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'byLocationDaily', '[]'::jsonb,
      'allDates', '[]'::jsonb,
      'meta', jsonb_build_object(
        'source', 'aggregate',
        'location_ids', '[]'::jsonb,
        'use_aggregate', true,
        'empty', true
      )
    );
  END IF;

  -- 2. 期間ガード（1 年上限 = DoS 抑止。070/071 と同一）。
  IF p_to < p_from THEN
    RAISE EXCEPTION 'p_to must be >= p_from';
  END IF;
  IF (p_to - p_from) > 366 THEN
    RAISE EXCEPTION 'date range too large (max 366 days)';
  END IF;

  -- 3. daily_sales を店舗 × 日別に SUM。
  --    二重行回避: ds.start_hour = lm.business_day_start_hour（=正本）で JOIN。
  --    客数は 4(5) セグ生値 + customer_count（後方互換・フロント不使用）を返す。
  --    categories は集計しない（軽量化）。
  WITH sales AS (
    SELECT
      lm.location_id                        AS location_id,
      lm.location_name                      AS location_name,
      ds.business_date::text                AS d,
      sum(ds.total_amount)                  AS total_amount,
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
      sum(ds.unlisted_sales)                AS unlisted_sales,
      sum(ds.open_total_amount)             AS open_total_amount,
      sum(ds.open_order_count)              AS open_order_count
    FROM square_dashboard.daily_sales ds
    JOIN square_dashboard.locations_meta lm
      ON lm.location_id = ds.location_id
     AND ds.start_hour  = lm.business_day_start_hour
    WHERE ds.location_id = ANY (v_loc_ids)
      AND ds.business_date BETWEEN p_from AND p_to
    GROUP BY lm.location_id, lm.location_name, ds.business_date
  ),
  per_loc AS (
    -- 店舗ごとに days（jsonb_object_agg）と並び替え用 total_amount 総和を構築。
    SELECT
      s.location_id,
      s.location_name,
      sum(s.total_amount) AS loc_total_amount,
      jsonb_object_agg(
        s.d,
        jsonb_build_object(
          'total_amount',            s.total_amount,
          'transaction_count',       s.transaction_count,
          'customer_count',          s.customer_count,
          'new_customer_count',      s.new_customer_count,
          'repeat_customer_count',   s.repeat_customer_count,
          'regular_customer_count',  s.regular_customer_count,
          'staff_customer_count',    s.staff_customer_count,
          'unlisted_customer_count', s.unlisted_customer_count,
          'new_sales',               s.new_sales,
          'repeat_sales',            s.repeat_sales,
          'regular_sales',           s.regular_sales,
          'staff_sales',             s.staff_sales,
          'unlisted_sales',          s.unlisted_sales,
          'open_total_amount',       s.open_total_amount,
          'open_order_count',        s.open_order_count
        )
      ) AS days
    FROM sales s
    GROUP BY s.location_id, s.location_name
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'location_id',   pl.location_id,
      'location_name', pl.location_name,
      'days',          pl.days
    )
    ORDER BY pl.loc_total_amount DESC NULLS LAST, pl.location_name
  )
  INTO v_by_location_daily
  FROM per_loc pl;

  v_by_location_daily := COALESCE(v_by_location_daily, '[]'::jsonb);

  -- 4. allDates: v_loc_ids ∩ 期間の全日付（distinct・昇順）。
  SELECT COALESCE(array_agg(d ORDER BY d), ARRAY[]::text[])
  INTO v_all_dates
  FROM (
    SELECT DISTINCT ds.business_date::text AS d
    FROM square_dashboard.daily_sales ds
    JOIN square_dashboard.locations_meta lm
      ON lm.location_id = ds.location_id
     AND ds.start_hour  = lm.business_day_start_hour
    WHERE ds.location_id = ANY (v_loc_ids)
      AND ds.business_date BETWEEN p_from AND p_to
  ) q;

  -- 5. 返却。
  RETURN jsonb_build_object(
    'byLocationDaily', v_by_location_daily,
    'allDates', to_jsonb(v_all_dates),
    'meta', jsonb_build_object(
      'source', 'aggregate',
      'location_ids', to_jsonb(v_loc_ids),
      'use_aggregate', true,
      'empty', (v_by_location_daily = '[]'::jsonb)
    )
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- (B) 権限テンプレ（MEMORY RLS 4 行）。
--     search_path は関数定義に内包済み。PUBLIC/anon REVOKE + authenticated GRANT。
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION square_dashboard.get_sales_by_location_daily_scoped(date, date, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION square_dashboard.get_sales_by_location_daily_scoped(date, date, text[]) FROM anon;
GRANT  EXECUTE ON FUNCTION square_dashboard.get_sales_by_location_daily_scoped(date, date, text[]) TO authenticated;
