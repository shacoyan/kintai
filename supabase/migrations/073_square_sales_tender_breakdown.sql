-- ============================================================================
-- 073_square_sales_tender_breakdown.sql
-- ----------------------------------------------------------------------------
-- 目的（Loop A / 日報・月報統合）:
--   Square の支払手段別(tender = payment.source_type)売上内訳
--   （cash / card / external(=PayPay) / other）を kintai フロントから
--   RPC 経由で読めるようにする。square_dashboard.daily_sales に sdb_009 で
--   追加された tender 4 列（cash_amount / card_amount / external_amount /
--   other_amount, いずれも bigint NOT NULL DEFAULT 0）を、既存の読み口である
--   070 get_sales_range_scoped / 071 get_sales_by_location_scoped が返す jsonb に
--   **後方互換で末尾追加**する。
--
--   ⚠️ 既存キー・構造・客数/売上セグメント・open・categories は一切変更しない。
--      tender 4 キーは jsonb_build_object の末尾に追記するのみ。
--      → /sales・Loop2/3・YoY は無改修で従来通り動作する。
--
--   ※ ファイル番号は 073（設計書は「072」固定としていたが、kintai 本番には既に
--      072_square_sales_tenant_scope_fix.sql（SEC-1 テナント越境封鎖）が存在する
--      ため、空き番号 073 を採用。072 は get_allowed_location_ids を差し替え済みで、
--      本 073 は RPC 本体（get_sales_range_scoped / get_sales_by_location_scoped）
--      のみを再定義し helper には触れないため、072 の修正と競合しない。）
--
-- 対象 project:
--   kintai = zjjbfffhbobwwxyvdszl  （★ apply 前に list_projects で name 必ず確認。
--                                    receipt-scanner=zzopayofegpmdkwckstq 誤投入厳禁）
--
-- 内容:
--   (A) get_sales_range_scoped(date,date,text[]) を CREATE OR REPLACE。
--       sales CTE に sum(ds.cash/card/external/other_amount) を追加し、
--       byDate の jsonb_build_object 末尾に tender 4 キーを追記。
--   (B) get_sales_by_location_scoped(date,date,text[]) を CREATE OR REPLACE。
--       per_loc CTE に同 4 列の sum を追加し、byLocation の jsonb_build_object
--       末尾に tender 4 キーを追記。
--   (C) 権限 4 行テンプレ（PUBLIC/anon REVOKE + authenticated GRANT）を保険再掲。
--
-- 前提（適用順序・逆順厳禁）:
--   1) sdb_009（daily_sales に tender 4 列追加）が apply 済みであること。
--      未適用だと sum(ds.cash_amount) が 42703 column does not exist で
--      RPC 定義に失敗する。必ず sdb_009 → 本 073 の順。
--   2) 070 / 071 / 072（helper 差し替え）が apply 済みであること。
--      本 073 は get_allowed_location_ids（072 版）をそのまま呼ぶ。
--
-- 差分（070/071 からの変更点のみ）:
--   - sales / per_loc CTE に sum(ds.cash_amount) 等 4 行を追加。
--   - byDate / byLocation の jsonb_build_object に 4 キーを末尾追加。
--   - 上記以外（スコープ強制 get_allowed_location_ids / fail-closed /
--     期間ガード / start_hour=business_day_start_hour JOIN / 既存キー・順序 /
--     meta / categories）は 070/071 を完全踏襲・無改変。
--
-- tender 合計と total_amount の関係（仕様・参考）:
--   cash + card + external + other == total_amount（決済済み分は一致）。
--   open_total_amount（未決済）は payment が無く tender 内訳を持たない＝乖離は仕様。
--
-- 可逆性: 関数本体のみ差し替え（CREATE OR REPLACE）。データ変更なし。
--         ロールバックは 070/071 の本体定義で再 CREATE OR REPLACE すれば復帰
--         （tender キーが消えるだけ。利用側は新キーを知らなくても従来通り動く）。
-- 冪等性: CREATE OR REPLACE FUNCTION / REVOKE（不在でも非エラー）で再実行安全。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (A) get_sales_range_scoped（byDate 全店合算）+ tender 4 キー
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
  --   tender(cash/card/external/other) は決済済み内訳（末尾キーで後方互換追加）。
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
      sum(ds.other_amount)                  AS other_amount
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
      'other_amount',            s.other_amount
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
-- (B) get_sales_by_location_scoped（byLocation 店舗別）+ tender 4 キー
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
  --    tender(cash/card/external/other) は決済済み内訳（末尾キーで後方互換追加）。
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
      sum(ds.other_amount)                  AS other_amount
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
      'other_amount',           p.other_amount
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
-- (C) 権限テンプレ（MEMORY RLS 4 行・保険再掲）。
--     CREATE OR REPLACE は GRANT/REVOKE をリセットしないが、再実行安全のため再掲。
--     daily_sales の直 SELECT REVOKE は 070(D) で済み（新列 tender も同テーブルなので
--     既存 REVOKE が自動的に効く → 073 で追加 REVOKE は不要）。
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION square_dashboard.get_sales_range_scoped(date, date, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION square_dashboard.get_sales_range_scoped(date, date, text[]) FROM anon;
GRANT  EXECUTE ON FUNCTION square_dashboard.get_sales_range_scoped(date, date, text[]) TO authenticated;

REVOKE EXECUTE ON FUNCTION square_dashboard.get_sales_by_location_scoped(date, date, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION square_dashboard.get_sales_by_location_scoped(date, date, text[]) FROM anon;
GRANT  EXECUTE ON FUNCTION square_dashboard.get_sales_by_location_scoped(date, date, text[]) TO authenticated;
