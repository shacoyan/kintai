-- ============================================================================
-- 104_report_shisha_from_square.sql
-- ----------------------------------------------------------------------------
-- 目的（シーシャ本数の自動集計・設計書 2026-06-27-kintai-shisha-auto-count.md §6）:
--   シーシャ提供「本数」を手入力（daily_reports.shisha_count）から Square 由来
--   （square_dashboard.daily_sales.shisha_count = カテゴリ判定済みの本数集計）へ
--   出所を切り替える。客数（人数）と完全に同条件（start_hour=business_day_start_hour
--   JOIN・スコープ強制・期間ガード）で集計し、二重計上を防止する。
--
--   ★ 複数 RPC を 1 migration（=1 トランザクション）でまとめて切り替える。
--     square 側 read RPC（byDate / days / byLocation）に shisha_count を載せてから
--     public 側集計 RPC が byDate.shisha_count を読むため、両者を同一トランザクション
--     で整合的に置換し「byDate に shisha が無いのに月報が byDate.shisha を読む窓」を
--     作らない。
--
-- 対象 project: kintai = zjjbfffhbobwwxyvdszl
--   （★ apply 前に list_projects で name 必ず確認。
--     receipt-scanner=zzopayofegpmdkwckstq への誤投入厳禁）
--
-- 前提（適用順序・逆順厳禁）:
--   1) sdb_010（square_dashboard.daily_sales に shisha_count integer 列を追加）が
--      apply 済みであること。未適用だと sum(ds.shisha_count) が 42703
--      column does not exist で RPC 定義に失敗する。必ず sdb_010 → 本 104 の順。
--   2) 070/071/072/073/077（square 側 read RPC 群と helper）・081（public 集計 RPC）
--      が apply 済みであること。本 104 はそれらの最新本体を完全継承して再定義する。
--
-- 内容（すべて CREATE OR REPLACE・シグネチャ不変・DROP 不要）:
--   (A) square_dashboard.get_sales_range_scoped(date,date,text[])
--       … 073 本体を完全コピー。sales CTE に sum(ds.shisha_count)、byDate
--         jsonb_build_object に 'shisha_count' を末尾追加。
--   (B) square_dashboard.get_sales_by_location_daily_scoped(date,date,text[])
--       … 077 本体を完全コピー。sales CTE + per-day days object に同様追加。
--   (C) square_dashboard.get_sales_by_location_scoped(date,date,text[])
--       … 073 本体を完全コピー。per_loc CTE + byLocation object に同様追加。
--   (D) public.get_daily_report(uuid,date,uuid DEFAULT NULL)
--       … 081 本体を完全コピー。square ブロックに
--         'shisha_count', COALESCE((v_day ->> 'shisha_count')::bigint, 0) を追加。
--         manual ブロックの 'shisha_count'（v_dr.shisha_count / 未入力時 0）は撤去。
--   (E) public.get_monthly_report(uuid,int,int,uuid DEFAULT NULL)
--       … 081 本体を完全コピー。v_shisha を「byDate(v_by_date) の月内ループで
--         Σ COALESCE((v_d ->> 'shisha_count')::bigint, 0)」へ差し替え。
--         daily_reports の SELECT sum(...) からは shisha だけ外す（incentive/expense
--         群は手入力のまま集計）。戻り JSON の 'shisha_count', v_shisha はキー不変。
--   (F) public.get_monthly_report_all(int,int,uuid)
--       … 081 本体を完全コピー（本体ロジック変更なし）。_all は store ループで
--         get_monthly_report を修飾名で呼ぶ構造で、shisha を独自に引いていない
--         （totals 集約にも shisha は無い）ため (E) の差し替えが自動波及する。
--
-- ★ 底本の差異メモ:
--   設計書は (A)/(C) の底本を「070/071」と記すが、kintai 本番で稼働中の
--   get_sales_range_scoped / get_sales_by_location_scoped の最新本体は 073
--   （tender 4 列 cash/card/external/other_amount を末尾追加した版）である。
--   070/071 をコピーすると tender 4 キーが消え、081 get_daily_report が読む
--   cash_amount が欠落して回帰する。よって本 104 は 073 を底本として完全継承し
--   （tender キー温存）、そこへ shisha_count を追加する。(B) は 077 が単独最新。
--
-- start_hour 二重計上の罠:
--   既存 RPC は JOIN locations_meta lm ON ds.start_hour = lm.business_day_start_hour
--   で正本境界の 1 行だけを拾う。shisha_count も同じ JOIN 配下で sum するので
--   二重計上しない（客数と完全同条件）。固定 start_hour=11 は書かない。
--
-- 認可: shisha_count を返す全 square 側 RPC は get_allowed_location_ids 経由のまま
--   （staff は自店のみ・他店 shisha は intersection で 0）。public 側 RPC は 081 の
--   スコープ判定（get_my_tenant_ids / is_tenant_managerial / is_my_store /
--   p_tenant_id 一致）を 1 文字も変えていない。
--
-- 可逆性: 関数本体のみ差し替え（CREATE OR REPLACE）。データ変更なし。
--         ロールバックは 073/077/081 の本体定義で再 CREATE OR REPLACE すれば復帰。
-- 冪等性: CREATE OR REPLACE FUNCTION / REVOKE（不在でも非エラー）で再実行安全。
-- ============================================================================


