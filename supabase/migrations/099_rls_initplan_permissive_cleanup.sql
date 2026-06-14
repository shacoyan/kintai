-- Migration 099: RLS initplan 最適化 + permissive 整理 + public→authenticated tighten
--
-- 背景:
--   Supabase advisor(performance) の auth_rls_initplan が 61 policy / 22 table で
--   発火している。RLS の述語中に裸の auth.uid() / auth.role() / auth.jwt() を書くと
--   Postgres は行ごとに関数を再評価する（per-row initplan）。これを
--   (select auth.uid()) のようにスカラサブクエリ化すると initplan が 1 回に畳まれ、
--   大量行スキャン時のオーバーヘッドが消える。**述語の論理は一切変えない**
--   （= auth トークンを (select ...) で包むだけ。演算子 / AND-OR 構造 / helper 関数 /
--    定数 / 参照カラム / roles は不変。例外は後述の tighten / merge の 2 系統のみ）。
--
--   併せて以下を実施する:
--   (A) tighten-role: roles={public} の policy 全件を {authenticated} へ絞る。
--       全 public policy は auth.uid()/helper 依存で anon は現状 0 行/拒否のため
--       実トラフィック挙動は不変。anon を multiple-permissive 評価から外し perf 改善 +
--       多層防御 + lint 全消し。signup/招待は anon RLS 非依存（preview_invite RPC=
--       SECURITY DEFINER）であることを本番ゲート step1 で確定後に適用する。
--   (B) merge: breaks の "Managers can view tenant breaks"(SELECT 専用) は
--       "Managers can manage tenant breaks"(ALL) と USING 述語が完全同一 = 冗長。
--       この SELECT 専用 policy 1 件のみ DROP する（read は ALL 側が完全に包含）。
--
-- 触らないもの（設計どおり leave）:
--   - 既に (select auth.uid()) 形に正規化済の policy = member_store_payrolls 4 本 /
--     shift_submission_deadlines 4 本 / store_members UPDATE WITH CHECK の prev サブクエリ。
--     → 二重 select 化しない（tighten の roles 変更も既に authenticated/対象外）。
--   - leave_requests UPDATE の self/reviewer 2 本（P1 自己承認封じの核）。merge 禁止。
--   - self/manager の意図分割（attendance/breaks/correction_requests/stores/
--     shift_preferences UPDATE 等）は merge せず維持（OR 同値で正当）。
--   - helper 関数 get_my_tenant_ids/is_tenant_*/is_my_store/is_task_assignee は
--     STABLE/SECURITY DEFINER 確認済で initplan 対象外。式中の helper 呼出はそのまま。
--
-- 検証（適用後・本ファイル末尾 ROLLBACK 後に手動で実行）:
--   【INV-1 select ラップ差分証明】適用前後で全 public/対象 policy の
--     pg_get_expr(qual)/pg_get_expr(with_check) を取得し diff。許容差分は
--     (i) auth トークンに (select ) が付いた箇所 (ii) roles {public}->{authenticated}
--     (iii) breaks view policy 1 件消失 ——以外ゼロ。
--   【INV-2 behavioral】owner/manager/アルバイトself/別 tenant/anon で代表テーブル
--     (attendance_records/leave_requests/shifts/tasks/tenant_members) の SELECT 可視行数 /
--     INSERT/UPDATE 可否が完全一致。自己承認封じ維持・別 tenant 0 行・anon 0 行/拒否。
--   get_advisors(performance): auth_rls_initplan=0 / multiple_permissive は leave 群のみ。
--   get_advisors(security): 新規 lint 増加なし。
--
-- 本番 apply はこのファイル単体では行わない（Tech Lead / 本番ゲート経由）。

BEGIN;

