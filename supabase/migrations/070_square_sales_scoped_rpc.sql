-- ============================================================================
-- 070_square_sales_scoped_rpc.sql
-- ----------------------------------------------------------------------------
-- 目的:
--   Square 売上（square_dashboard.daily_sales / daily_sales_by_category）を
--   kintai フロントから読む際に「staff は自店の売上のみ・owner/manager は全店」
--   を **DB 側で強制**する。SECURITY DEFINER RPC を唯一の読み口にし、
--   authenticated の直 SELECT 権限を剥がして越権（curl で他店売上取得）を遮断する。
--   オーナー裁定「DB でスコープ強制を前倒す」（Loop2 Phase 2-1）の実装。
--
-- 対象 project:
--   kintai  = zjjbfffhbobwwxyvdszl   （★ apply 前に list_projects で name 必ず確認。
--                                       receipt-scanner=zzopayofegpmdkwckstq への
--                                       誤投入事故防止）
--
-- 内容:
--   (A) square_dashboard.get_allowed_location_ids(text[])  … 許可 location_id 集合
--   (B) square_dashboard.get_sales_range_scoped(date,date,text[]) … 集計 jsonb
--       （/api/sales-range の SalesRangeResponse と同型 { byDate, meta }）
--   (C) 両関数の権限 4 行テンプレ（PUBLIC/anon REVOKE + authenticated GRANT）
--   (D) daily_sales / daily_sales_by_category の authenticated 直 SELECT 遮断
--       （table REVOKE + SELECT ポリシー DROP）。locations_meta / aggregation_runs
--       は剥がさない（Loop1 useSalesScope が locations_meta 直 SELECT 依存）。
--
-- 可逆性:
--   付加的・非破壊。データ変更なし（権限/関数のみ）。ロールバックは
--   GRANT SELECT ON ... TO authenticated; + 旧 SELECT ポリシー再作成で復帰可。
--   関数は DROP FUNCTION で除去可。
--
-- 冪等性:
--   CREATE OR REPLACE FUNCTION / DROP POLICY IF EXISTS / REVOKE（不在でも非エラー）
--   で再実行安全。
--
-- ★ apply 前に秘書/Tech Lead が確認すべき事項:
--   1) project name = kintai (zjjbfffhbobwwxyvdszl) であること。
--   2) daily_sales / daily_sales_by_category の **実 SELECT ポリシー名**。
--      設計書は sdb_daily_sales_select_auth / sdb_daily_category_select_auth と
--      想定するが、実名は↓で確認し、(D) の DROP POLICY 名を合わせること:
--        SELECT schemaname, tablename, policyname, cmd, roles, qual
--        FROM pg_policies
--        WHERE schemaname='square_dashboard'
--          AND tablename IN ('daily_sales','daily_sales_by_category');
--      （DROP POLICY IF EXISTS は不在なら無害だが、実名がズレると古い qual=true
--       SELECT ポリシーが残る → ただし table SELECT grant が無ければ到達不能。
--       それでも混乱回避のため実名で確実に DROP すること。）
--   3) 旧 square-dashboard（別 project / 別 key）が authenticated ロールで
--      daily_sales を読んでいないこと（実査では api は service_role / Square 直で
--      DB に来るため authenticated REVOKE の影響なし＝偽トークン認証は anon/
--      service_role 想定。念のため確認）。
--   4) apply 後に get_advisors（security/performance）を再チェック。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (A) 許可 location_id 集合を返す内部ヘルパ
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION square_dashboard.get_allowed_location_ids(
  p_location_names text[] DEFAULT NULL
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          uuid;
  v_can_view_all boolean;
  v_loc_ids      text[];
BEGIN
  -- 1. 認証ユーザー。未認証なら fail-closed（空配列）。
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;

  -- 2. owner/manager 判定（uid が少なくとも 1 テナントで owner/manager なら全店可）。
  v_can_view_all := EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    WHERE tm.user_id = v_uid
      AND tm.role IN ('owner', 'manager')
  );

  -- 3. 許可 Square 名集合 → location_id[] へ変換。
  IF v_can_view_all THEN
    -- owner/manager: active 全店
    SELECT array_agg(DISTINCT lm.location_id)
    INTO v_loc_ids
    FROM square_dashboard.locations_meta lm
    WHERE lm.is_active = true
      AND (
        p_location_names IS NULL
        OR array_length(p_location_names, 1) IS NULL
        OR lm.location_name = ANY (p_location_names)   -- 4. リクエスト交差
      );
  ELSE
    -- staff: 所属店のみ。store_members(member_id=tenant_members.id)
    --        → stores.name → CASE(こまいぬ→狛犬) で Square 名化
    --        → locations_meta(location_name) INNER JOIN（未マッチ店は自然に除外）
    SELECT array_agg(DISTINCT lm.location_id)
    INTO v_loc_ids
    FROM public.tenant_members tm
    JOIN public.store_members sm
      ON sm.member_id = tm.id
    JOIN public.stores st
      ON st.id = sm.store_id
    JOIN square_dashboard.locations_meta lm
      ON lm.location_name = (
           CASE WHEN st.name = 'こまいぬ' THEN '狛犬' ELSE st.name END
         )
     AND lm.is_active = true
    WHERE tm.user_id = v_uid
      AND (
        p_location_names IS NULL
        OR array_length(p_location_names, 1) IS NULL
        OR lm.location_name = ANY (p_location_names)   -- 4. リクエスト交差（越権は黙って無視）
      );
  END IF;

  RETURN COALESCE(v_loc_ids, ARRAY[]::text[]);
END;
$$;