-- ============================================================================
-- (A) square_dashboard.get_sales_range_scoped（byDate 全店合算）+ shisha_count
--     底本: 073(A)。差分 = sales CTE に sum(ds.shisha_count)、byDate object に
--           'shisha_count' を末尾追加。他は無改変。
-- ============================================================================
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
  --   tender(cash/card/external/other) は決済済み内訳（末尾キーで後方互換追加）。
  --   shisha_count は同 JOIN 配下で sum（客数と同条件・二重計上しない・末尾追加）。
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
      sum(ds.open_order_count)              AS open_order_count,
      -- tender 内訳（sdb_009 追加列・後方互換）
      sum(ds.cash_amount)                   AS cash_amount,
      sum(ds.card_amount)                   AS card_amount,
      sum(ds.external_amount)               AS external_amount,
      sum(ds.other_amount)                  AS other_amount,
      -- シーシャ本数（sdb_010 追加列・後方互換・start_hour JOIN 配下で二重計上なし）
      sum(ds.shisha_count)                  AS shisha_count
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
      'categories',              COALESCE(ca.categories, '[]'::jsonb),
      -- tender 内訳（後方互換・末尾追加）
      'cash_amount',             s.cash_amount,
      'card_amount',             s.card_amount,
      'external_amount',         s.external_amount,
      'other_amount',            s.other_amount,
      -- シーシャ本数（後方互換・末尾追加）
      'shisha_count',            s.shisha_count
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


-- ============================================================================
-- (B) square_dashboard.get_sales_by_location_daily_scoped（店舗別×日別）+ shisha_count
--     底本: 077(A)。差分 = sales CTE に sum(ds.shisha_count)、per-day days object に
--           'shisha_count' を末尾追加。他は無改変。
-- ============================================================================
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
  --    shisha_count は同 JOIN 配下で sum（客数と同条件・二重計上しない・末尾追加）。
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
      sum(ds.open_order_count)              AS open_order_count,
      -- シーシャ本数（sdb_010 追加列・後方互換）
      sum(ds.shisha_count)                  AS shisha_count
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
          'open_order_count',        s.open_order_count,
          -- シーシャ本数（後方互換・末尾追加）
          'shisha_count',            s.shisha_count
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


-- ============================================================================
-- (C) square_dashboard.get_sales_by_location_scoped（byLocation 期間合算）+ shisha_count
--     底本: 073(B)。差分 = per_loc CTE に sum(ds.shisha_count)、byLocation object に
--           'shisha_count' を末尾追加。他は無改変。
-- ============================================================================
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
  --    tender(cash/card/external/other) は決済済み内訳（末尾キーで後方互換追加）。
  --    shisha_count は同 JOIN 配下で sum（客数と同条件・二重計上しない・末尾追加）。
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
      sum(ds.unlisted_sales)                AS unlisted_sales,
      -- tender 内訳（sdb_009 追加列・後方互換）
      sum(ds.cash_amount)                   AS cash_amount,
      sum(ds.card_amount)                   AS card_amount,
      sum(ds.external_amount)               AS external_amount,
      sum(ds.other_amount)                  AS other_amount,
      -- シーシャ本数（sdb_010 追加列・後方互換）
      sum(ds.shisha_count)                  AS shisha_count
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
      'unlisted_sales',         p.unlisted_sales,
      -- tender 内訳（後方互換・末尾追加）
      'cash_amount',            p.cash_amount,
      'card_amount',            p.card_amount,
      'external_amount',        p.external_amount,
      'other_amount',           p.other_amount,
      -- シーシャ本数（後方互換・末尾追加）
      'shisha_count',           p.shisha_count
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