-- =====================================================================
-- attendance_records
-- =====================================================================
DROP POLICY IF EXISTS "Managers can insert tenant records" ON public.attendance_records;
CREATE POLICY "Managers can insert tenant records" ON public.attendance_records
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN ( SELECT tenant_members.tenant_id
     FROM tenant_members
    WHERE ((tenant_members.user_id = ( SELECT auth.uid() AS uid)) AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

DROP POLICY IF EXISTS "Users insert own records" ON public.attendance_records;
CREATE POLICY "Users insert own records" ON public.attendance_records
  FOR INSERT TO authenticated
  WITH CHECK (user_id = ( SELECT auth.uid() AS uid));

DROP POLICY IF EXISTS "Managers can delete tenant records" ON public.attendance_records;
CREATE POLICY "Managers can delete tenant records" ON public.attendance_records
  FOR DELETE TO authenticated
  USING (tenant_id IN ( SELECT tenant_members.tenant_id
     FROM tenant_members
    WHERE ((tenant_members.user_id = ( SELECT auth.uid() AS uid)) AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

DROP POLICY IF EXISTS "Managers can view tenant records" ON public.attendance_records;
CREATE POLICY "Managers can view tenant records" ON public.attendance_records
  FOR SELECT TO authenticated
  USING (tenant_id IN ( SELECT tenant_members.tenant_id
     FROM tenant_members
    WHERE ((tenant_members.user_id = ( SELECT auth.uid() AS uid)) AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

DROP POLICY IF EXISTS "Users view own records" ON public.attendance_records;
CREATE POLICY "Users view own records" ON public.attendance_records
  FOR SELECT TO authenticated
  USING (user_id = ( SELECT auth.uid() AS uid));

DROP POLICY IF EXISTS "Managers can update attendance" ON public.attendance_records;
CREATE POLICY "Managers can update attendance" ON public.attendance_records
  FOR UPDATE TO authenticated
  USING (tenant_id IN ( SELECT tenant_members.tenant_id
     FROM tenant_members
    WHERE ((tenant_members.user_id = ( SELECT auth.uid() AS uid)) AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])))))
  WITH CHECK (tenant_id IN ( SELECT tenant_members.tenant_id
     FROM tenant_members
    WHERE ((tenant_members.user_id = ( SELECT auth.uid() AS uid)) AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

DROP POLICY IF EXISTS "Users update own records" ON public.attendance_records;
CREATE POLICY "Users update own records" ON public.attendance_records
  FOR UPDATE TO authenticated
  USING (user_id = ( SELECT auth.uid() AS uid));

-- =====================================================================
-- breaks  (＋ merge: "Managers can view tenant breaks" を DROP のみ)
-- =====================================================================
DROP POLICY IF EXISTS "Managers can view tenant breaks" ON public.breaks;  -- merge: ALL 側に完全包含

DROP POLICY IF EXISTS "Managers can manage tenant breaks" ON public.breaks;
CREATE POLICY "Managers can manage tenant breaks" ON public.breaks
  FOR ALL TO authenticated
  USING (attendance_record_id IN ( SELECT attendance_records.id
     FROM attendance_records
    WHERE (attendance_records.tenant_id IN ( SELECT tenant_members.tenant_id
             FROM tenant_members
            WHERE ((tenant_members.user_id = ( SELECT auth.uid() AS uid)) AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])))))));

DROP POLICY IF EXISTS "Users manage own breaks" ON public.breaks;
CREATE POLICY "Users manage own breaks" ON public.breaks
  FOR ALL TO authenticated
  USING (attendance_record_id IN ( SELECT attendance_records.id
     FROM attendance_records
    WHERE (attendance_records.user_id = ( SELECT auth.uid() AS uid))));

-- =====================================================================
-- correction_requests
-- =====================================================================
DROP POLICY IF EXISTS "Users insert own requests" ON public.correction_requests;
CREATE POLICY "Users insert own requests" ON public.correction_requests
  FOR INSERT TO authenticated
  WITH CHECK (user_id = ( SELECT auth.uid() AS uid));

DROP POLICY IF EXISTS "Managers can delete requests" ON public.correction_requests;
CREATE POLICY "Managers can delete requests" ON public.correction_requests
  FOR DELETE TO authenticated
  USING (tenant_id IN ( SELECT tenant_members.tenant_id
     FROM tenant_members
    WHERE ((tenant_members.user_id = ( SELECT auth.uid() AS uid)) AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

DROP POLICY IF EXISTS "Managers can view tenant requests" ON public.correction_requests;
CREATE POLICY "Managers can view tenant requests" ON public.correction_requests
  FOR SELECT TO authenticated
  USING (tenant_id IN ( SELECT tenant_members.tenant_id
     FROM tenant_members
    WHERE ((tenant_members.user_id = ( SELECT auth.uid() AS uid)) AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

DROP POLICY IF EXISTS "Users view own requests" ON public.correction_requests;
CREATE POLICY "Users view own requests" ON public.correction_requests
  FOR SELECT TO authenticated
  USING (user_id = ( SELECT auth.uid() AS uid));

DROP POLICY IF EXISTS "Managers can update requests" ON public.correction_requests;
CREATE POLICY "Managers can update requests" ON public.correction_requests
  FOR UPDATE TO authenticated
  USING (tenant_id IN ( SELECT tenant_members.tenant_id
     FROM tenant_members
    WHERE ((tenant_members.user_id = ( SELECT auth.uid() AS uid)) AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

-- =====================================================================
-- daily_reports  (INSERT のみ素 auth。SELECT/UPDATE/DELETE は helper のみだが
--                 tighten 対象なので roles を authenticated へ。式は不変)
-- =====================================================================
DROP POLICY IF EXISTS "daily_reports_insert" ON public.daily_reports;
CREATE POLICY "daily_reports_insert" ON public.daily_reports
  FOR INSERT TO authenticated
  WITH CHECK ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (created_by = ( SELECT auth.uid() AS uid)) AND (is_tenant_managerial(tenant_id) OR is_my_store(store_id)));

DROP POLICY IF EXISTS "daily_reports_delete" ON public.daily_reports;
CREATE POLICY "daily_reports_delete" ON public.daily_reports
  FOR DELETE TO authenticated
  USING ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND is_tenant_managerial(tenant_id));

DROP POLICY IF EXISTS "daily_reports_select" ON public.daily_reports;
CREATE POLICY "daily_reports_select" ON public.daily_reports
  FOR SELECT TO authenticated
  USING ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (is_tenant_managerial(tenant_id) OR is_my_store(store_id)));

DROP POLICY IF EXISTS "daily_reports_update" ON public.daily_reports;
CREATE POLICY "daily_reports_update" ON public.daily_reports
  FOR UPDATE TO authenticated
  USING ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (is_tenant_managerial(tenant_id) OR is_my_store(store_id)))
  WITH CHECK ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (is_tenant_managerial(tenant_id) OR is_my_store(store_id)));

-- =====================================================================
-- invite_code_stores  (roles 既 authenticated。USING/CHECK の裸 auth.uid() を wrap)
-- =====================================================================
DROP POLICY IF EXISTS "invite_code_stores_modify_admin" ON public.invite_code_stores;
CREATE POLICY "invite_code_stores_modify_admin" ON public.invite_code_stores
  FOR ALL TO authenticated
  USING (EXISTS ( SELECT 1
     FROM tenant_members tm
    WHERE ((tm.tenant_id = invite_code_stores.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text])))))
  WITH CHECK ((EXISTS ( SELECT 1
     FROM tenant_members tm
    WHERE ((tm.tenant_id = invite_code_stores.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text]))))) AND (EXISTS ( SELECT 1
     FROM stores s
    WHERE ((s.id = invite_code_stores.store_id) AND (s.tenant_id = invite_code_stores.tenant_id)))));

DROP POLICY IF EXISTS "invite_code_stores_select_admin" ON public.invite_code_stores;
CREATE POLICY "invite_code_stores_select_admin" ON public.invite_code_stores
  FOR SELECT TO authenticated
  USING (EXISTS ( SELECT 1
     FROM tenant_members tm
    WHERE ((tm.tenant_id = invite_code_stores.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

-- =====================================================================
-- leave_requests  (roles 既 authenticated。self/reviewer は merge 禁止・式は wrap のみ)
-- =====================================================================
DROP POLICY IF EXISTS "leave_insert_self" ON public.leave_requests;
CREATE POLICY "leave_insert_self" ON public.leave_requests
  FOR INSERT TO authenticated
  WITH CHECK ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (user_id = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::text) AND (reviewed_by IS NULL) AND (reviewed_at IS NULL));

DROP POLICY IF EXISTS "leave_delete" ON public.leave_requests;
CREATE POLICY "leave_delete" ON public.leave_requests
  FOR DELETE TO authenticated
  USING (((user_id = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::text)) OR is_tenant_owner(tenant_id));

DROP POLICY IF EXISTS "leave_select" ON public.leave_requests;
CREATE POLICY "leave_select" ON public.leave_requests
  FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)) OR is_tenant_managerial(tenant_id));

DROP POLICY IF EXISTS "leave_update_reviewer" ON public.leave_requests;
CREATE POLICY "leave_update_reviewer" ON public.leave_requests
  FOR UPDATE TO authenticated
  USING ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (is_tenant_owner(tenant_id) OR (EXISTS ( SELECT 1
     FROM tenant_members tm
    WHERE ((tm.tenant_id = leave_requests.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text])))))))
  WITH CHECK ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (is_tenant_owner(tenant_id) OR (EXISTS ( SELECT 1
     FROM tenant_members tm
    WHERE ((tm.tenant_id = leave_requests.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text])))))));

