-- Migration 088: 確定済 payroll の manager 削除封鎖 / owner 限定取消 RPC（P2/P3 B1）
--
-- 背景（実測 2026-06-15・本番 zjjbfffhbobwwxyvdszl）:
--   payroll_runs / payroll_run_items の DELETE policy が owner/manager 両方に開いている:
--     pr_delete  : EXISTS(tenant_members role IN('owner','manager'))
--     pri_delete : EXISTS(payroll_runs JOIN tenant_members role IN('owner','manager'))
--   一方フロント UI（PayrollCalculation.tsx）の「確定を取消」ボタンは
--   myRole==='owner' でしか表示されない（=正規導線は owner 限定）。
--   よって manager は UI に出ない取消を PostgREST 直叩きで実行でき、
--   確定済の給与スナップショットを削除できてしまう（item: manager-can-delete-finalized-payroll-run）。
--
-- 重要な実態（設計書の前提との差分・要記録）:
--   payroll_runs.finalized_at は NOT NULL（DEFAULT now()）であり、
--   このテーブルは「確定スナップショットそのもの」を表す。draft / finalized_at IS NULL の
--   行は構造上存在しない（payroll_runs に UPDATE policy も無い＝insert-once）。
--   フロントの unfinalizeRun() も「行を DELETE する」ことで取消を実現している
--   （usePayrollRun.ts:118 付近 / PayrollCalculation.tsx handleUnfinalize→deleteRun）。
--   → 設計書の「finalized_at IS NULL の行のみ owner/manager 削除可」を字義どおり書くと
--     全行が finalized_at NOT NULL のため DELETE が全面不能になり、正規の取消導線
--     （owner の確定取消）と finalizeRun のロールバック削除（後述 frontendImpact）まで壊れる。
--   そのため設計意図（manager の確定削除を封じ owner 限定 RPC に集約）を満たす形として:
--     ・DELETE policy を owner 限定に絞る（manager を外す）。
--     ・確定取消は owner 限定 SECURITY DEFINER RPC unfinalize_payroll_run(run_id) に集約。
--   とする。これは設計書の受け入れ観点③「確定済 payroll は manager DELETE 不可・
--   owner RPC で取消可」を完全に満たす（finalized_at の NULL 判定は本テーブルに無意味なため
--   "確定済" = 全行 とみなし owner 限定化で代替）。
--
-- 設計方針:
--   ① pr_delete / pri_delete を owner 限定へ作り直す（manager を DELETE から外す）。
--      is_tenant_owner(tenant_id) を用い、SECURITY DEFINER helper でスコープ統一。
--   ② unfinalize_payroll_run(run_id uuid) を新設（owner 限定・SECURITY DEFINER）。
--      関数内で auth.uid() が当該 run の tenant の owner か検証し、否なら RAISE EXCEPTION。
--      ON DELETE CASCADE により payroll_run_items も同時削除される。
--      MEMORY RLS 4 行テンプレ: SET search_path=public,pg_temp /
--      REVOKE EXECUTE FROM PUBLIC,anon / GRANT EXECUTE TO authenticated。
--
-- 横串確認（payroll_runs / payroll_run_items の 4 操作）:
--   SELECT : pr_select / pri_select（store_member 全員）→ 変更なし。
--   INSERT : pr_insert / pri_insert（owner/manager）→ 変更なし（確定操作は維持）。
--   UPDATE : policy 無し（insert-once）→ 変更なし。
--   DELETE : pr_delete / pri_delete を owner 限定へ（本 migration）。
--
-- Depends:
--   - 024_payroll_finalization.sql（payroll_runs / payroll_run_items / pr_*/pri_* policy）
--   - is_tenant_owner(uuid) (SECURITY DEFINER STABLE)
--
-- Rollback / 検証SQL: 本ファイル末尾コメント参照。

BEGIN;

-- ① DELETE policy を owner 限定へ ------------------------------------------
DROP POLICY IF EXISTS pr_delete  ON public.payroll_runs;
DROP POLICY IF EXISTS pri_delete ON public.payroll_run_items;

CREATE POLICY pr_delete ON public.payroll_runs
  FOR DELETE
  TO authenticated
  USING ( is_tenant_owner(tenant_id) );