-- ----------------------------------------------------------------------------
-- (B) メイン RPC: 前日まで集計の byDate を返す（SalesRangeResponse 互換）
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION square_dashboard.get_sales_range_scoped(
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
  v_loc_ids text[];
  v_by_date jsonb;
  v_dates   text[];
BEGIN
  -- 1. 許可 location 集合。空なら fail-closed。
  v_loc_ids := square_dashboard.get_allowed_location_ids(p_location_names);
  IF v_loc_ids IS NULL OR array_length(v_loc_ids, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'byDate', '{}'::jsonb,
      'meta', jsonb_build_object(
        'source', 'aggregate',
        'location_ids', '[]'::jsonb,
        'live_dates', '[]'::jsonb,
        'aggregate_dates', '[]'::jsonb,
        'future_dates', '[]'::jsonb,
        'use_aggregate', true,
        'empty', true
      )
    );
  END IF;

  -- 2. 期間ガード（1 年上限 = DoS 抑止）。
  IF p_to < p_from THEN
    RAISE EXCEPTION 'p_to must be >= p_from';
  END IF;
  IF (p_to - p_from) > 366 THEN
    RAISE EXCEPTION 'date range too large (max 366 days)';
  END IF;

  -- 3+4. daily_sales 集計 + categories 集計 を date 単位でまとめ byDate を構築。
  --   二重行回避: ds.start_hour = lm.business_day_start_hour（=正本 11）で JOIN。
  --   客数は 4(5) セグ生値を返す。customer_count 列も返すがフロントは使わない。
  WITH sales AS (
    SELECT
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
    GROUP BY ds.business_date
  ),
  cat_rows AS (
    -- category_name の NULL/空は '不明' に丸める（api/sales-range.js と整合）
    SELECT
      dc.business_date::text                        AS d,
      COALESCE(NULLIF(dc.category_name, ''), '不明') AS cat_key,
      -- 同名グループ内で非 NULL の category_id を採用
      (array_remove(array_agg(dc.category_id), NULL))[1] AS category_id,
      sum(dc.sales)                                 AS sales,
      sum(dc.item_count)                            AS item_count
    FROM square_dashboard.daily_sales_by_category dc
    JOIN square_dashboard.locations_meta lm
      ON lm.location_id = dc.location_id
     AND dc.start_hour  = lm.business_day_start_hour
    WHERE dc.location_id = ANY (v_loc_ids)
      AND dc.business_date BETWEEN p_from AND p_to
    GROUP BY dc.business_date, COALESCE(NULLIF(dc.category_name, ''), '不明')
  ),
  cat_agg AS (
    -- date ごとに categories[]（sales 降順）を組み立て
    SELECT
      c.d,
      jsonb_agg(
        jsonb_build_object(
          'category_id',   c.category_id,
          'category_name', c.cat_key,
          'sales',         c.sales,
          'item_count',    c.item_count
        )
        ORDER BY c.sales DESC
      ) AS categories
    FROM cat_rows c
    GROUP BY c.d
  )
  SELECT jsonb_object_agg(
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
      'open_order_count',        s.open_order_count,
      'categories',              COALESCE(ca.categories, '[]'::jsonb)
    )
  )
  INTO v_by_date
  FROM sales s
  LEFT JOIN cat_agg ca ON ca.d = s.d;

  v_by_date := COALESCE(v_by_date, '{}'::jsonb);

  -- aggregate_dates: byDate のキー集合
  SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[])
  INTO v_dates
  FROM jsonb_object_keys(v_by_date) AS k;

  -- 5+6. meta（Loop2 は常に aggregate）。
  RETURN jsonb_build_object(
    'byDate', v_by_date,
    'meta', jsonb_build_object(
      'source', 'aggregate',
      'location_ids', to_jsonb(v_loc_ids),
      'live_dates', '[]'::jsonb,
      'aggregate_dates', to_jsonb(v_dates),
      'future_dates', '[]'::jsonb,
      'use_aggregate', true,
      'empty', (v_by_date = '{}'::jsonb)
    )
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- (C) 権限テンプレ（MEMORY RLS 4 行・両関数）
--     search_path は関数定義に内包済み。PUBLIC/anon REVOKE + authenticated GRANT。
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION square_dashboard.get_allowed_location_ids(text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION square_dashboard.get_allowed_location_ids(text[]) FROM anon;
GRANT  EXECUTE ON FUNCTION square_dashboard.get_allowed_location_ids(text[]) TO authenticated;

REVOKE EXECUTE ON FUNCTION square_dashboard.get_sales_range_scoped(date, date, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION square_dashboard.get_sales_range_scoped(date, date, text[]) FROM anon;
GRANT  EXECUTE ON FUNCTION square_dashboard.get_sales_range_scoped(date, date, text[]) TO authenticated;

-- ----------------------------------------------------------------------------
-- (D) 直 SELECT 遮断（RPC 唯一経路化）
--     daily_sales / daily_sales_by_category の authenticated 直読みを剥がす。
--     locations_meta / aggregation_runs は剥がさない（Loop1 依存・売上額を含まない）。
--
--     ★ ポリシー名はプレースホルダ。apply 前に pg_policies で実名確認し合わせること
--       （上記「apply 前に確認すべき事項 2)」参照）。table SELECT grant を REVOKE
--       すれば qual=true ポリシーが残っても到達不能だが、混乱回避のため DROP する。
-- ----------------------------------------------------------------------------
REVOKE SELECT ON square_dashboard.daily_sales             FROM authenticated;
REVOKE SELECT ON square_dashboard.daily_sales_by_category FROM authenticated;

DROP POLICY IF EXISTS sdb_daily_sales_select_auth   ON square_dashboard.daily_sales;
DROP POLICY IF EXISTS sdb_daily_category_select_auth ON square_dashboard.daily_sales_by_category;
