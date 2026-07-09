-- =====================================================================
-- 115_pay_read_leak_lockdown_v2.sql — 給与閲覧漏洩 3 経路封鎖 v2（FG4 再設計）
-- 設計正本: .company/engineering/docs/2026-07-09-kintai-fg4-redesign-115.md
-- 旧 112（security_invoker=true のまま列 REVOKE → VIEW 全損 FAIL・未適用）の再設計版。
-- 前提: 107（is_tenant_managerial=owner/admin/manager・role CHECK に admin）本番適用済。
--        109/110/111/113/114 本番適用済。112 は欠番（未適用）。
-- ★ このファイルに BEGIN/COMMIT/ROLLBACK を書かない（prod-gate.sh dry-run が
--    外側で BEGIN..ROLLBACK ラップ・apply は apply_migration が独自 tx で包む）。
-- ★ 冪等: CREATE OR REPLACE VIEW / DROP POLICY IF EXISTS→CREATE / REVOKE(no-op)。
-- =====================================================================
-- 目的（給与漏洩 3 経路封鎖 + definer 化に伴う書込穴封鎖）:
--   (A) tenant_members_visible を security_invoker=false（definer 化）へ CREATE OR REPLACE。
--       VIEW 内に明示テナントスコープ get_my_tenant_ids() を追加（caller RLS 継承を失う代償）。
--       CASE マスク（legal_name + pay4 列）は維持し、管理側判定を is_tenant_managerial（admin 含む）へ整合。
--   (B) 基底 tenant_members の pay4 列 SELECT GRANT を authenticated から REVOKE
--       → GET /tenant_members?select=user_id,hourly_rate の直読を封鎖。pay は VIEW 経由（CASE）のみ。
--   (C) member_store_payrolls_select / pri_select / pr_select を managerial（or 本人）へ絞る。
--   (D)【新規発見・必須】definer 化で auto-updatable になる VIEW の INSERT/UPDATE/DELETE を
--       authenticated+anon から REVOKE、anon の VIEW SELECT も REVOKE
--       （view owner=postgres 権限で基底 RLS を素通りする書込・削除穴を封鎖。frontend は VIEW 書込削除ゼロ。
--        DELETE は auto-deletable 判定に列マッピング不要のため INSERT/UPDATE と別枠で必ず塞ぐ）。
--
-- 書込側は不変（4 操作横串）:
--   ・基底 tenant_members: INSERT/UPDATE/DELETE policy と UPDATE 列 GRANT（082/113）は据え置き。
--   ・member_store_payrolls / payroll_run_items / payroll_runs: 書込系 policy（owner/manager・owner）不変。
--
-- 消費側 grep 証跡（frontend 変更不要・2026-07-09 再確認）:
--   ・基底 from('tenant_members') の SELECT は is_parttime（TenantContext:139）と
--     .delete()（退会 TenantContext:657）と .update(...).select('id')（useTenantAdmin 書込 RETURNING）のみ。
--     pay 列 SELECT はゼロ。
--   ・pay 列読取は全て tenant_members_visible 経由（useLeave:214/215 paid_leave_days・
--     useTenantAdmin:42/56・TenantContext:122/192/731・useUnsubmittedMembers:96）。
--   ・VIEW への INSERT/UPDATE 呼出はゼロ（書込は全て基底表直）→ (D) の REVOKE は非破壊。
-- ★ 本 migration は【本番未適用】。apply は秘書の本番ゲート（BEGIN..ROLLBACK probe 7 点 PASS）承認後。
-- =====================================================================

-- ---------------------------------------------------------------------
-- (A) tenant_members_visible を definer 化 + VIEW 内テナントスコープ + CASE マスク維持
--     security_invoker=false（definer 相当）: view owner(postgres) 権限で基底 pay 列を読む。
--     caller RLS を継承しなくなるため、WHERE で明示テナントスコープを担保する。
--     get_my_tenant_ids()（SECURITY DEFINER・soft-delete 済テナント除外）を再利用し
--       現行 SELECT policy "Members can view co-members"（099）とスコープ意味論を一致させる。
--     get_my_tenant_ids() 内 auth.uid() は request.jwt.claims->>'sub' を参照するため
--       definer VIEW から呼んでも呼出元セッションの JWT で解決される（所有者に固定化されない）。
--     CASE マスク: 本人 OR is_tenant_managerial(tm.tenant_id) → 実値, else NULL。
--       089 の owner/manager 相関 EXISTS を is_tenant_managerial（admin 含む）へ整合（現時点 admin=0 行で挙動不変）。
--     列の型・順序・名前は 089 と完全一致（CREATE OR REPLACE VIEW は変更不可・NULL::<型> でキャスト維持）。
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.tenant_members_visible
WITH (security_invoker = false) AS
  SELECT
    tm.id,
    tm.tenant_id,
    tm.user_id,
    tm.role,
    tm.display_name,
    CASE
      WHEN tm.user_id = auth.uid() THEN tm.legal_name
      WHEN public.is_tenant_managerial(tm.tenant_id) THEN tm.legal_name
      ELSE NULL::text
    END AS legal_name,
    tm.onboarded_at,
    CASE
      WHEN tm.user_id = auth.uid() THEN tm.hourly_rate
      WHEN public.is_tenant_managerial(tm.tenant_id) THEN tm.hourly_rate
      ELSE NULL::integer
    END AS hourly_rate,
    tm.night_shift_enabled,
    CASE
      WHEN tm.user_id = auth.uid() THEN tm.pay_type
      WHEN public.is_tenant_managerial(tm.tenant_id) THEN tm.pay_type
      ELSE NULL::text
    END AS pay_type,
    CASE
      WHEN tm.user_id = auth.uid() THEN tm.monthly_salary
      WHEN public.is_tenant_managerial(tm.tenant_id) THEN tm.monthly_salary
      ELSE NULL::integer
    END AS monthly_salary,
    CASE
      WHEN tm.user_id = auth.uid() THEN tm.paid_leave_days
      WHEN public.is_tenant_managerial(tm.tenant_id) THEN tm.paid_leave_days
      ELSE NULL::numeric(4,1)
    END AS paid_leave_days,
    tm.role_id,
    tm.created_at,
    tm.is_parttime
  FROM public.tenant_members tm
  WHERE tm.tenant_id IN (SELECT public.get_my_tenant_ids());

