-- =============================================================================
-- 095_parttime_labor_role_default.sql  (P2/P3 batch B3)
-- =============================================================================
-- item: rpc-hourly-rate-missing-role-default-fallback
--
-- 078 `public.parttime_labor_for_store(uuid,date,date)` を追補再定義する。
--
-- 背景:
--   ce3522a(P1-4) でフロント PayrollCalculation は
--   getMemberPayrollForStore + getEffectiveHourlyRate(payrollCalc.ts) により
--   時給を「store override → tenant_members.hourly_rate → role.default_hourly_rate → 0」
--   の3段フォールバックで解決するよう修正された。
--   一方 RPC 078 の resolved CTE は role.default_hourly_rate を拾わず
--   COALESCE(msp.hourly_rate, tm.hourly_rate, 0) 止まりだったため、
--   「role に時給を設定し tenant_members.hourly_rate を空にする」運用で
--   RPC は 0 円・フロントは role 既定で計算し、両者が乖離していた。
--
-- 修正:
--   resolved CTE に LEFT JOIN tenant_roles r ON r.id = tm.role_id を足し、
--   時給解決を COALESCE(msp.hourly_rate [override時のみ], tm.hourly_rate,
--   r.default_hourly_rate, 0) に補強する。フロント getEffectiveHourlyRate と
--   完全に同順（member.hourly_rate → role.default_hourly_rate → 0）。
--   `WHERE hourly > 0` の除外境界は role default を拾った後に評価されるため、
--   role default 保持者は集計対象に入る（フロントと1円一致）。
--
-- 不変条件（壊さない）:
--   - シグネチャ・戻り値型(integer 円)は 078 と厳密一致（076 が to_regprocedure で呼ぶ）。
--   - 深夜帯・休憩按分・倍率・night_enabled・丸め(人ごと CEIL)・スコープは 078 を維持。
--   - SECURITY DEFINER + SET search_path = public, pg_temp（092 硬化後の状態を維持）。
--   - grant は 092 後の状態（REVOKE FROM PUBLIC/anon・GRANT TO authenticated）を再掲し維持。
-- =============================================================================

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
      GREATEST(0,
        public._night_minutes(r.ci, r.co) - rb.break_night_min
      ) AS adj_night,
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
    -- 時給・倍率・pay_type・night_enabled 解決。
    -- 時給解決順（フロント getEffectiveHourlyRate / getMemberPayrollForStore と同順）:
    --   override 時:  msp.hourly_rate → tm.hourly_rate → r.default_hourly_rate → 0
    --   override なし:                tm.hourly_rate → r.default_hourly_rate → 0
    SELECT
      u.user_id,
      u.nm,
      u.gm,
      COALESCE(msp.pay_type, tm.pay_type, 'hourly') AS pay_type,
      CASE
        WHEN msp.user_id IS NOT NULL
          THEN COALESCE(msp.hourly_rate, tm.hourly_rate, r.default_hourly_rate, 0)
        ELSE COALESCE(tm.hourly_rate, r.default_hourly_rate, 0)
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
    LEFT JOIN public.tenant_roles r
           ON r.id = tm.role_id
  ),
  pay AS (
    -- 人ごと CEIL（PayrollCalculation 一致）。monthly 除外・時給 0 除外。
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

-- grant 維持（092 硬化後の状態を再掲）。
REVOKE EXECUTE ON FUNCTION public.parttime_labor_for_store(uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.parttime_labor_for_store(uuid, date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.parttime_labor_for_store(uuid, date, date) TO authenticated;

COMMENT ON FUNCTION public.parttime_labor_for_store(uuid, date, date) IS
  'Loop C 変動人件費（円・integer）。076 が to_regprocedure で動的に呼ぶ。pay_type=hourly のみ集計し monthly は除外（固定費 fixed_payroll_employee と二重計上防止）。時給解決=store override→tenant_members.hourly_rate→tenant_roles.default_hourly_rate→0（フロント getEffectiveHourlyRate と1円一致・095 で role 既定 fallback 追加）。深夜=22-翌5 JST・倍率=night_shift_rate_multiplier(既定1.25)・night_shift_enabled=false は深夜割増なし・休憩(breaks end_time NOT NULL)を normal/night 別に按分控除・丸め=人ごと CEIL。自前スコープ fail-closed。';