DROP POLICY IF EXISTS "leave_update_self" ON public.leave_requests;
CREATE POLICY "leave_update_self" ON public.leave_requests
  FOR UPDATE TO authenticated
  USING ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (user_id = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::text))
  WITH CHECK ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (user_id = ( SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY['pending'::text, 'cancelled'::text])) AND (reviewed_by IS NULL) AND (reviewed_at IS NULL));

-- =====================================================================
-- notifications
-- =====================================================================
DROP POLICY IF EXISTS "notifications_insert_owner_manager" ON public.notifications;
CREATE POLICY "notifications_insert_owner_manager" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
     FROM tenant_members tm
    WHERE ((tm.tenant_id = notifications.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text]))))) AND (EXISTS ( SELECT 1
     FROM tenant_members tm
    WHERE ((tm.tenant_id = notifications.tenant_id) AND (tm.user_id = notifications.user_id)))));

DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;
CREATE POLICY "notifications_delete_own" ON public.notifications
  FOR DELETE TO authenticated
  USING (user_id = ( SELECT auth.uid() AS uid));

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = ( SELECT auth.uid() AS uid));

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = ( SELECT auth.uid() AS uid))
  WITH CHECK (user_id = ( SELECT auth.uid() AS uid));

-- =====================================================================
-- payroll_run_items
-- =====================================================================
DROP POLICY IF EXISTS "pri_insert" ON public.payroll_run_items;
CREATE POLICY "pri_insert" ON public.payroll_run_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
     FROM (payroll_runs r
       JOIN tenant_members tm ON ((tm.tenant_id = r.tenant_id)))
    WHERE ((r.id = payroll_run_items.run_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

-- pri_delete: roles 既 authenticated。式は helper(is_tenant_owner)のみ＝裸 auth 無し。
DROP POLICY IF EXISTS "pri_delete" ON public.payroll_run_items;
CREATE POLICY "pri_delete" ON public.payroll_run_items
  FOR DELETE TO authenticated
  USING (EXISTS ( SELECT 1
     FROM payroll_runs r
    WHERE ((r.id = payroll_run_items.run_id) AND is_tenant_owner(r.tenant_id))));

DROP POLICY IF EXISTS "pri_select" ON public.payroll_run_items;
CREATE POLICY "pri_select" ON public.payroll_run_items
  FOR SELECT TO authenticated
  USING (EXISTS ( SELECT 1
     FROM payroll_runs r
    WHERE ((r.id = payroll_run_items.run_id) AND (r.tenant_id IN ( SELECT tenant_members.tenant_id
             FROM tenant_members
            WHERE (tenant_members.user_id = ( SELECT auth.uid() AS uid)))))));

-- =====================================================================
-- payroll_runs
-- =====================================================================
DROP POLICY IF EXISTS "pr_insert" ON public.payroll_runs;
CREATE POLICY "pr_insert" ON public.payroll_runs
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
     FROM tenant_members
    WHERE ((tenant_members.tenant_id = payroll_runs.tenant_id) AND (tenant_members.user_id = ( SELECT auth.uid() AS uid)) AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

-- pr_delete: roles 既 authenticated。式は helper のみ＝裸 auth 無し。
DROP POLICY IF EXISTS "pr_delete" ON public.payroll_runs;
CREATE POLICY "pr_delete" ON public.payroll_runs
  FOR DELETE TO authenticated
  USING (is_tenant_owner(tenant_id));

DROP POLICY IF EXISTS "pr_select" ON public.payroll_runs;
CREATE POLICY "pr_select" ON public.payroll_runs
  FOR SELECT TO authenticated
  USING (tenant_id IN ( SELECT tenant_members.tenant_id
     FROM tenant_members
    WHERE (tenant_members.user_id = ( SELECT auth.uid() AS uid))));

-- =====================================================================
-- projects  (INSERT のみ素 auth(created_by)。他は helper のみだが tighten 対象)
-- =====================================================================
DROP POLICY IF EXISTS "projects_insert" ON public.projects;
CREATE POLICY "projects_insert" ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (created_by = ( SELECT auth.uid() AS uid)) AND (NOT is_tenant_parttime(tenant_id)) AND (is_tenant_managerial(tenant_id) OR ((store_id IS NOT NULL) AND is_my_store(store_id))));

DROP POLICY IF EXISTS "projects_delete" ON public.projects;
CREATE POLICY "projects_delete" ON public.projects
  FOR DELETE TO authenticated
  USING ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND is_tenant_managerial(tenant_id));

DROP POLICY IF EXISTS "projects_select" ON public.projects;
CREATE POLICY "projects_select" ON public.projects
  FOR SELECT TO authenticated
  USING ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND ((store_id IS NULL) OR is_tenant_managerial(tenant_id) OR is_my_store(store_id)));

