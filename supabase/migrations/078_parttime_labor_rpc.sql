-- =============================================================================
-- 078_parttime_labor_rpc.sql  (Loop C)
-- =============================================================================
-- アルバイト（時給者）の変動人件費を期間集計する RPC。
--
--   public.parttime_labor_for_store(p_store_id uuid, p_from date, p_to date)
--     RETURNS integer   -- 円・常に 0 以上・NULL を返さない
--
-- 契約（不可侵）: Loop B の 076 が
--   to_regprocedure('public.parttime_labor_for_store(uuid,date,date)')
-- で動的判定し EXECUTE で呼ぶ。シグネチャ・戻り値型（integer 円）を厳密一致させる。
-- 076 は再 apply 不要（to_regprocedure は実行時評価）。
--
-- 仕様（設計書 2026-06-10-kintai-daily-monthly-reports-loopC.md）:
--   - 深夜帯 = 22:00〜翌5:00。clock_in/out・breaks を JST(`AT TIME ZONE 'Asia/Tokyo'`)
--     に変換してから区間交差で深夜分を計算（UTC のままだと 9h ズレ）。
--   - 休憩控除: breaks（end_time NOT NULL のみ）を normal/night 別に按分控除。
--   - 時給解決順: member_store_payrolls(user,store) override 優先
--     （個別 null 列は tenant_members フォールバック）→ 行なしは tenant_members。
--   - pay_type='hourly' のみ集計（'monthly' は除外＝固定費との二重計上防止）。
--   - 深夜倍率 = night_shift_rate_multiplier（フォールバック時 1.25）。
--   - night_shift_enabled=false の人は深夜割増なし（深夜分も通常時給）。
--   - 丸め: 人(user,store)ごと CEIL（PayrollCalculation.tsx と1円一致）。
--   - clock_out NULL / clock_in NULL / clock_out<=clock_in / store_id NULL は除外。
--   - 同日複数打刻は行ごと→user 合算。
-- セキュリティ: SECURITY DEFINER + search_path 固定 + RLS 4 行 + 自前スコープ。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 内部ヘルパ: _night_minutes
--   JST 変換後の timestamp without time zone な区間 [p_ci, p_co] に対し、
--   各暦日（JST）の 0:00-5:00 と 22:00-24:00 の 2 区間との重複を「区間ごと分整数（trunc）」で加算。
--   フロント utils/nightShift.ts getNightMinutesInRange（differenceInMinutes=秒切り捨て）と桁一致。
--   戻りは総区間分（trunc 分整数）で明示クランプ済（深夜分 ≤ 総区間分）。
--   引数は本体側で `AT TIME ZONE 'Asia/Tokyo'` 済みを渡す（ここでは TZ 変換しない）。
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._night_minutes(
  p_ci timestamp without time zone,
  p_co timestamp without time zone
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH params AS (
    SELECT p_ci AS ci, p_co AS co
  ),
  days AS (
    -- 22:00 区間は前日からまたぐため ci の前日〜co の当日まで走査。
    SELECT generate_series(
             date_trunc('day', (SELECT ci FROM params)) - interval '1 day',
             date_trunc('day', (SELECT co FROM params)),
             interval '1 day'
           ) AS d
  ),
  night AS (
    SELECT
      -- 0:00-5:00 の重複分（区間ごとに trunc で分整数化＝フロント differenceInMinutes と同桁）
      trunc(GREATEST(0, EXTRACT(EPOCH FROM (
        LEAST((SELECT co FROM params), d + interval '5 hour')
        - GREATEST((SELECT ci FROM params), d)
      ))) / 60.0)
      +
      -- 22:00-24:00 の重複分（同上）
      trunc(GREATEST(0, EXTRACT(EPOCH FROM (
        LEAST((SELECT co FROM params), d + interval '24 hour')
        - GREATEST((SELECT ci FROM params), d + interval '22 hour')
      ))) / 60.0) AS night_min
    FROM days
  ),
  agg AS (
    SELECT
      COALESCE(SUM(night_min), 0) AS night,
      -- 総区間分（trunc 分整数）。深夜分が総区間分を超えないよう clamp に使う。
      trunc(GREATEST(0, EXTRACT(EPOCH FROM (
        (SELECT co FROM params) - (SELECT ci FROM params)
      ))) / 60.0) AS total
    FROM night
  )
  -- 明示クランプ: 深夜分 ≤ 総区間分
  SELECT LEAST(night, total) FROM agg;
$$;

REVOKE EXECUTE ON FUNCTION public._night_minutes(timestamp without time zone, timestamp without time zone) FROM PUBLIC;

COMMENT ON FUNCTION public._night_minutes(timestamp without time zone, timestamp without time zone) IS
  'Loop C 内部ヘルパ。JST 変換済み区間の深夜帯(22:00-翌5:00)重複分を numeric で返す。nightShift.ts getNightMinutesInRange 等価。';

-- -----------------------------------------------------------------------------
-- 本体: parttime_labor_for_store
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.parttime_labor_for_store(
  p_store_id uuid,
  p_from     date,
  p_to       date
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_total  integer;
BEGIN
  -- store → tenant 解決（不正 store は 0）。
  SELECT s.tenant_id INTO v_tenant
  FROM public.stores s
  WHERE s.id = p_store_id;

  IF v_tenant IS NULL THEN
    RETURN 0;
  END IF;

  -- 自前スコープ（直接呼び出し防御・fail-closed）。076 と同条件。
  IF NOT (
    v_tenant IN (SELECT public.get_my_tenant_ids())
    AND (public.is_tenant_managerial(v_tenant) OR public.is_my_store(p_store_id))
  ) THEN
    RETURN 0;
  END IF;

  WITH recs AS (
    -- 対象打刻行（JST 変換・clock 両方あり・store_id 一致・date BETWEEN・異常系除外）。
    SELECT
      ar.id,
      ar.user_id,
      (ar.clock_in  AT TIME ZONE 'Asia/Tokyo') AS ci,
      (ar.clock_out AT TIME ZONE 'Asia/Tokyo') AS co
    FROM public.attendance_records ar
    WHERE ar.store_id = p_store_id
      AND ar.tenant_id = v_tenant
      AND ar.date BETWEEN p_from AND p_to
      AND ar.clock_in  IS NOT NULL
      AND ar.clock_out IS NOT NULL
      AND ar.clock_out > ar.clock_in
  ),
  rec_breaks AS (
    -- 行ごとの休憩按分（end_time NOT NULL の確定休憩のみ・JST 変換）。
    SELECT
      r.id,
      COALESCE(SUM(public._night_minutes(
        (b.start_time AT TIME ZONE 'Asia/Tokyo'),
        (b.end_time   AT TIME ZONE 'Asia/Tokyo')
      )), 0) AS break_night_min,
      COALESCE(SUM(
        trunc(EXTRACT(EPOCH FROM (b.end_time - b.start_time)) / 60.0)
      ), 0) AS break_total_min
    FROM recs r
    LEFT JOIN public.breaks b
      ON b.attendance_record_id = r.id
     AND b.end_time IS NOT NULL
     AND b.end_time > b.start_time
    GROUP BY r.id
  ),
  rec_mins AS (
    -- 行ごと normal/night（休憩控除済み）。
    SELECT
      r.user_id,
      -- adjusted_night = max(0, 打刻深夜分 − 休憩深夜分)
      GREATEST(0,
        public._night_minutes(r.ci, r.co) - rb.break_night_min
      ) AS adj_night,
      -- adjusted_normal = max(0, 打刻通常分 − 休憩通常分)
      --   打刻通常分 = 総労働分 − 打刻深夜分
      --   休憩通常分 = 休憩総分 − 休憩深夜分
      GREATEST(0,
        (trunc(EXTRACT(EPOCH FROM (r.co - r.ci)) / 60.0) - public._night_minutes(r.ci, r.co))
        - (rb.break_total_min - rb.break_night_min)
      ) AS adj_normal
    FROM recs r
    JOIN rec_breaks rb ON rb.id = r.id
  ),
  by_user AS (
    -- user で合算。
    SELECT
      user_id,
      SUM(adj_normal) AS nm,
      SUM(adj_night)  AS gm
    FROM rec_mins
    GROUP BY user_id
  ),
  resolved AS (
    -- 時給・倍率・pay_type・night_enabled 解決（override 優先→tm フォールバック）。
    SELECT
      u.user_id,
      u.nm,
      u.gm,
      COALESCE(msp.pay_type, tm.pay_type, 'hourly') AS pay_type,
      CASE
        WHEN msp.user_id IS NOT NULL
          THEN COALESCE(msp.hourly_rate, tm.hourly_rate, 0)
        ELSE COALESCE(tm.hourly_rate, 0)
      END AS hourly,
      CASE
        WHEN msp.user_id IS NOT NULL
          THEN COALESCE(msp.night_shift_rate_multiplier, 1.25)
        ELSE 1.25
      END AS night_mul,
      COALESCE(tm.night_shift_enabled, true) AS night_enabled
    FROM by_user u
    LEFT JOIN public.member_store_payrolls msp
           ON msp.tenant_id = v_tenant
          AND msp.user_id   = u.user_id
          AND msp.store_id  = p_store_id
    JOIN public.tenant_members tm
           ON tm.tenant_id = v_tenant
          AND tm.user_id   = u.user_id
  ),
  pay AS (
    -- 人ごと CEIL（PayrollCalculation L136 一致）。monthly 除外・時給 0 除外。
    SELECT CEIL(
             (nm / 60.0) * hourly
           + (gm / 60.0) * hourly * (CASE WHEN night_enabled THEN night_mul ELSE 1.0 END)
           )::bigint AS p
    FROM resolved
    WHERE pay_type = 'hourly'
      AND hourly > 0
  )
  -- overflow 防御: integer 上限でクランプ。
  SELECT LEAST(COALESCE(SUM(p), 0), 2147483647)::integer INTO v_total FROM pay;

  RETURN COALESCE(v_total, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.parttime_labor_for_store(uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.parttime_labor_for_store(uuid, date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.parttime_labor_for_store(uuid, date, date) TO authenticated;

COMMENT ON FUNCTION public.parttime_labor_for_store(uuid, date, date) IS
  'Loop C 変動人件費（円・integer）。076 が to_regprocedure で動的に呼ぶ。pay_type=hourly のみ集計し monthly は除外（固定費 fixed_payroll_employee と二重計上防止）。深夜=22-翌5 JST・倍率=night_shift_rate_multiplier(既定1.25)・night_shift_enabled=false は深夜割増なし・休憩(breaks end_time NOT NULL)を normal/night 別に按分控除・丸め=人ごと CEIL（PayrollCalculation 整合）。自前スコープ fail-closed。';
