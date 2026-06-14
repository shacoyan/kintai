-- Migration 089: tenant_members_visible の給与列ガード（P2/P3 B1）
--
-- 背景（実測 2026-06-15・本番 zjjbfffhbobwwxyvdszl）:
--   VIEW tenant_members_visible（security_invoker=true）は legal_name のみ
--   「本人 OR owner/manager → 値, else NULL」の CASE でガードしているが、
--   hourly_rate / monthly_salary / paid_leave_days / pay_type は素通しで
--   全列が SELECT 可能。tenant_members の SELECT policy は同テナント所属者全員に
--   開いている想定のため、一般 staff が他メンバーの時給・月給・有給日数・給与形態を
--   閲覧できてしまう（item: tenant-members-visible-pay-fields-exposed）。
--
-- 設計方針:
--   legal_name と同型の CASE（本人 OR owner/manager → 値, else NULL）を
--   hourly_rate / monthly_salary / paid_leave_days / pay_type の 4 列にも適用する。
--   ・hourly_rate(int) / monthly_salary(int) / paid_leave_days(numeric) は
--     給与の絶対額に直結するため最優先でガード。
--   ・pay_type(text) も給与形態（hourly/monthly 等）の機微情報のため
--     本人+管理者に寄せる（設計書の方針: 絶対額を最低限ガード + pay_type は管理者寄せ）。
--   ・display_name / role / onboarded_at / night_shift_enabled / role_id /
--     created_at / is_parttime は運用上の表示に必要なため従来どおり素通し。
--   ・CASE 条件式は本番 legal_name の表現（tm.tenant_id=me.tenant_id の所属判定）を
--     そのまま踏襲し、繰り返し記述する（VIEW なので副問合せのコストは許容範囲）。
--   ・各列の NULL 化時に元の型を維持するため NULL::<型> でキャストする
--     （hourly_rate=int / monthly_salary=int / paid_leave_days は元列型を踏襲 /
--      pay_type=text）。CREATE OR REPLACE VIEW は列の型・順序・名前を変えられないため
--      元定義と完全一致の列構成を維持する。
--   ・security_invoker=true を維持（呼び出し元の RLS で tenant スコープを担保）。
--
-- 横串確認:
--   本 migration は VIEW の SELECT 投影のみを変更し、基底表 tenant_members の
--   policy（SELECT/INSERT/UPDATE/DELETE）には一切触れない。
--
-- Depends:
--   - tenant_members_visible VIEW（082 系で security_invoker 化済）
--   - tenant_members(hourly_rate int / monthly_salary int / paid_leave_days / pay_type text)
--
-- Rollback / 検証SQL: 本ファイル末尾コメント参照。

BEGIN;