DROP POLICY IF EXISTS "projects_update" ON public.projects;
CREATE POLICY "projects_update" ON public.projects
  FOR UPDATE TO authenticated
  USING ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (NOT is_tenant_parttime(tenant_id)) AND (is_tenant_managerial(tenant_id) OR ((store_id IS NOT NULL) AND is_my_store(store_id))))
  WITH CHECK ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (NOT is_tenant_parttime(tenant_id)) AND (is_tenant_managerial(tenant_id) OR ((store_id IS NOT NULL) AND is_my_store(store_id))));

-- =====================================================================
-- shift_preferences  (roles 一部 public→authenticated tighten + wrap)
-- =====================================================================
DROP POLICY IF EXISTS "shift_preferences_insert_with_deadline" ON public.shift_preferences;
CREATE POLICY "shift_preferences_insert_with_deadline" ON public.shift_preferences
  FOR INSERT TO authenticated
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)) AND (tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND ((EXISTS ( SELECT 1
     FROM tenant_members
    WHERE ((tenant_members.tenant_id = shift_preferences.tenant_id) AND (tenant_members.user_id = ( SELECT auth.uid() AS uid)) AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text]))))) OR (NOT (EXISTS ( SELECT 1
     FROM shift_submission_deadlines d
    WHERE ((d.tenant_id = shift_preferences.tenant_id) AND (d.store_id = shift_preferences.store_id) AND (d.target_month = (date_trunc('month'::text, (shift_preferences.date)::timestamp with time zone))::date) AND (d.deadline_at < now())))))));

DROP POLICY IF EXISTS "shift_preferences_delete_self_pre_approval" ON public.shift_preferences;
CREATE POLICY "shift_preferences_delete_self_pre_approval" ON public.shift_preferences
  FOR DELETE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)) AND (tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (status = ANY (ARRAY['pending'::text, 'rejected'::text])));