COMMENT ON POLICY pr_delete ON public.payroll_runs IS
  'P2/P3 B1: 確定済 payroll_runs の削除(=確定取消)は owner 限定。'
  'manager の DELETE を封鎖。正規取消は unfinalize_payroll_run RPC 経由。';

CREATE POLICY pri_delete ON public.payroll_run_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.payroll_runs r
      WHERE r.id = payroll_run_items.run_id
        AND is_tenant_owner(r.tenant_id)
    )
  );

COMMENT ON POLICY pri_delete ON public.payroll_run_items IS
  'P2/P3 B1: payroll_run_items の削除は親 run の owner 限定（pr_delete と整合）。'
  'manager の DELETE を封鎖。';

-- ② owner 限定 確定取消 RPC --------------------------------------------------
CREATE OR REPLACE FUNCTION public.unfinalize_payroll_run(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- 対象 run のテナントを取得（存在しなければ NULL）
  SELECT tenant_id INTO v_tenant_id
  FROM public.payroll_runs
  WHERE id = p_run_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'payroll_run % not found', p_run_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- owner 検証（manager は不可）
  IF NOT public.is_tenant_owner(v_tenant_id) THEN
    RAISE EXCEPTION 'only owner can unfinalize payroll_run (tenant %)', v_tenant_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 確定スナップショットを削除（payroll_run_items は ON DELETE CASCADE で同時削除）。
  DELETE FROM public.payroll_runs WHERE id = p_run_id;
END;
$$;

COMMENT ON FUNCTION public.unfinalize_payroll_run(uuid) IS
  'P2/P3 B1: 確定済 payroll_run の取消(削除)を owner 限定で実行。'
  'owner 以外は insufficient_privilege で RAISE。items は CASCADE 削除。';

-- MEMORY RLS 4 行テンプレ（anon 排除）
REVOKE EXECUTE ON FUNCTION public.unfinalize_payroll_run(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unfinalize_payroll_run(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.unfinalize_payroll_run(uuid) TO authenticated;

-- ③ atomic 確定 RPC（孤児 payroll_run 防止・B1 ハードニング） -------------------
--
-- 背景（リグレッション）:
--   088 が pr_delete/pri_delete を owner 限定へ絞った結果、フロント finalizeRun() の
--   「payroll_runs INSERT → payroll_run_items INSERT → items 失敗時に payroll_runs を
--   .delete() でロールバック」という非アトミック実装で、manager が確定して items INSERT が
--   失敗した場合、ロールバックの DELETE が manager には RLS で 0 行（無音 success）になり、
--   items を持たない孤児 payroll_run が残る。
--   → 確定操作そのものを単一トランザクションの SECURITY DEFINER RPC に集約し、
--     失敗時は関数全体が自動ロールバック（孤児なし）とする。
--
-- 設計:
--   ・run のヘッダ列を引数で受け、items を jsonb 配列で受ける（finalizeRun の payload 形状に整合）。
--   ・caller(auth.uid()) が p_tenant_id の owner/manager か検証（pr_insert と同一条件）。否なら
--     insufficient_privilege で RAISE。
--   ・1 トランザクション内で payroll_runs INSERT → payroll_run_items INSERT。
--     run_id は新規 INSERT の id、tenant_id は検証済の引数で固定。items 側 jsonb 内の
--     tenant_id / run_id は信用せず使用しない。
--   ・新 run の id を RETURN（フロントは fetchRun で再取得するため最小返却）。
--   ・MEMORY RLS 4 行テンプレ。
--   ・既存 pr_insert/pri_insert policy は撤去しない（DEFINER で通る・他経路は温存＝最小変更）。
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
  INSERT INTO public.payroll_runs (
    tenant_id, store_id, target_month, close_day,
    period_start, period_end, mode, total_payment, finalized_by
  ) VALUES (
    p_tenant_id, p_store_id, p_target_month, p_close_day,
    p_period_start, p_period_end, p_mode, p_total_payment, auth.uid()
  )
  RETURNING id INTO v_run_id;

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
  'B1: 給与確定を単一トランザクションで実行（孤児 payroll_run 防止）。'
  'caller が tenant の owner/manager か検証し否なら insufficient_privilege。'
  'run INSERT → items INSERT を atomic に行い失敗時は全体ロールバック。'
  'tenant_id は引数で固定・items jsonb 内の run_id/tenant_id は信用しない。';

-- MEMORY RLS 4 行テンプレ（anon 排除）
REVOKE EXECUTE ON FUNCTION public.finalize_payroll_run(uuid,uuid,date,smallint,date,date,text,integer,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_payroll_run(uuid,uuid,date,smallint,date,date,text,integer,jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.finalize_payroll_run(uuid,uuid,date,smallint,date,date,text,integer,jsonb) TO authenticated;

COMMIT;

-- =========================================================================
-- ROLLBACK SQL（088 適用前=owner/manager 両方が DELETE 可・RPC 無しへ復元。手動実行）
-- =========================================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.unfinalize_payroll_run(uuid);
--   DROP POLICY IF EXISTS pr_delete  ON public.payroll_runs;
--   DROP POLICY IF EXISTS pri_delete ON public.payroll_run_items;
--
--   CREATE POLICY pr_delete ON public.payroll_runs FOR DELETE
--     USING ( EXISTS (SELECT 1 FROM public.tenant_members
--                     WHERE tenant_members.tenant_id = payroll_runs.tenant_id
--                       AND tenant_members.user_id = auth.uid()
--                       AND tenant_members.role = ANY (ARRAY['owner','manager'])) );
--
--   CREATE POLICY pri_delete ON public.payroll_run_items FOR DELETE
--     USING ( EXISTS (SELECT 1 FROM public.payroll_runs r
--                     JOIN public.tenant_members tm ON tm.tenant_id = r.tenant_id
--                     WHERE r.id = payroll_run_items.run_id
--                       AND tm.user_id = auth.uid()
--                       AND tm.role = ANY (ARRAY['owner','manager'])) );
-- COMMIT;

-- =========================================================================
-- 適用後 検証 SQL（本番で実行・全件 PASS が承認条件。BEGIN..ROLLBACK で無汚染）
--   <OWNER_UID>/<MANAGER_UID>/<RUN_ID> は当該テナントの実値に置換。
-- =========================================================================
-- -- 0. policy 確認（read-only）: pr_delete/pri_delete が owner 限定式になっているか。
-- -- SELECT polname, pg_get_expr(polqual, polrelid) FROM pg_policy
-- -- WHERE polrelid IN ('public.payroll_runs'::regclass,'public.payroll_run_items'::regclass) AND polcmd='d';
--
-- -- 1.(攻撃) manager が payroll_runs を直 DELETE → PASS=0 rows（RLS で除外）
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<MANAGER_UID>','role','authenticated')::text, true);
-- --   WITH d AS (DELETE FROM public.payroll_runs WHERE id='<RUN_ID>' RETURNING 1) SELECT count(*) FROM d;
-- --   -- → 0 が返れば PASS（manager は確定を消せない）
-- -- ROLLBACK;
--
-- -- 2.(攻撃) manager が unfinalize_payroll_run RPC 実行 → PASS=insufficient_privilege でエラー
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<MANAGER_UID>','role','authenticated')::text, true);
-- --   SELECT public.unfinalize_payroll_run('<RUN_ID>');  -- → ERROR: only owner can unfinalize = PASS
-- -- ROLLBACK;
--
-- -- 3.(正常) owner が unfinalize_payroll_run RPC 実行 → PASS=成功(run と items が消える)
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<OWNER_UID>','role','authenticated')::text, true);
-- --   SELECT public.unfinalize_payroll_run('<RUN_ID>');
-- --   SELECT count(*) FROM public.payroll_runs WHERE id='<RUN_ID>';        -- → 0 = PASS
-- --   SELECT count(*) FROM public.payroll_run_items WHERE run_id='<RUN_ID>'; -- → 0 = PASS（CASCADE）
-- -- ROLLBACK;
--
-- -- 4. RPC の GRANT 確認（read-only）: anon に EXECUTE が無いこと。
-- -- SELECT proname, proacl FROM pg_proc WHERE proname='unfinalize_payroll_run' AND pronamespace='public'::regnamespace;
-- -- 期待: authenticated=X のみ・anon は無し。