CREATE OR REPLACE VIEW public.tenant_members_visible
WITH (security_invoker = true) AS
  SELECT
    id,
    tenant_id,
    user_id,
    role,
    display_name,
    CASE
      WHEN user_id = auth.uid() THEN legal_name
      WHEN EXISTS (
        SELECT 1 FROM tenant_members me
        WHERE me.tenant_id = tm.tenant_id
          AND me.user_id = auth.uid()
          AND me.role = ANY (ARRAY['owner'::text, 'manager'::text])
      ) THEN legal_name
      ELSE NULL::text
    END AS legal_name,
    onboarded_at,
    -- 給与列ガード: 本人 OR owner/manager のみ実値、それ以外は NULL（legal_name と同型）
    CASE
      WHEN user_id = auth.uid() THEN hourly_rate
      WHEN EXISTS (
        SELECT 1 FROM tenant_members me
        WHERE me.tenant_id = tm.tenant_id
          AND me.user_id = auth.uid()
          AND me.role = ANY (ARRAY['owner'::text, 'manager'::text])
      ) THEN hourly_rate
      ELSE NULL::integer
    END AS hourly_rate,
    night_shift_enabled,
    CASE
      WHEN user_id = auth.uid() THEN pay_type
      WHEN EXISTS (
        SELECT 1 FROM tenant_members me
        WHERE me.tenant_id = tm.tenant_id
          AND me.user_id = auth.uid()
          AND me.role = ANY (ARRAY['owner'::text, 'manager'::text])
      ) THEN pay_type
      ELSE NULL::text
    END AS pay_type,
    CASE
      WHEN user_id = auth.uid() THEN monthly_salary
      WHEN EXISTS (
        SELECT 1 FROM tenant_members me
        WHERE me.tenant_id = tm.tenant_id
          AND me.user_id = auth.uid()
          AND me.role = ANY (ARRAY['owner'::text, 'manager'::text])
      ) THEN monthly_salary
      ELSE NULL::integer
    END AS monthly_salary,
    CASE
      WHEN user_id = auth.uid() THEN paid_leave_days
      WHEN EXISTS (
        SELECT 1 FROM tenant_members me
        WHERE me.tenant_id = tm.tenant_id
          AND me.user_id = auth.uid()
          AND me.role = ANY (ARRAY['owner'::text, 'manager'::text])
      ) THEN paid_leave_days
      ELSE NULL::numeric(4,1)
    END AS paid_leave_days,
    role_id,
    created_at,
    is_parttime
  FROM tenant_members tm;

COMMENT ON VIEW public.tenant_members_visible IS
  'P2/P3 B1: hourly_rate/monthly_salary/paid_leave_days/pay_type を legal_name と同型の '
  'CASE（本人 OR owner/manager → 値, else NULL）でガード。staff の他人給与閲覧を封鎖。';

COMMIT;

-- =========================================================================
-- ROLLBACK SQL（089 適用前=給与列を素通しする定義へ復元。手動実行）
-- =========================================================================
-- BEGIN;
-- CREATE OR REPLACE VIEW public.tenant_members_visible WITH (security_invoker = true) AS
--   SELECT id, tenant_id, user_id, role, display_name,
--     CASE
--       WHEN user_id = auth.uid() THEN legal_name
--       WHEN EXISTS (SELECT 1 FROM tenant_members me
--                    WHERE me.tenant_id = tm.tenant_id AND me.user_id = auth.uid()
--                      AND me.role = ANY (ARRAY['owner','manager'])) THEN legal_name
--       ELSE NULL::text END AS legal_name,
--     onboarded_at, hourly_rate, night_shift_enabled, pay_type, monthly_salary,
--     paid_leave_days, role_id, created_at, is_parttime
--   FROM tenant_members tm;
-- COMMIT;

-- =========================================================================
-- 適用後 検証 SQL（本番で実行・全件 PASS が承認条件。BEGIN..ROLLBACK で無汚染）
--   <STAFF_UID>/<MANAGER_UID> は当該テナントの実 UID に置換。
--   他メンバー(staff 以外)の給与列が NOT NULL な行があるテナントで検証。
-- =========================================================================
-- -- 1.(攻撃) staff が他人の給与列を SELECT → PASS=他人行の rate/salary/paid_leave/pay_type が NULL
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<STAFF_UID>','role','authenticated')::text, true);
-- --   SELECT user_id, hourly_rate, monthly_salary, paid_leave_days, pay_type
-- --   FROM public.tenant_members_visible WHERE user_id <> '<STAFF_UID>';
-- --   -- → 全行で 4 列が NULL なら PASS。自分の行(user_id='<STAFF_UID>')は実値が見える。
-- -- ROLLBACK;
--
-- -- 2.(正常) manager が SELECT → PASS=同テナント全員の給与列が実値で見える
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<MANAGER_UID>','role','authenticated')::text, true);
-- --   SELECT user_id, hourly_rate, monthly_salary, paid_leave_days, pay_type
-- --   FROM public.tenant_members_visible;
-- --   -- → 給与が設定されたメンバー行で NOT NULL が見えれば PASS。
-- -- ROLLBACK;