DROP POLICY IF EXISTS "Managers can view all shift_preferences" ON public.shift_preferences;
CREATE POLICY "Managers can view all shift_preferences" ON public.shift_preferences
  FOR SELECT TO authenticated
  USING (tenant_id IN ( SELECT tenant_members.tenant_id
     FROM tenant_members
    WHERE ((tenant_members.user_id = ( SELECT auth.uid() AS uid)) AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

DROP POLICY IF EXISTS "shift_preferences_select_self" ON public.shift_preferences;
CREATE POLICY "shift_preferences_select_self" ON public.shift_preferences
  FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)) AND (tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)));

DROP POLICY IF EXISTS "shift_preferences_manager_update" ON public.shift_preferences;
CREATE POLICY "shift_preferences_manager_update" ON public.shift_preferences
  FOR UPDATE TO authenticated
  USING ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (EXISTS ( SELECT 1
     FROM tenant_members tm
    WHERE ((tm.tenant_id = shift_preferences.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text]))))))
  WITH CHECK ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (EXISTS ( SELECT 1
     FROM tenant_members tm
    WHERE ((tm.tenant_id = shift_preferences.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));

DROP POLICY IF EXISTS "shift_preferences_update_self_pre_approval" ON public.shift_preferences;
CREATE POLICY "shift_preferences_update_self_pre_approval" ON public.shift_preferences
  FOR UPDATE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)) AND (tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND ((status = 'pending'::text) OR (status = 'rejected'::text) OR ((status = 'approved'::text) AND (preference_type = 'unavailable'::text))))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)) AND (tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND ((status = ANY (ARRAY['pending'::text, 'rejected'::text])) OR ((status = 'approved'::text) AND (preference_type = 'unavailable'::text))));

-- =====================================================================
-- shift_presets
-- =====================================================================
DROP POLICY IF EXISTS "shift_presets_insert" ON public.shift_presets;
CREATE POLICY "shift_presets_insert" ON public.shift_presets
  FOR INSERT TO authenticated
  WITH CHECK (is_tenant_owner(tenant_id) OR (EXISTS ( SELECT 1
     FROM tenant_members
    WHERE ((tenant_members.tenant_id = shift_presets.tenant_id) AND (tenant_members.user_id = ( SELECT auth.uid() AS uid)) AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));

DROP POLICY IF EXISTS "shift_presets_delete" ON public.shift_presets;
CREATE POLICY "shift_presets_delete" ON public.shift_presets
  FOR DELETE TO authenticated
  USING (is_tenant_owner(tenant_id) OR (EXISTS ( SELECT 1
     FROM tenant_members
    WHERE ((tenant_members.tenant_id = shift_presets.tenant_id) AND (tenant_members.user_id = ( SELECT auth.uid() AS uid)) AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));

DROP POLICY IF EXISTS "shift_presets_select" ON public.shift_presets;
CREATE POLICY "shift_presets_select" ON public.shift_presets
  FOR SELECT TO authenticated
  USING (tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids));

DROP POLICY IF EXISTS "shift_presets_update" ON public.shift_presets;
CREATE POLICY "shift_presets_update" ON public.shift_presets
  FOR UPDATE TO authenticated
  USING (is_tenant_owner(tenant_id) OR (EXISTS ( SELECT 1
     FROM tenant_members
    WHERE ((tenant_members.tenant_id = shift_presets.tenant_id) AND (tenant_members.user_id = ( SELECT auth.uid() AS uid)) AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));

-- =====================================================================
-- shifts  (insert/update は式中 auth.uid() が 2 回 → 両方 wrap)
-- =====================================================================
DROP POLICY IF EXISTS "shifts_insert" ON public.shifts;
CREATE POLICY "shifts_insert" ON public.shifts
  FOR INSERT TO authenticated
  WITH CHECK ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR is_tenant_owner(tenant_id) OR (EXISTS ( SELECT 1
     FROM tenant_members
    WHERE ((tenant_members.tenant_id = shifts.tenant_id) AND (tenant_members.user_id = ( SELECT auth.uid() AS uid)) AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])))))));

DROP POLICY IF EXISTS "shifts_delete" ON public.shifts;
CREATE POLICY "shifts_delete" ON public.shifts
  FOR DELETE TO authenticated
  USING (is_tenant_owner(tenant_id));

DROP POLICY IF EXISTS "shifts_select" ON public.shifts;
CREATE POLICY "shifts_select" ON public.shifts
  FOR SELECT TO authenticated
  USING (tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids));

DROP POLICY IF EXISTS "shifts_update" ON public.shifts;
CREATE POLICY "shifts_update" ON public.shifts
  FOR UPDATE TO authenticated
  USING ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR is_tenant_owner(tenant_id) OR (EXISTS ( SELECT 1
     FROM tenant_members
    WHERE ((tenant_members.tenant_id = shifts.tenant_id) AND (tenant_members.user_id = ( SELECT auth.uid() AS uid)) AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])))))));