-- ============================================================================
-- (D) public.get_daily_report(p_store_id uuid, p_business_date date,
--                             p_tenant_id uuid DEFAULT NULL)
--     底本: 081(A-3)。差分 = square ブロックに 'shisha_count' を追加（byDate 由来）、
--           manual ブロックの 'shisha_count'（生値 / 0）を撤去。他は無改変。
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_daily_report(
  p_store_id      uuid,
  p_business_date date,
  p_tenant_id     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- 日報は Square 素値 + 手入力 + 違算（cash_total − square cash）のみを返す。
  -- 税・手数料の定数計算は月報（get_monthly_report）側で行う（裁定3）。
  v_tenant_id     uuid;
  v_store_name    text;
  v_loc_name      text;
  v_scope_ok      boolean;

  v_square        jsonb;
  v_day           jsonb;       -- byDate[p_business_date]
  v_dr            public.daily_reports%ROWTYPE;
  v_report_exists boolean := false;

  v_cash_square   bigint := 0; -- Square tender 現金
  v_disc          bigint;      -- derived 違算（月報 v_disc_total bigint と整合）

  v_labor         integer := 0;
  v_labor_source  text := 'unavailable';
BEGIN
  -- 1. store の tenant_id / name を取得（存在しなければ scope_ok=false）。
  SELECT s.tenant_id, s.name
    INTO v_tenant_id, v_store_name
  FROM public.stores s
  WHERE s.id = p_store_id;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object(
      'store_id', p_store_id,
      'store_name', NULL,
      'business_date', p_business_date,
      'scope_ok', false
    );
  END IF;

  -- 2. 権限判定（自前スコープ・RLS バイパス対策）。
  --    p_tenant_id 指定時は store の実テナントと一致必須（深層防御）。
  --    p_tenant_id IS NULL なら従来挙動（後方互換）。
  v_scope_ok := (
    v_tenant_id IN (SELECT public.get_my_tenant_ids())
    AND (public.is_tenant_managerial(v_tenant_id) OR public.is_my_store(p_store_id))
    AND (p_tenant_id IS NULL OR v_tenant_id = p_tenant_id)
  );

  IF NOT v_scope_ok THEN
    RETURN jsonb_build_object(
      'store_id', p_store_id,
      'store_name', v_store_name,
      'business_date', p_business_date,
      'scope_ok', false
    );
  END IF;

  -- 3. Square 値（Loop A RPC を修飾名で内部呼び出し・二重 fail-closed）。
  --    store.name → CASE 変換 → location_name の 1 要素配列。
  v_loc_name := CASE WHEN v_store_name = 'こまいぬ' THEN '狛犬' ELSE v_store_name END;
  v_square := square_dashboard.get_sales_range_scoped(
                p_business_date, p_business_date, ARRAY[v_loc_name]
              );
  v_day := v_square -> 'byDate' -> (p_business_date::text);

  IF v_day IS NULL THEN
    v_day := '{}'::jsonb;
  END IF;
  v_cash_square := COALESCE((v_day ->> 'cash_amount')::bigint, 0);

  -- 4. daily_reports 手入力（自前スコープ WHERE を再適用）。
  SELECT dr.* INTO v_dr
  FROM public.daily_reports dr
  WHERE dr.store_id = p_store_id
    AND dr.business_date = p_business_date
    AND dr.tenant_id = v_tenant_id
    AND dr.tenant_id IN (SELECT public.get_my_tenant_ids())
    AND (public.is_tenant_managerial(dr.tenant_id) OR public.is_my_store(dr.store_id));
  v_report_exists := FOUND;

  -- 5. 違算（derived.discrepancy）。
  --    手動上書き（discrepancy_amount IS NOT NULL）があればそれを優先。
  --    無ければ RPC 算出 = cash_total − Square tender cash。
  IF v_report_exists AND v_dr.discrepancy_amount IS NOT NULL THEN
    v_disc := v_dr.discrepancy_amount;
  ELSIF v_report_exists THEN
    v_disc := COALESCE(v_dr.cash_total, 0)::bigint - v_cash_square;
  ELSE
    v_disc := NULL;
  END IF;

  -- 6. 人件費（Loop C 後結合・to_regprocedure 動的判定）。
  IF to_regprocedure('public.parttime_labor_for_store(uuid,date,date)') IS NOT NULL THEN
    EXECUTE 'SELECT public.parttime_labor_for_store($1,$2,$3)'
      INTO v_labor USING p_store_id, p_business_date, p_business_date;
    v_labor := COALESCE(v_labor, 0);
    v_labor_source := 'loop_c';
  ELSE
    v_labor := 0;
    v_labor_source := 'unavailable';
  END IF;

  -- 7. 契約 jsonb を組み立て。
  RETURN jsonb_build_object(
    'store_id', p_store_id,
    'store_name', v_store_name,
    'business_date', p_business_date,
    'scope_ok', true,
    'square', jsonb_build_object(
      'total_amount',          COALESCE((v_day ->> 'total_amount')::bigint, 0),
      'open_total_amount',     COALESCE((v_day ->> 'open_total_amount')::bigint, 0),
      'cash_amount',           COALESCE((v_day ->> 'cash_amount')::bigint, 0),
      'card_amount',           COALESCE((v_day ->> 'card_amount')::bigint, 0),
      'external_amount',       COALESCE((v_day ->> 'external_amount')::bigint, 0),
      'other_amount',          COALESCE((v_day ->> 'other_amount')::bigint, 0),
      'transaction_count',     COALESCE((v_day ->> 'transaction_count')::bigint, 0),
      'new_customer_count',    COALESCE((v_day ->> 'new_customer_count')::bigint, 0),
      'repeat_customer_count', COALESCE((v_day ->> 'repeat_customer_count')::bigint, 0),
      'regular_customer_count',COALESCE((v_day ->> 'regular_customer_count')::bigint, 0),
      'staff_customer_count',  COALESCE((v_day ->> 'staff_customer_count')::bigint, 0),
      -- 客数【総】= 4 セグ（unlisted 除外）。§4.5。
      'customer_total',        (
          COALESCE((v_day ->> 'new_customer_count')::bigint, 0)
        + COALESCE((v_day ->> 'repeat_customer_count')::bigint, 0)
        + COALESCE((v_day ->> 'regular_customer_count')::bigint, 0)
        + COALESCE((v_day ->> 'staff_customer_count')::bigint, 0)
      ),
      -- シーシャ本数（出所を手入力→Square へ切替・byDate 由来）。
      'shisha_count',          COALESCE((v_day ->> 'shisha_count')::bigint, 0)
    ),
    'manual', CASE WHEN v_report_exists THEN jsonb_build_object(
      'incentive',        v_dr.incentive,        -- ＝バック金額（裁定1）
      'expense_drink',    v_dr.expense_drink,
      'expense_food',     v_dr.expense_food,
      'expense_flavor',   v_dr.expense_flavor,
      'expense_supplies', v_dr.expense_supplies,
      'expense_other',    v_dr.expense_other,
      'cash_total',       v_dr.cash_total,        -- GENERATED
      'cash_counts', jsonb_build_object(
        '10000', v_dr.cash_count_10000, '5000', v_dr.cash_count_5000,
        '1000',  v_dr.cash_count_1000,  '500',  v_dr.cash_count_500,
        '100',   v_dr.cash_count_100,   '50',   v_dr.cash_count_50,
        '10',    v_dr.cash_count_10,    '5',    v_dr.cash_count_5,
        '1',     v_dr.cash_count_1
      ),
      'pool_amount',               v_dr.pool_amount,
      'discrepancy_amount_manual', v_dr.discrepancy_amount,  -- NULL=自動算出を使う
      'note',                      v_dr.note,
      'report_exists',             true
    ) ELSE jsonb_build_object(
      'incentive', 0,
      'expense_drink', 0, 'expense_food', 0, 'expense_flavor', 0,
      'expense_supplies', 0, 'expense_other', 0,
      'cash_total', 0,
      'cash_counts', jsonb_build_object(
        '10000',0,'5000',0,'1000',0,'500',0,'100',0,'50',0,'10',0,'5',0,'1',0
      ),
      'pool_amount', 0,
      'discrepancy_amount_manual', NULL,
      'note', NULL,
      'report_exists', false
    ) END,
    'labor', jsonb_build_object(
      'parttime_labor', v_labor,
      'source', v_labor_source
    ),
    'derived', jsonb_build_object(
      'discrepancy_amount', v_disc   -- = cash_total − square.cash_amount（手動上書き優先）
    )
  );
END;
$$;


-- ============================================================================
-- (E) public.get_monthly_report(p_store_id uuid, p_year int, p_month int,
--                               p_tenant_id uuid DEFAULT NULL)
--     底本: 081(A-2)。差分 = v_shisha を byDate(v_by_date) 月内ループでの Σ に差替え、
--           daily_reports の SELECT sum(...) から shisha だけ外す。
--           戻り JSON の 'shisha_count', v_shisha はキー不変。他は無改変。
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_monthly_report(
  p_store_id  uuid,
  p_year      int,
  p_month     int,
  p_tenant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- ── 全店一律の料率・税率（裁定3）。変更はこの 3 定数のみ。──
  c_tax_num          CONSTANT integer := 10;
  c_tax_den          CONSTANT integer := 110;
  c_fee_card_bps     CONSTANT integer := 325;
  c_fee_external_bps CONSTANT integer := 198;

  v_tenant_id   uuid;
  v_store_name  text;
  v_loc_name    text;
  v_managerial  boolean;
  v_scope_ok    boolean;

  v_from        date;
  v_to          date;

  v_square      jsonb;
  v_by_date     jsonb;
  v_k           text;
  v_d           jsonb;

  -- Square 月集約（決済済みベース）
  v_sales_cash     bigint := 0;
  v_sales_card     bigint := 0;
  v_sales_external bigint := 0;
  v_sales_other    bigint := 0;
  v_sales_total    bigint := 0;   -- 決済済み total Σ
  v_open_total     bigint := 0;   -- open Σ（total_with_open 用）
  v_cust_new       bigint := 0;
  v_cust_repeat    bigint := 0;
  v_cust_regular   bigint := 0;
  v_cust_staff     bigint := 0;
  v_cust_total     bigint := 0;

  -- シーシャ本数（出所を手入力→Square byDate へ切替・月内 Σ）
  v_shisha        bigint := 0;
  -- daily_reports 月集約（手入力。shisha はここから外した）
  v_incentive     bigint := 0;
  v_exp_drink     bigint := 0;
  v_exp_food      bigint := 0;
  v_exp_flavor    bigint := 0;
  v_exp_supplies  bigint := 0;
  v_exp_other     bigint := 0;
  v_disc_total    bigint := 0;   -- Σ(derived discrepancy)

  -- 派生
  v_avg_spend       numeric;
  v_fee_card        bigint := 0;
  v_fee_external    bigint := 0;
  v_cogs_variable   bigint := 0;
  v_sga_variable    bigint := 0;
  v_consumption_tax bigint := 0;
  v_achievement     numeric;
  v_prov_profit     bigint := 0;
  v_prov_rate       numeric;

  -- settings（固定費生値・売上目標）
  v_st            public.store_monthly_settings%ROWTYPE;
  v_settings_exists boolean := false;
  v_fixed_payroll integer := 0;
  v_rent          integer := 0;
  v_utilities     integer := 0;
  v_comm          integer := 0;
  v_adv           integer := 0;
  v_other_fixed   integer := 0;
  v_sales_target  integer := 0;

  -- 人件費（Loop C）
  v_labor        integer := 0;
  v_labor_source text := 'unavailable';

  v_settings_json jsonb;
  v_target_json   jsonb;
BEGIN
  -- 1. store 解決・権限判定。
  SELECT s.tenant_id, s.name INTO v_tenant_id, v_store_name
  FROM public.stores s WHERE s.id = p_store_id;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object(
      'store_id', p_store_id, 'store_name', NULL,
      'year', p_year, 'month', p_month, 'scope_ok', false
    );
  END IF;

  v_managerial := public.is_tenant_managerial(v_tenant_id);
  -- p_tenant_id 指定時は store の実テナントと一致必須（深層防御）。
  -- p_tenant_id IS NULL なら従来挙動（後方互換）。
  v_scope_ok := (
    v_tenant_id IN (SELECT public.get_my_tenant_ids())
    AND (v_managerial OR public.is_my_store(p_store_id))
    AND (p_tenant_id IS NULL OR v_tenant_id = p_tenant_id)
  );

  IF NOT v_scope_ok THEN
    RETURN jsonb_build_object(
      'store_id', p_store_id, 'store_name', v_store_name,
      'year', p_year, 'month', p_month, 'scope_ok', false
    );
  END IF;

  -- 2. 期間 = その月の初日〜末日。
  v_from := make_date(p_year, p_month, 1);
  v_to   := (v_from + INTERVAL '1 month - 1 day')::date;

  -- 3. Square 月集約（Loop A RPC を修飾名で・byDate を月内 SUM）。
  v_loc_name := CASE WHEN v_store_name = 'こまいぬ' THEN '狛犬' ELSE v_store_name END;
  v_square := square_dashboard.get_sales_range_scoped(v_from, v_to, ARRAY[v_loc_name]);
  v_by_date := COALESCE(v_square -> 'byDate', '{}'::jsonb);

  FOR v_k IN SELECT jsonb_object_keys(v_by_date) LOOP
    v_d := v_by_date -> v_k;
    v_sales_cash     := v_sales_cash     + COALESCE((v_d ->> 'cash_amount')::bigint, 0);
    v_sales_card     := v_sales_card     + COALESCE((v_d ->> 'card_amount')::bigint, 0);
    v_sales_external := v_sales_external + COALESCE((v_d ->> 'external_amount')::bigint, 0);
    v_sales_other    := v_sales_other    + COALESCE((v_d ->> 'other_amount')::bigint, 0);
    v_sales_total    := v_sales_total    + COALESCE((v_d ->> 'total_amount')::bigint, 0);
    v_open_total     := v_open_total     + COALESCE((v_d ->> 'open_total_amount')::bigint, 0);
    v_cust_new       := v_cust_new       + COALESCE((v_d ->> 'new_customer_count')::bigint, 0);
    v_cust_repeat    := v_cust_repeat    + COALESCE((v_d ->> 'repeat_customer_count')::bigint, 0);
    v_cust_regular   := v_cust_regular   + COALESCE((v_d ->> 'regular_customer_count')::bigint, 0);
    v_cust_staff     := v_cust_staff     + COALESCE((v_d ->> 'staff_customer_count')::bigint, 0);
    -- シーシャ本数（出所を手入力→Square byDate へ切替）。客数と同じ byDate 由来＝
    -- start_hour=business_day_start_hour JOIN 配下で集計済（二重計上しない）。
    v_shisha         := v_shisha         + COALESCE((v_d ->> 'shisha_count')::bigint, 0);
  END LOOP;

  -- 客数【総】= 4 セグ（unlisted 除外）。§4.5。
  v_cust_total := v_cust_new + v_cust_repeat + v_cust_regular + v_cust_staff;

  -- 4. daily_reports 月集約（自前スコープ WHERE 再適用）。
  --    ★shisha_count はここから外した（Square byDate 由来へ移行・上の月内ループで集計済）。
  --    incentive / expense 群 / 違算 Σ は従来どおり手入力を集計し続ける。
  --    違算 Σ（設計 §4.3「過不足 = Σ_日次（手動上書き or cash_total − その日の square cash）」）:
  --      ・手動上書き行（discrepancy_amount IS NOT NULL）= その確定値をそのまま加算。
  --      ・自動算出行（discrepancy_amount IS NULL）= その日の cash_total − 同日 Square 現金。
  --        同日 Square 現金は v_by_date（byDate）から business_date キーで突合（無ければ 0）。
  --        日報のない日は加算対象外（過大控除しない）。
  SELECT
    COALESCE(sum(dr.incentive), 0),
    COALESCE(sum(dr.expense_drink), 0),
    COALESCE(sum(dr.expense_food), 0),
    COALESCE(sum(dr.expense_flavor), 0),
    COALESCE(sum(dr.expense_supplies), 0),
    COALESCE(sum(dr.expense_other), 0),
    -- 違算 Σ_日次: 手動上書き優先、無ければ cash_total − 同日 Square 現金。
    COALESCE(sum(
      CASE WHEN dr.discrepancy_amount IS NOT NULL
           THEN dr.discrepancy_amount::bigint
           ELSE COALESCE(dr.cash_total, 0)::bigint
                - COALESCE((v_by_date -> dr.business_date::text ->> 'cash_amount')::bigint, 0)
      END
    ), 0)
  INTO
    v_incentive, v_exp_drink, v_exp_food, v_exp_flavor,
    v_exp_supplies, v_exp_other, v_disc_total
  FROM public.daily_reports dr
  WHERE dr.store_id = p_store_id
    AND dr.tenant_id = v_tenant_id
    AND dr.business_date BETWEEN v_from AND v_to
    AND dr.tenant_id IN (SELECT public.get_my_tenant_ids())
    AND (public.is_tenant_managerial(dr.tenant_id) OR public.is_my_store(dr.store_id));

  -- 5. store_monthly_settings（固定費生値・売上目標）。
  SELECT * INTO v_st
  FROM public.store_monthly_settings sms
  WHERE sms.store_id = p_store_id
    AND sms.tenant_id = v_tenant_id
    AND sms.year = p_year
    AND sms.month = p_month
    AND sms.tenant_id IN (SELECT public.get_my_tenant_ids());
  v_settings_exists := FOUND;

  IF v_settings_exists THEN
    v_fixed_payroll := v_st.fixed_payroll_employee;
    v_rent          := v_st.rent;
    v_utilities     := v_st.utilities;
    v_comm          := v_st.communication;
    v_adv           := v_st.advertising;
    v_other_fixed   := v_st.other_sga_fixed;
    v_sales_target  := v_st.sales_target;
  END IF;

  -- 6. 人件費（Loop C 後結合）。
  IF to_regprocedure('public.parttime_labor_for_store(uuid,date,date)') IS NOT NULL THEN
    EXECUTE 'SELECT public.parttime_labor_for_store($1,$2,$3)'
      INTO v_labor USING p_store_id, v_from, v_to;
    v_labor := COALESCE(v_labor, 0);
    v_labor_source := 'loop_c';
  ELSE
    v_labor := 0;
    v_labor_source := 'unavailable';
  END IF;

  -- 7. 派生指標（全店定数で税・手数料を計算）。
  v_fee_card     := round(v_sales_card::numeric     * c_fee_card_bps     / 10000);
  v_fee_external := round(v_sales_external::numeric * c_fee_external_bps / 10000);
  v_consumption_tax := round(v_sales_total::numeric * c_tax_num / c_tax_den);

  -- 売上原価【変動費】= 酒代 + フード + フレーバー
  v_cogs_variable := v_exp_drink + v_exp_food + v_exp_flavor;
  -- 販管費【変動費】= 消耗品 + その他 + インセンティブ + 決済手数料(クレジット+Paypay)
  -- ⚠️ インセンティブはここで 1 回だけ加算（独立科目 expenses.incentive とは別に二重加算しない）。
  v_sga_variable := v_exp_supplies + v_exp_other + v_incentive + v_fee_card + v_fee_external;

  -- 客単価 = 売上【総】÷ 客数【総】（客数 0 なら null）
  IF v_cust_total > 0 THEN
    v_avg_spend := round(v_sales_total::numeric / v_cust_total, 1);
  ELSE
    v_avg_spend := NULL;
  END IF;

  -- 目標達成率 = 売上【総】÷ sales_target（target 0 なら null）
  IF v_sales_target > 0 THEN
    v_achievement := round(v_sales_total::numeric / v_sales_target, 4);
  ELSE
    v_achievement := NULL;
  END IF;

  -- 暫定利益 = 売上【総】 − 原価 − 人件費 − 販管費
  v_prov_profit := v_sales_total - v_cogs_variable - v_labor - v_sga_variable;
  IF v_sales_total > 0 THEN
    v_prov_rate := round(v_prov_profit::numeric / v_sales_total, 4);
  ELSE
    v_prov_rate := NULL;
  END IF;

  -- 8. settings / target の staff 非露出（裁定2帰結・§4.6）。
  --    managerial のみ固定費生値・売上目標生値を返す。staff は null（派生は返す）。
  IF v_managerial THEN
    v_settings_json := jsonb_build_object(
      'fixed_payroll_employee', v_fixed_payroll,
      'rent',                   v_rent,
      'utilities',              v_utilities,
      'communication',          v_comm,
      'advertising',            v_adv,
      'other_sga_fixed',        v_other_fixed
    );
    v_target_json := jsonb_build_object(
      'sales_target',     v_sales_target,
      'achievement_rate', v_achievement
    );
  ELSE
    v_settings_json := NULL;
    v_target_json := jsonb_build_object(
      'sales_target',     NULL,   -- 生値秘匿
      'achievement_rate', v_achievement  -- 派生は返す
    );
  END IF;

  -- 9. 契約 jsonb。
  RETURN jsonb_build_object(
    'store_id', p_store_id,
    'store_name', v_store_name,
    'year', p_year, 'month', p_month,
    'scope_ok', true,
    'settings_exists', v_settings_exists,
    'sales', jsonb_build_object(
      'cash',            v_sales_cash,
      'card',            v_sales_card,
      'external',        v_sales_external,
      'other',           v_sales_other,
      'total',           v_sales_total,             -- 決済済み（内訳と整合）
      'total_with_open', v_sales_total + v_open_total -- open 込み併記（§4.5）
    ),
    'customers', jsonb_build_object(
      'new',       v_cust_new,
      'repeat',    v_cust_repeat,
      'regular',   v_cust_regular,
      'staff',     v_cust_staff,
      'total',     v_cust_total,    -- 4 セグ（unlisted 除外）
      'avg_spend', v_avg_spend
    ),
    'shisha_count', v_shisha,   -- キー不変（出所のみ手入力→Square byDate Σ）
    'labor', jsonb_build_object(
      'parttime', v_labor,
      'source',   v_labor_source
    ),
    'expenses', jsonb_build_object(
      'incentive', v_incentive,   -- ＝バック統合（裁定1）
      'drink',     v_exp_drink,
      'food',      v_exp_food,
      'flavor',    v_exp_flavor,
      'supplies',  v_exp_supplies,
      'other',     v_exp_other
    ),
    'fees', jsonb_build_object(
      'card',     v_fee_card,      -- 売上クレジット×3.25%
      'external', v_fee_external   -- 売上Paypay×1.98%
    ),
    'cogs_variable',   v_cogs_variable,
    'sga_variable',    v_sga_variable,
    'consumption_tax', v_consumption_tax,
    'discrepancy_total', v_disc_total,
    'target', v_target_json,
    -- 利益額・利益率は managerial のみ生値、staff は null（裁定・案1）。
    -- 達成率・売上・客数・客単価・粗利は staff も返す。
    'provisional_profit',      CASE WHEN v_managerial THEN to_jsonb(v_prov_profit) ELSE 'null'::jsonb END,
    'provisional_profit_rate', CASE WHEN v_managerial THEN to_jsonb(v_prov_rate)   ELSE 'null'::jsonb END,
    'settings', v_settings_json   -- managerial のみ生値・staff は null
  );
END;
$$;


-- ============================================================================
-- (F) public.get_monthly_report_all(p_year int, p_month int, p_tenant_id uuid)
--     底本: 081(A-1)。本体ロジック変更なし（store ループで get_monthly_report を
--     修飾名で呼ぶ構造。shisha は独自に引いておらず totals 集約にも shisha は無い
--     ため、(E) の出所差し替えが per-store の戻り（shisha_count）経由で自動波及する）。
--     ★完全継承のため底本を 1 文字も変えずに CREATE OR REPLACE で再掲（同一
--       トランザクションで get_monthly_report の最新版を確実に参照させるため）。
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_monthly_report_all(
  p_year      int,
  p_month     int,
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stores      jsonb := '[]'::jsonb;
  v_one         jsonb;
  v_store_rec   record;
  v_any_scope   boolean := false;

  -- totals 集約
  v_t_sales      bigint := 0;
  v_t_cogs       bigint := 0;
  v_t_gross      bigint := 0;
  v_t_labor_pt   bigint := 0;
  v_t_labor_emp  bigint := 0;
  v_t_sga_var    bigint := 0;
  v_t_sga_fix    bigint := 0;
  v_t_op_profit  bigint := 0;
  v_t_cust       bigint := 0;
  v_op_rate      numeric;
  v_avg_spend    numeric;

  v_labor_any_unavailable boolean := false;
  -- 固定費非露出（settings null = staff）の店が混ざるか。混ざると固定費 0 扱いの
  -- 過大な営業利益になるため、totals の利益額・利益率を null 秘匿する（裁定・案1）。
  v_fixed_any_hidden boolean := false;
BEGIN
  -- fail-closed ガード（設計 §2.2）。
  --   p_tenant_id IS NULL: NULL を全テナント横断のフォールバックにしない（旧バグ再来防止）。
  --   非所属テナント: 呼び出しユーザーが所属しないテナント ID を渡しても scope_ok:false。
  IF p_tenant_id IS NULL
     OR p_tenant_id NOT IN (SELECT public.get_my_tenant_ids()) THEN
    RETURN jsonb_build_object(
      'year', p_year, 'month', p_month, 'scope_ok', false,
      'stores', '[]'::jsonb
    );
  END IF;

  -- 単一テナント限定で store を列挙（managerial=全店 / staff=自店）。
  -- 各 store について get_monthly_report を新 4 引数版で呼び（第 4 引数に
  -- p_tenant_id を渡して per-store も同一テナント検証を二重にかける）、
  -- 店舗別サマリを stores[] に積み、totals を加算する。
  FOR v_store_rec IN
    SELECT s.id AS store_id, s.tenant_id
    FROM public.stores s
    WHERE s.tenant_id = p_tenant_id
      AND (public.is_tenant_managerial(s.tenant_id) OR public.is_my_store(s.id))
    ORDER BY s.name
  LOOP
    v_one := public.get_monthly_report(v_store_rec.store_id, p_year, p_month, p_tenant_id);

    -- scope_ok でない店は積まない（二重 fail-closed の保険）。
    IF (v_one ->> 'scope_ok')::boolean IS NOT TRUE THEN
      CONTINUE;
    END IF;
    v_any_scope := true;

    v_stores := v_stores || jsonb_build_array(v_one);

    -- totals 加算（決済済み total ベース）。
    v_t_sales := v_t_sales + COALESCE((v_one -> 'sales' ->> 'total')::bigint, 0);
    v_t_cogs  := v_t_cogs  + COALESCE((v_one ->> 'cogs_variable')::bigint, 0);
    v_t_sga_var := v_t_sga_var + COALESCE((v_one ->> 'sga_variable')::bigint, 0);
    v_t_labor_pt := v_t_labor_pt + COALESCE((v_one -> 'labor' ->> 'parttime')::bigint, 0);
    v_t_cust  := v_t_cust  + COALESCE((v_one -> 'customers' ->> 'total')::bigint, 0);

    -- 人件費(固定=社員) / 販管費(固定) は settings から。
    -- staff には settings が null で返るため、その場合は固定費を 0 とみなす
    -- （staff は固定費生値を見られない＝総合 P&L の固定費行も非露出になる）。
    IF (v_one -> 'settings') IS NOT NULL AND jsonb_typeof(v_one -> 'settings') = 'object' THEN
      v_t_labor_emp := v_t_labor_emp + COALESCE((v_one -> 'settings' ->> 'fixed_payroll_employee')::bigint, 0);
      v_t_sga_fix := v_t_sga_fix
        + COALESCE((v_one -> 'settings' ->> 'rent')::bigint, 0)
        + COALESCE((v_one -> 'settings' ->> 'utilities')::bigint, 0)
        + COALESCE((v_one -> 'settings' ->> 'communication')::bigint, 0)
        + COALESCE((v_one -> 'settings' ->> 'advertising')::bigint, 0)
        + COALESCE((v_one -> 'settings' ->> 'other_sga_fixed')::bigint, 0);
    ELSE
      -- settings が null = この店は staff 視点で固定費非露出。
      v_fixed_any_hidden := true;
    END IF;

    IF (v_one -> 'labor' ->> 'source') = 'unavailable' THEN
      v_labor_any_unavailable := true;
    END IF;
  END LOOP;

  IF NOT v_any_scope THEN
    RETURN jsonb_build_object(
      'year', p_year, 'month', p_month, 'scope_ok', false,
      'stores', '[]'::jsonb
    );
  END IF;

  -- 総合 P&L（設計 §4.4）。
  v_t_gross := v_t_sales - v_t_cogs;
  v_t_op_profit := v_t_gross - (v_t_labor_pt + v_t_labor_emp) - (v_t_sga_var + v_t_sga_fix);

  IF v_t_sales > 0 THEN
    v_op_rate   := round(v_t_op_profit::numeric / v_t_sales, 4);
    v_avg_spend := CASE WHEN v_t_cust > 0
                        THEN round(v_t_sales::numeric / v_t_cust, 1)
                        ELSE NULL END;
  ELSE
    v_op_rate := NULL;
    v_avg_spend := CASE WHEN v_t_cust > 0
                        THEN round(v_t_sales::numeric / v_t_cust, 1)
                        ELSE NULL END;
  END IF;

  RETURN jsonb_build_object(
    'year', p_year, 'month', p_month,
    'scope_ok', true,
    'stores', v_stores,
    'totals', jsonb_build_object(
      'sales_total',           v_t_sales,
      'cogs_variable',         v_t_cogs,
      'gross_profit',          v_t_gross,
      'labor_parttime',        v_t_labor_pt,
      'labor_employee_fixed',  v_t_labor_emp,
      'sga_variable',          v_t_sga_var,
      'sga_fixed',             v_t_sga_fix,
      -- 固定費非露出店が混ざる場合（staff）は過大値を出さず null 秘匿（裁定・案1）。
      'operating_profit',      CASE WHEN v_fixed_any_hidden THEN 'null'::jsonb ELSE to_jsonb(v_t_op_profit) END,
      'operating_profit_rate', CASE WHEN v_fixed_any_hidden THEN 'null'::jsonb ELSE to_jsonb(v_op_rate) END,
      'customers_total',       v_t_cust,
      'avg_spend',             v_avg_spend
    ),
    'labor_source', CASE WHEN v_labor_any_unavailable THEN 'unavailable' ELSE 'loop_c' END
  );
END;
$$;


-- ----------------------------------------------------------------------------
-- 権限テンプレ（MEMORY RLS 4 行・冪等再掲）。
--   CREATE OR REPLACE は GRANT/REVOKE をリセットしないが、再実行安全のため再掲。
--   square 側 daily_sales の直 SELECT REVOKE は 070(D) で済み（新列 shisha_count も
--   同テーブルなので既存 REVOKE が自動的に効く → 104 で追加 REVOKE は不要）。
--   シグネチャ不変のため新規 GRANT は不要だが冪等性担保で再掲する。
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION square_dashboard.get_sales_range_scoped(date, date, text[])             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION square_dashboard.get_sales_range_scoped(date, date, text[])             FROM anon;
GRANT  EXECUTE ON FUNCTION square_dashboard.get_sales_range_scoped(date, date, text[])             TO authenticated;

REVOKE EXECUTE ON FUNCTION square_dashboard.get_sales_by_location_daily_scoped(date, date, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION square_dashboard.get_sales_by_location_daily_scoped(date, date, text[]) FROM anon;
GRANT  EXECUTE ON FUNCTION square_dashboard.get_sales_by_location_daily_scoped(date, date, text[]) TO authenticated;

REVOKE EXECUTE ON FUNCTION square_dashboard.get_sales_by_location_scoped(date, date, text[])       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION square_dashboard.get_sales_by_location_scoped(date, date, text[])       FROM anon;
GRANT  EXECUTE ON FUNCTION square_dashboard.get_sales_by_location_scoped(date, date, text[])       TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_daily_report(uuid, date, uuid)                               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_daily_report(uuid, date, uuid)                               FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_daily_report(uuid, date, uuid)                               TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_monthly_report(uuid, int, int, uuid)                         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_monthly_report(uuid, int, int, uuid)                         FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_monthly_report(uuid, int, int, uuid)                         TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_monthly_report_all(int, int, uuid)                           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_monthly_report_all(int, int, uuid)                           FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_monthly_report_all(int, int, uuid)                           TO authenticated;
