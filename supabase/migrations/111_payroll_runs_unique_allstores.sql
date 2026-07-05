-- Migration 111: payroll_runs 全店舗 run の重複確定を防止（FG3 / emergency money authz batch）
--
-- 背景（設計書 2026-07-03-kintai-emergency-money-authz-batch.md §FG3）:
--   024:22 の UNIQUE(tenant_id, store_id, target_month, mode) は、全店舗 run が
--   store_id = NULL のため「NULL ≠ NULL」で UNIQUE が効かず、同一 (tenant, target_month, mode)
--   の全店舗 run を重複 INSERT できてしまう。finalize_payroll_run（088:140）にも
--   存在チェック・advisory lock が無く二重確定を許す。
--   → 重複した payroll_runs は total_payment（全社総支給）や明細が二重に存在し、
--     給与画面の整合が壊れる（fetchRun が複数行で error になり画面が開けない）。
--
-- 対策:
--   (a) store_id IS NULL 限定の部分 UNIQUE INDEX で全店舗 run を一意化。
--       店舗別 run（store_id NOT NULL）は 024 の既存 UNIQUE で不変。
--   (b) finalize_payroll_run を CREATE OR REPLACE し、ヘッダ INSERT を
--       EXCEPTION WHEN unique_violation で捕捉して日本語全文メッセージで RAISE。
--       署名・items INSERT 部・SECURITY DEFINER 4 行テンプレは 088 と同一。
--
-- 本番ゲート（apply は秘書/オーナー）:
--   部分 UNIQUE INDEX 作成前に既存重複が本番にあると作成が失敗する。
--   §FG3-0 の重複存在チェック SQL を必ず先に実行し、1 行でも返れば owner の
--   unfinalize で解消してから apply すること。
--
-- 参照: 024:8-23 / 088:140-211 / 099:261-306 / usePayrollRun.ts

BEGIN;

-- (a) 全店舗 run（store_id IS NULL）の部分 UNIQUE INDEX
CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_tenant_month_mode_allstores_key
  ON public.payroll_runs (tenant_id, target_month, mode)
  WHERE store_id IS NULL;

-- (b) finalize_payroll_run 再定義（署名不変・items INSERT 部は 088 逐語維持）
CREATE OR REPLACE FUNCTION public.finalize_payroll_run(
  p_tenant_id     uuid,
  p_store_id      uuid,
  p_target_month  date,
  p_close_day     smallint,
  p_period_start  date,
  p_period_end    date,
  p_mode          text,
  p_total_payment integer,
  p_items         jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  -- owner/manager 検証（pr_insert / pri_insert と同一条件）
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.role = ANY (ARRAY['owner','manager'])
  ) THEN
    RAISE EXCEPTION 'only owner/manager can finalize payroll_run (tenant %)', p_tenant_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ヘッダ INSERT（tenant_id は検証済引数で固定・finalized_by は caller）
  -- 部分 UNIQUE INDEX（全店舗 run）/ 既存 UNIQUE（店舗別 run）による重複を捕捉して明示エラー化。
  BEGIN
    INSERT INTO public.payroll_runs (
      tenant_id, store_id, target_month, close_day,
      period_start, period_end, mode, total_payment, finalized_by
    ) VALUES (
      p_tenant_id, p_store_id, p_target_month, p_close_day,
      p_period_start, p_period_end, p_mode, p_total_payment, auth.uid()
    )
    RETURNING id INTO v_run_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION '指定した対象月・モードの給与確定は既に存在します（重複確定はできません）。一覧を再読み込みしてから操作してください。'
      USING ERRCODE = 'unique_violation';
  END;

  -- items INSERT（run_id は新規 id で固定。jsonb 内の run_id/tenant_id は信用しない）
  INSERT INTO public.payroll_run_items (
    run_id, user_id, display_name, pay_type,
    hourly_rate, monthly_salary, work_days, normal_minutes, night_minutes, payment
  )
  SELECT
    v_run_id,
    (it->>'user_id')::uuid,
    it->>'display_name',
    it->>'pay_type',
    (it->>'hourly_rate')::integer,
    (it->>'monthly_salary')::integer,
    (it->>'work_days')::integer,
    (it->>'normal_minutes')::integer,
    (it->>'night_minutes')::integer,
    (it->>'payment')::integer
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS it;

  RETURN v_run_id;
END;
$$;

COMMENT ON FUNCTION public.finalize_payroll_run(uuid,uuid,date,smallint,date,date,text,integer,jsonb) IS
  'FG3(111): 給与確定を単一トランザクションで実行（孤児 payroll_run 防止）。'
  'caller が tenant の owner/manager か検証し否なら insufficient_privilege。'
  'run INSERT → items INSERT を atomic に行い失敗時は全体ロールバック。'
  '全店舗 run（store_id NULL）の部分 UNIQUE / 店舗別 run の既存 UNIQUE 違反は '
  'unique_violation を捕捉し日本語全文で RAISE（重複確定防止）。'
  'tenant_id は引数で固定・items jsonb 内の run_id/tenant_id は信用しない。';

-- MEMORY RLS 4 行テンプレ（anon 排除）
REVOKE EXECUTE ON FUNCTION public.finalize_payroll_run(uuid,uuid,date,smallint,date,date,text,integer,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_payroll_run(uuid,uuid,date,smallint,date,date,text,integer,jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.finalize_payroll_run(uuid,uuid,date,smallint,date,date,text,integer,jsonb) TO authenticated;

COMMIT;

-- =========================================================================
-- 本番ゲート §FG3-0（apply 前に必ず実行・1 行でも返れば index 作成は失敗する）
-- =========================================================================
--   SELECT tenant_id, target_month, mode, count(*)
--   FROM public.payroll_runs
--   WHERE store_id IS NULL
--   GROUP BY tenant_id, target_month, mode
--   HAVING count(*) > 1;
--   → 1 行でも返れば owner の unfinalize_payroll_run で重複を解消してから apply。
--
-- 攻撃検証 §FG3（拒否=PASS）:
--   同 (tenant, target_month, mode, store_id=NULL) で finalize_payroll_run(...) を 2 回
--   → 2 回目は unique_violation を捕捉し上記日本語全文メッセージで RAISE。