-- =====================================================================
-- store_members  (UPDATE WITH CHECK の prev サブクエリ内 auth.uid() は既 wrap 済→不変。
--                 USING / 他 policy の裸 auth.uid() のみ wrap)
-- =====================================================================
DROP POLICY IF EXISTS "Managers can insert store_members" ON public.store_members;
CREATE POLICY "Managers can insert store_members" ON public.store_members
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
     FROM (stores s
       JOIN tenant_members tm ON ((tm.tenant_id = s.tenant_id)))
    WHERE ((s.id = store_members.store_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

DROP POLICY IF EXISTS "Managers can delete store_members" ON public.store_members;
CREATE POLICY "Managers can delete store_members" ON public.store_members
  FOR DELETE TO authenticated
  USING (EXISTS ( SELECT 1
     FROM (stores s
       JOIN tenant_members tm ON ((tm.tenant_id = s.tenant_id)))
    WHERE ((s.id = store_members.store_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

DROP POLICY IF EXISTS "Tenant members can view store_members" ON public.store_members;
CREATE POLICY "Tenant members can view store_members" ON public.store_members
  FOR SELECT TO authenticated
  USING (EXISTS ( SELECT 1
     FROM (stores s
       JOIN tenant_members tm ON ((tm.tenant_id = s.tenant_id)))
    WHERE ((s.id = store_members.store_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)))));

DROP POLICY IF EXISTS "Managers can update store_members" ON public.store_members;
CREATE POLICY "Managers can update store_members" ON public.store_members
  FOR UPDATE TO authenticated
  USING (EXISTS ( SELECT 1
     FROM (stores s
       JOIN tenant_members tm ON ((tm.tenant_id = s.tenant_id)))
    WHERE ((s.id = store_members.store_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text])))))
  WITH CHECK ((is_manager = ( SELECT prev.is_manager
     FROM store_members prev
    WHERE (prev.id = store_members.id))) OR (EXISTS ( SELECT 1
     FROM (stores s
       JOIN tenant_members tm ON ((tm.tenant_id = s.tenant_id)))
    WHERE ((s.id = store_members.store_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = 'owner'::text)))));

-- =====================================================================
-- store_monthly_settings  (INSERT のみ素 auth(created_by)。他 helper のみ tighten)
-- =====================================================================
DROP POLICY IF EXISTS "store_monthly_settings_insert" ON public.store_monthly_settings;
CREATE POLICY "store_monthly_settings_insert" ON public.store_monthly_settings
  FOR INSERT TO authenticated
  WITH CHECK ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (created_by = ( SELECT auth.uid() AS uid)) AND is_tenant_managerial(tenant_id));

DROP POLICY IF EXISTS "store_monthly_settings_delete" ON public.store_monthly_settings;
CREATE POLICY "store_monthly_settings_delete" ON public.store_monthly_settings
  FOR DELETE TO authenticated
  USING ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND is_tenant_managerial(tenant_id));

DROP POLICY IF EXISTS "store_monthly_settings_select" ON public.store_monthly_settings;
CREATE POLICY "store_monthly_settings_select" ON public.store_monthly_settings
  FOR SELECT TO authenticated
  USING ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND is_tenant_managerial(tenant_id));

DROP POLICY IF EXISTS "store_monthly_settings_update" ON public.store_monthly_settings;
CREATE POLICY "store_monthly_settings_update" ON public.store_monthly_settings
  FOR UPDATE TO authenticated
  USING ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND is_tenant_managerial(tenant_id))
  WITH CHECK ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND is_tenant_managerial(tenant_id));

-- =====================================================================
-- stores
-- =====================================================================
DROP POLICY IF EXISTS "Managers can manage stores" ON public.stores;
CREATE POLICY "Managers can manage stores" ON public.stores
  FOR ALL TO authenticated
  USING (tenant_id IN ( SELECT tenant_members.tenant_id
     FROM tenant_members
    WHERE ((tenant_members.user_id = ( SELECT auth.uid() AS uid)) AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

DROP POLICY IF EXISTS "Tenant members can view stores" ON public.stores;
CREATE POLICY "Tenant members can view stores" ON public.stores
  FOR SELECT TO authenticated
  USING (tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids));

-- =====================================================================
-- task_assignees  (式は helper のみ＝裸 auth 無し。tighten のみ)
-- =====================================================================
DROP POLICY IF EXISTS "task_assignees_insert" ON public.task_assignees;
CREATE POLICY "task_assignees_insert" ON public.task_assignees
  FOR INSERT TO authenticated
  WITH CHECK ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (NOT is_tenant_parttime(tenant_id)) AND (EXISTS ( SELECT 1
     FROM tasks t
    WHERE ((t.id = task_assignees.task_id) AND (is_tenant_managerial(t.tenant_id) OR ((t.store_id IS NOT NULL) AND is_my_store(t.store_id)))))));

DROP POLICY IF EXISTS "task_assignees_delete" ON public.task_assignees;
CREATE POLICY "task_assignees_delete" ON public.task_assignees
  FOR DELETE TO authenticated
  USING ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (NOT is_tenant_parttime(tenant_id)) AND (EXISTS ( SELECT 1
     FROM tasks t
    WHERE ((t.id = task_assignees.task_id) AND (is_tenant_managerial(t.tenant_id) OR ((t.store_id IS NOT NULL) AND is_my_store(t.store_id)))))));