COMMENT ON VIEW public.tenant_members_visible IS
  'FG4 v2(115): definer 化(security_invoker=false)。VIEW 内で get_my_tenant_ids() により '
  'テナントスコープを担保し、legal_name/pay4 列は「本人 OR is_tenant_managerial(admin 含む)→値, '
  'else NULL」の CASE でマスク。基底 pay4 列 SELECT は REVOKE 済のため VIEW 経由のみ可視。';

-- ---------------------------------------------------------------------
-- (B) 基底 tenant_members の pay4 列 SELECT を authenticated から REVOKE
--     残す SELECT 列: id, tenant_id, user_id, role, display_name, night_shift_enabled,
--       role_id, created_at, onboarded_at, is_parttime, legal_name（legal_name は本バッチでは REVOKE しない）。
--     UPDATE 列 GRANT（082/113）は維持＝据え置き（本文は SELECT のみ REVOKE）。
--     冪等: 既に REVOKE 済でも REVOKE は no-op で成功。
-- ---------------------------------------------------------------------
REVOKE SELECT (hourly_rate, pay_type, monthly_salary, paid_leave_days)
  ON public.tenant_members FROM authenticated;

-- ---------------------------------------------------------------------
-- (C-1) member_store_payrolls SELECT を「managerial or 本人行」に絞る
--       before（065）: tenant 内全メンバー可視（tenant 全開） → after: 漏洩封鎖。
--       INSERT/UPDATE/DELETE（owner/manager）は不変。
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "member_store_payrolls_select" ON public.member_store_payrolls;
CREATE POLICY "member_store_payrolls_select" ON public.member_store_payrolls
  FOR SELECT
  TO authenticated
  USING (
    public.is_tenant_managerial(tenant_id)
    OR user_id = (SELECT auth.uid())
  );

-- ---------------------------------------------------------------------
-- (C-2) payroll_run_items SELECT を「managerial or 本人明細」に絞る
--       before（099）: run の tenant にメンバーであれば全開 → after: 自明細 or managerial のみ。
--       INSERT/DELETE（owner/mgr・owner 088）は不変。
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "pri_select" ON public.payroll_run_items;
CREATE POLICY "pri_select" ON public.payroll_run_items
  FOR SELECT
  TO authenticated
  USING (
    payroll_run_items.user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.payroll_runs r
      WHERE r.id = payroll_run_items.run_id
        AND public.is_tenant_managerial(r.tenant_id)
    )
  );

-- ---------------------------------------------------------------------
-- (C-3) payroll_runs SELECT を「managerial 限定」に絞る
--       total_payment（全社総支給）保護のため本人 run 自己参照は付けない
--       （staff 給与明細機能は不在・self 参照の機能需要ゼロ＝FG4 の意図的判断・タスク原文「or 本人」からの
--        理由付き乖離。将来 staff 明細を作る場合は pr_select を開けず self-scoped RPC を新設する）。
--       before（099）: tenant 全開 → after: managerial 限定。INSERT/DELETE（owner/mgr・owner）は不変。
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "pr_select" ON public.payroll_runs;
CREATE POLICY "pr_select" ON public.payroll_runs
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_managerial(tenant_id));

-- ---------------------------------------------------------------------
-- (D)【必須】definer 化で auto-updatable になる VIEW の書込穴を封鎖
--     definer VIEW は単一表 auto-updatable ビュー。VIEW への INSERT/UPDATE/DELETE GRANT が現存すると
--       view owner(postgres) 権限で基底 RLS を素通りして書込・削除可能になる privilege escalation 穴。
--     ★ DELETE も auto-updatable 判定（列マッピング不要・単一表 FROM であれば常に auto-deletable）で
--       definer 化後は基底 tenant_members_delete_self_non_owner（本人・非owner限定の自己退会のみ）を
--       完全にバイパスし、同一テナント内の任意メンバー（owner/manager 含む）を削除できてしまう
--       （member_permission_overrides / store_members が ON DELETE CASCADE で巻き添え削除される）。
--       敵対検証で本番実測（relacl: authenticated/anon とも DELETE 込みフル権限）により指摘・必須修正。
--     frontend は VIEW への書込・削除ゼロ（書込削除は全て基底表直・useTenantAdmin）→ REVOKE は非破壊。
--     anon の SELECT も落とす（definer VIEW 内 get_my_tenant_ids() が anon で 0 行だが多層防御）。
--     冪等: REVOKE は no-op で成功。
-- ---------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.tenant_members_visible FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, SELECT ON public.tenant_members_visible FROM anon;

-- ---------------------------------------------------------------------
-- PostgREST スキーマキャッシュ再読込（VIEW 定義/権限変更を即時反映）
--   VIEW security モデルと GRANT を変えたため schema cache reload を通知。
-- ---------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