DROP POLICY IF EXISTS "task_assignees_select" ON public.task_assignees;
CREATE POLICY "task_assignees_select" ON public.task_assignees
  FOR SELECT TO authenticated
  USING ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (EXISTS ( SELECT 1
     FROM tasks t
    WHERE (t.id = task_assignees.task_id))));

-- =====================================================================
-- tasks  (INSERT のみ素 auth(created_by)。delete も created_by=auth.uid())
-- =====================================================================
DROP POLICY IF EXISTS "tasks_insert" ON public.tasks;
CREATE POLICY "tasks_insert" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (created_by = ( SELECT auth.uid() AS uid)) AND (NOT is_tenant_parttime(tenant_id)) AND (is_tenant_managerial(tenant_id) OR ((store_id IS NOT NULL) AND is_my_store(store_id))));

DROP POLICY IF EXISTS "tasks_delete" ON public.tasks;
CREATE POLICY "tasks_delete" ON public.tasks
  FOR DELETE TO authenticated
  USING ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (is_tenant_managerial(tenant_id) OR ((NOT is_tenant_parttime(tenant_id)) AND (store_id IS NOT NULL) AND is_my_store(store_id) AND (created_by = ( SELECT auth.uid() AS uid)))));

DROP POLICY IF EXISTS "tasks_select" ON public.tasks;
CREATE POLICY "tasks_select" ON public.tasks
  FOR SELECT TO authenticated
  USING ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND ((store_id IS NULL) OR is_tenant_managerial(tenant_id) OR is_my_store(store_id) OR is_task_assignee(id)));

DROP POLICY IF EXISTS "tasks_update" ON public.tasks;
CREATE POLICY "tasks_update" ON public.tasks
  FOR UPDATE TO authenticated
  USING ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (is_tenant_managerial(tenant_id) OR ((NOT is_tenant_parttime(tenant_id)) AND (store_id IS NOT NULL) AND is_my_store(store_id)) OR is_task_assignee(id)))
  WITH CHECK ((tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids)) AND (is_tenant_managerial(tenant_id) OR ((NOT is_tenant_parttime(tenant_id)) AND (store_id IS NOT NULL) AND is_my_store(store_id)) OR is_task_assignee(id)));

-- =====================================================================
-- tenant_invite_code_stores  (roles 既 authenticated。USING/CHECK の auth.uid() wrap)
-- =====================================================================
DROP POLICY IF EXISTS "tenant_invite_code_stores_modify_admin" ON public.tenant_invite_code_stores;
CREATE POLICY "tenant_invite_code_stores_modify_admin" ON public.tenant_invite_code_stores
  FOR ALL TO authenticated
  USING (EXISTS ( SELECT 1
     FROM (tenant_invite_codes ic
       JOIN tenant_members tm ON (((tm.tenant_id = ic.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text])))))
    WHERE (ic.id = tenant_invite_code_stores.invite_code_id)))
  WITH CHECK ((EXISTS ( SELECT 1
     FROM (tenant_invite_codes ic
       JOIN tenant_members tm ON (((tm.tenant_id = ic.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text])))))
    WHERE (ic.id = tenant_invite_code_stores.invite_code_id))) AND (EXISTS ( SELECT 1
     FROM (tenant_invite_codes ic
       JOIN stores s ON ((s.tenant_id = ic.tenant_id)))
    WHERE ((ic.id = tenant_invite_code_stores.invite_code_id) AND (s.id = tenant_invite_code_stores.store_id)))));

DROP POLICY IF EXISTS "tenant_invite_code_stores_select_admin" ON public.tenant_invite_code_stores;
CREATE POLICY "tenant_invite_code_stores_select_admin" ON public.tenant_invite_code_stores
  FOR SELECT TO authenticated
  USING (EXISTS ( SELECT 1
     FROM (tenant_invite_codes ic
       JOIN tenant_members tm ON (((tm.tenant_id = ic.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text])))))
    WHERE (ic.id = tenant_invite_code_stores.invite_code_id)));

-- =====================================================================
-- tenant_invite_codes  (roles 既 authenticated。USING/CHECK の auth.uid() wrap)
-- =====================================================================
DROP POLICY IF EXISTS "tenant_invite_codes_modify_admin" ON public.tenant_invite_codes;
CREATE POLICY "tenant_invite_codes_modify_admin" ON public.tenant_invite_codes
  FOR ALL TO authenticated
  USING (EXISTS ( SELECT 1
     FROM tenant_members tm
    WHERE ((tm.tenant_id = tenant_invite_codes.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text])))))
  WITH CHECK (EXISTS ( SELECT 1
     FROM tenant_members tm
    WHERE ((tm.tenant_id = tenant_invite_codes.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

DROP POLICY IF EXISTS "tenant_invite_codes_select_admin" ON public.tenant_invite_codes;
CREATE POLICY "tenant_invite_codes_select_admin" ON public.tenant_invite_codes
  FOR SELECT TO authenticated
  USING (EXISTS ( SELECT 1
     FROM tenant_members tm
    WHERE ((tm.tenant_id = tenant_invite_codes.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

-- =====================================================================
-- tenant_members  (insert_self_owner は式中 auth.uid() が 2 回 → 両方 wrap)
-- =====================================================================
DROP POLICY IF EXISTS "tenant_members_insert_self_owner" ON public.tenant_members;
CREATE POLICY "tenant_members_insert_self_owner" ON public.tenant_members
  FOR INSERT TO authenticated
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)) AND (role = 'owner'::text) AND (EXISTS ( SELECT 1
     FROM tenants t
    WHERE ((t.id = tenant_members.tenant_id) AND (t.owner_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "tenant_members_delete_self_non_owner" ON public.tenant_members;
CREATE POLICY "tenant_members_delete_self_non_owner" ON public.tenant_members
  FOR DELETE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)) AND (role <> 'owner'::text));

DROP POLICY IF EXISTS "Members can view co-members" ON public.tenant_members;
CREATE POLICY "Members can view co-members" ON public.tenant_members
  FOR SELECT TO authenticated
  USING (tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids));

-- tenant_members_update_non_owner: roles 既 authenticated。式は helper のみ＝裸 auth 無し。
DROP POLICY IF EXISTS "tenant_members_update_non_owner" ON public.tenant_members;
CREATE POLICY "tenant_members_update_non_owner" ON public.tenant_members
  FOR UPDATE TO authenticated
  USING ((role <> 'owner'::text) AND is_tenant_managerial(tenant_id))
  WITH CHECK ((role <> 'owner'::text) AND is_tenant_managerial(tenant_id));

-- =====================================================================
-- tenant_roles
-- =====================================================================
DROP POLICY IF EXISTS "tenant_roles_modify_owner_manager" ON public.tenant_roles;
CREATE POLICY "tenant_roles_modify_owner_manager" ON public.tenant_roles
  FOR ALL TO authenticated
  USING (tenant_id IN ( SELECT tm.tenant_id
     FROM tenant_members tm
    WHERE ((tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text])))))
  WITH CHECK (tenant_id IN ( SELECT tm.tenant_id
     FROM tenant_members tm
    WHERE ((tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

DROP POLICY IF EXISTS "tenant_roles_select" ON public.tenant_roles;
CREATE POLICY "tenant_roles_select" ON public.tenant_roles
  FOR SELECT TO authenticated
  USING (EXISTS ( SELECT 1
     FROM tenant_members tm
    WHERE ((tm.tenant_id = tenant_roles.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

-- =====================================================================
-- tenants
-- =====================================================================
DROP POLICY IF EXISTS "Authenticated users can create tenants" ON public.tenants;
CREATE POLICY "Authenticated users can create tenants" ON public.tenants
  FOR INSERT TO authenticated
  WITH CHECK (( SELECT auth.uid() AS uid) = owner_id);

DROP POLICY IF EXISTS "Members can view their tenants" ON public.tenants;
CREATE POLICY "Members can view their tenants" ON public.tenants
  FOR SELECT TO authenticated
  USING (id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids));

DROP POLICY IF EXISTS "Owner can view own tenants" ON public.tenants;
CREATE POLICY "Owner can view own tenants" ON public.tenants
  FOR SELECT TO authenticated
  USING (owner_id = ( SELECT auth.uid() AS uid));

COMMIT;

-- ROLLBACK;  -- 検証時に手動 BEGIN; ...; ROLLBACK; で空振り確認する場合に使用

-- =====================================================================
-- 検証 SQL（適用後に手動実行・本ファイルには含めず参考掲載）
-- =====================================================================
-- 1) initplan / multiple_permissive の残存確認:
--    get_advisors(performance) → auth_rls_initplan = 0 を確認。
--    multiple_permissive は self/manager 分割 leave 群のみ（anon 由来 0 行）。
-- 2) 全 policy の roles が authenticated になり {public} が 0 件であること:
--    SELECT count(*) FROM pg_policy p
--      JOIN pg_class c ON c.oid=p.polrelid
--      JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
--    WHERE p.polroles='{0}';   -- 期待値 0
-- 3) 裸 auth トークン（(select で包まれていない auth.*）の残存確認:
--    SELECT c.relname, p.polname FROM pg_policy p
--      JOIN pg_class c ON c.oid=p.polrelid
--      JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
--    WHERE (pg_get_expr(p.polqual,p.polrelid)  ~ 'auth\.(uid|role|jwt)\(\)'
--           AND pg_get_expr(p.polqual,p.polrelid)  !~ 'select auth\.')
--       OR (pg_get_expr(p.polwithcheck,p.polrelid) ~ 'auth\.(uid|role|jwt)\(\)'
--           AND pg_get_expr(p.polwithcheck,p.polrelid) !~ 'select auth\.');
--    -- 期待値 0 行（既 wrap 済の member_store_payrolls / shift_submission_deadlines /
--    --   store_members prev サブクエリは (select auth.uid()) なので除外される）
-- 4) INV-2 behavioral: owner/manager/アルバイト self/別 tenant/anon で
--    attendance_records / leave_requests / shifts / tasks / tenant_members の
--    SELECT 可視行数・INSERT/UPDATE 可否が適用前後一致（特に leave 自己承認封じ維持）。
