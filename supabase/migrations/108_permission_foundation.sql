-- =====================================================================
-- 108_permission_foundation.sql  — kintai 権限管理UI化 Phase3 P3-1（土台）
-- 設計正本: .company/engineering/docs/2026-07-01-kintai-permissions-p3-1-foundation.md
--           （案B・§1/§2/§4/§5・ADDENDUM§A1 admin/§A2 双方向/§A3 no-op/§A4 横串）
-- 前提: P3-0b（107・admin 役職土台）本番適用済・commit `9861bb2`。
-- =====================================================================
-- ★★★ no-op（挙動完全不変）の宣言 ★★★
--   ・本 migration は RLS/RPC/VIEW の【述語を1つも差し替えない】。
--     追加物 = 新テーブル4（うち tenant_view_scopes は列追加のみ）＋新関数3。
--   ・effective_scope / effective_bool / scope_rank は【どの RLS/RPC/VIEW からも
--     呼ばれない（未消費）】。関数は「作られるが呼ばれない」＝DB 実効挙動は完全不変。
--   ・member_permission_overrides は 0行（誰にも個人付与しない）。
--     tenant_view_scopes に admin プリセット行は seed しない（admin 該当0で無影響）。
--   ・role CHECK は 107 で4値化済のため本バッチで再張替しない。
--     domain/scope CHECK の実名は 105 のインライン無名（自動生成名）→ pg_constraint で
--     動的に特定して DROP（DO ブロック）。
--   ・105/106 後方互換維持: view_scope_for は旧 `scope` 列のみを読む（列追加は無影響）。
--     set_view_scope の upsert は value/kind 未指定でも CHECK を通る（kind IS NULL 分岐）。
--   ・is_tenant_owner(009) / is_tenant_managerial(107) / get_my_tenant_ids(009) 不変。
-- ★★★ 本 migration は【本番未適用】。適用は秘書の本番ゲート（BEGIN..ROLLBACK 検証）承認後。
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- (1) permission_domains — 権限ドメインの単一真実源（新規）
--     kind(scope系/bool系) と各 role の既定値（§5・§0.1 非単調性のデータ化）。
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permission_domains (
  domain          text PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('scope','bool')),
  floor_scope     text NULL     CHECK (floor_scope IN ('self','own_stores','tenant')),
  default_owner   text NOT NULL,
  default_admin   text NOT NULL,   -- ADDENDUM§A1.2（admin 列＝managerial 相当）
  default_manager text NOT NULL,
  default_staff   text NOT NULL,
  -- kind 整合: scope系は値が scope enum・bool系は 'true'/'false'（floor は scope系のみ）
  CONSTRAINT permission_domains_kind_value_check CHECK (
    (kind = 'scope' AND default_owner   IN ('self','own_stores','tenant')
                    AND default_admin   IN ('self','own_stores','tenant')
                    AND default_manager IN ('self','own_stores','tenant')
                    AND default_staff   IN ('self','own_stores','tenant'))
    OR
    (kind = 'bool'  AND default_owner   IN ('true','false')
                    AND default_admin   IN ('true','false')
                    AND default_manager IN ('true','false')
                    AND default_staff   IN ('true','false')
                    AND floor_scope IS NULL)
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.permission_domains ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.permission_domains IS
  'Phase3 権限管理: 権限ドメイン(項目)の単一真実源。kind=scope/bool・各 role 既定値・floor_scope(scope系のみ)。effective_* が解決の最終フォールバックに参照。挙動不変の要=シードは現行実効に bit 一致。';

-- SELECT: 全 authenticated（カタログ＝機微でない。既定値の閲覧は無害）。
-- 書込 policy 無し（seed は本 migration・以降の管理は owner RPC=P3-6 経由）。
DROP POLICY IF EXISTS pd_select ON public.permission_domains;
CREATE POLICY pd_select ON public.permission_domains
  FOR SELECT TO authenticated USING (true);

-- シード（§5 の表を厳密投入・§0.1 現行既定に bit 一致・ADDENDUM§A1.2 admin 列込み）。
-- 10 domain（8 消費予定 ＋ reports_profit/leave を P3-7/P3-8 用に先行定義）。冪等。
-- admin 列は全 domain で default_manager と同値（admin=managerial 相当・該当0で到達不能）。
INSERT INTO public.permission_domains
  (domain, kind, floor_scope, default_owner, default_admin, default_manager, default_staff)
VALUES
  -- scope系（★staff の非単調: attendance/shift_preference=self, shift=tenant, reports/tasks/projects=own_stores）
  ('attendance',       'scope', NULL,         'tenant', 'tenant', 'tenant', 'self'),
  ('shift_preference', 'scope', NULL,         'tenant', 'tenant', 'tenant', 'self'),
  ('shift',            'scope', NULL,         'tenant', 'tenant', 'tenant', 'tenant'),      -- ★staff も tenant（全件）
  ('reports',          'scope', 'own_stores', 'tenant', 'tenant', 'tenant', 'own_stores'),
  ('tasks',            'scope', 'own_stores', 'tenant', 'tenant', 'tenant', 'own_stores'),
  ('projects',         'scope', 'own_stores', 'tenant', 'tenant', 'tenant', 'own_stores'),
  -- bool系（staff=false＝self 相当・機微秘匿）
  ('pay',              'bool',  NULL,         'true',   'true',   'true',   'false'),
  ('legal_name',       'bool',  NULL,         'true',   'true',   'true',   'false'),
  ('reports_profit',   'bool',  NULL,         'true',   'true',   'true',   'false'),       -- 消費=P3-8
  ('leave',            'bool',  NULL,         'true',   'true',   'true',   'false')        -- 消費=P3-7
ON CONFLICT (domain) DO NOTHING;

-- ---------------------------------------------------------------------
-- (2) tenant_view_scopes の列追加による一般化（105 非破壊）
--     既存 UNIQUE(tenant_id,role,domain)・RLS4 policy・seed は保持。
-- ---------------------------------------------------------------------
ALTER TABLE public.tenant_view_scopes
  ADD COLUMN IF NOT EXISTS value text,
  ADD COLUMN IF NOT EXISTS kind  text;

-- domain / scope の CHECK は 105 のインライン無名（自動生成名）。実名を pg_constraint で
-- 動的に特定して DROP → named で 8値/self付き へ張替。role CHECK は 107 で named 化済＝触らない。
DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.tenant_view_scopes'::regclass
      AND contype  = 'c'
      AND conname <> 'tenant_view_scopes_role_check'  -- 107 の named role CHECK は保持
      AND (
        pg_get_constraintdef(oid) ILIKE '%domain%'
        OR pg_get_constraintdef(oid) ILIKE '%scope%'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.tenant_view_scopes DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$do$;

-- 冪等のため named 制約も一旦 DROP してから ADD（再適用時の重複回避）。
ALTER TABLE public.tenant_view_scopes
  DROP CONSTRAINT IF EXISTS tenant_view_scopes_domain_check;
ALTER TABLE public.tenant_view_scopes
  ADD CONSTRAINT tenant_view_scopes_domain_check
  CHECK (domain IN ('attendance','shift','shift_preference',
                    'reports','tasks','projects','pay','legal_name',
                    'reports_profit','leave'));

-- scope CHECK: 旧 {tenant,own_stores} → {self,own_stores,tenant}＋NULL 許容（bool系 domain は scope 未使用）。
ALTER TABLE public.tenant_view_scopes
  DROP CONSTRAINT IF EXISTS tenant_view_scopes_scope_check;
ALTER TABLE public.tenant_view_scopes
  ADD CONSTRAINT tenant_view_scopes_scope_check
  CHECK (scope IS NULL OR scope IN ('self','own_stores','tenant'));

-- value/kind の整合 CHECK（scope系は value=scope enum、bool系は value='true'/'false'）。
-- 既存行（105 seed）は kind IS NULL＝移行前として許容（下の同期 UPDATE で埋める）。
ALTER TABLE public.tenant_view_scopes
  DROP CONSTRAINT IF EXISTS tenant_view_scopes_value_kind_check;
ALTER TABLE public.tenant_view_scopes
  ADD CONSTRAINT tenant_view_scopes_value_kind_check
  CHECK (
    kind IS NULL
    OR (kind = 'scope' AND value IN ('self','own_stores','tenant'))
    OR (kind = 'bool'  AND value IN ('true','false'))
  );

-- 既存 seed 行（manager×3 view domain×tenant）の value/kind 同期（同一 migration 内・冪等）。
-- 旧 `scope` 列は移行期のみ二重持ち（view_scope_for が読む）。DROP は P3-8 完了後の別 migration。
UPDATE public.tenant_view_scopes
   SET value = scope, kind = 'scope'
 WHERE domain IN ('attendance','shift','shift_preference')
   AND kind IS NULL;

COMMENT ON COLUMN public.tenant_view_scopes.value IS
  'Phase3 一般化: role×domain プリセット値。kind=scope→self/own_stores/tenant, kind=bool→true/false。移行期は旧 scope 列と二重持ち（view_scope_for は旧 scope を読む）。';
COMMENT ON COLUMN public.tenant_view_scopes.kind IS
  'Phase3 一般化: value の種別。scope|bool。NULL=移行前の既存行（105 seed 同期後は scope）。';

-- ---------------------------------------------------------------------
-- (3) member_permission_overrides — 個人付与（新規・初期0行）
--     UNIQUE(tenant_id,member_id,domain)＝双方向1行格納（プリセットより広い/狭い両方）。
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.member_permission_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES public.tenant_members(id) ON DELETE CASCADE,
  domain      text NOT NULL REFERENCES public.permission_domains(domain),
  kind        text NOT NULL CHECK (kind IN ('scope','bool')),
  value       text NOT NULL,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_permission_overrides_kind_value_check CHECK (
    (kind = 'scope' AND value IN ('self','own_stores','tenant'))
    OR
    (kind = 'bool'  AND value IN ('true','false'))
  ),
  UNIQUE (tenant_id, member_id, domain)   -- 双方向: 広い/狭い両方の1行を格納可・索引も兼ねる
);

ALTER TABLE public.member_permission_overrides ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.member_permission_overrides IS
  'Phase3 権限管理: 個人付与（tenant×member×domain の 1 行）。解決順で役職プリセットより優先（双方向=広くも狭くもできる）。書込は RPC 一本化（P3-6・直書き policy 無し）。初期0行＝デフォルト不変。';

-- RLS: 読み=自 tenant の managerial のみ。書込 policy 無し（RPC 一本化＝P3-6・偽トグル防止）。
DROP POLICY IF EXISTS mpo_select ON public.member_permission_overrides;
CREATE POLICY mpo_select ON public.member_permission_overrides
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND is_tenant_managerial(tenant_id)
  );
-- INSERT/UPDATE/DELETE policy は張らない＝テーブル直書きを RLS で全拒否（RPC 経由のみ）。

-- tenant 一貫性トリガ（member_id.tenant_id == tenant_id 突合）。058 様式（ERRCODE='23514'）。
CREATE OR REPLACE FUNCTION public.member_permission_overrides_validate_refs()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_member_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_member_tenant
    FROM public.tenant_members WHERE id = NEW.member_id;
  IF v_member_tenant IS NULL THEN
    RAISE EXCEPTION 'member not found: %', NEW.member_id USING ERRCODE='23503';
  END IF;
  IF v_member_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'member.tenant_id mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mpo_validate_refs ON public.member_permission_overrides;
CREATE TRIGGER trg_mpo_validate_refs
  BEFORE INSERT OR UPDATE OF tenant_id, member_id
  ON public.member_permission_overrides
  FOR EACH ROW EXECUTE FUNCTION public.member_permission_overrides_validate_refs();

-- ---------------------------------------------------------------------
-- (4) permission_change_log — 監査（新規・器のみ・0行）
--     追記経路（RPC）は P3-6。本バッチでは書込 policy 無し＝常に0行。
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permission_change_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_uid         uuid,
  target_scope      text NOT NULL CHECK (target_scope IN ('role','member')),
  role_or_member_id text,          -- role名 or member_id（text で両対応）
  domain            text NOT NULL,
  old_value         text,
  new_value         text,
  changed_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.permission_change_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.permission_change_log IS
  'Phase3 権限管理: 権限変更の監査ログ（器）。追記は書込 RPC=P3-6 の SECURITY DEFINER 内から。本バッチは 0行。';

DROP POLICY IF EXISTS pcl_select ON public.permission_change_log;
CREATE POLICY pcl_select ON public.permission_change_log
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND is_tenant_managerial(tenant_id)
  );
-- 書込 policy 無し（追記は P3-6 の RPC 経由）。

-- ---------------------------------------------------------------------
-- (5) 解決ヘルパ scope_rank / effective_scope / effective_bool（新規・4行テンプレ）
--     ★RLS に組み込まない＝未消費。P3-2 以降が initplan wrap `(SELECT effective_scope(...))` で消費。
--     解決順（ADDENDUM§A2.2・双方向・floor は scope系のみ維持）:
--       member 無し→安全側最下位 → owner 即返し（admin 含めず）
--       → 個人付与 → 役職プリセット → default_{role} → floor クランプ（scope系のみ）
-- ---------------------------------------------------------------------

-- scope の順序（数値化・immutable）。self(0) < own_stores(1) < tenant(2)。
CREATE OR REPLACE FUNCTION public.scope_rank(p_scope text)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_scope
    WHEN 'self'       THEN 0
    WHEN 'own_stores' THEN 1
    WHEN 'tenant'     THEN 2
    ELSE 0
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.scope_rank(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.scope_rank(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.scope_rank(text) TO authenticated;

-- effective_scope（scope系）: 解決 → floor クランプ（scope系のみ）。owner は tenant 即返し。
CREATE OR REPLACE FUNCTION public.effective_scope(p_tenant_id uuid, p_domain text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT id AS member_id, role
    FROM public.tenant_members
    WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
    LIMIT 1
  ),
  dom AS (
    SELECT default_owner, default_admin, default_manager, default_staff, floor_scope, kind
    FROM public.permission_domains WHERE domain = p_domain
  ),
  resolved AS (
    SELECT CASE
      -- 当該 tenant 未所属 → 最下位 self（安全側）
      WHEN (SELECT member_id FROM me) IS NULL THEN 'self'
      -- owner 即返し（テーブル未参照・下限保証。admin は即返しに含めない）
      WHEN (SELECT role FROM me) = 'owner' THEN 'tenant'
      ELSE COALESCE(
        -- 個人付与（狭い値でも採用＝双方向）
        (SELECT o.value FROM public.member_permission_overrides o
           WHERE o.tenant_id = p_tenant_id
             AND o.member_id = (SELECT member_id FROM me)
             AND o.domain = p_domain LIMIT 1),
        -- 役職プリセット
        (SELECT v.value FROM public.tenant_view_scopes v
           WHERE v.tenant_id = p_tenant_id
             AND v.role = (SELECT role FROM me)
             AND v.domain = p_domain LIMIT 1),
        -- 既定（default_{role}）
        (SELECT CASE (SELECT role FROM me)
                  WHEN 'admin'   THEN (SELECT default_admin   FROM dom)
                  WHEN 'manager' THEN (SELECT default_manager FROM dom)
                  ELSE               (SELECT default_staff   FROM dom)
                END)
      )
    END AS v
  )
  -- floor クランプ（scope系のみ・floor 未満のみ引き上げ）。プリセットへのクランプはしない。
  SELECT CASE
    WHEN (SELECT floor_scope FROM dom) IS NULL THEN (SELECT v FROM resolved)
    WHEN public.scope_rank((SELECT v FROM resolved))
         >= public.scope_rank((SELECT floor_scope FROM dom))
         THEN (SELECT v FROM resolved)
    ELSE (SELECT floor_scope FROM dom)
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.effective_scope(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.effective_scope(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.effective_scope(uuid, text) TO authenticated;

-- effective_bool（機微bool系・floor 無し・owner→true）。
CREATE OR REPLACE FUNCTION public.effective_bool(p_tenant_id uuid, p_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT id AS member_id, role FROM public.tenant_members
    WHERE tenant_id = p_tenant_id AND user_id = auth.uid() LIMIT 1
  ),
  dom AS (
    SELECT default_owner, default_admin, default_manager, default_staff
    FROM public.permission_domains WHERE domain = p_key AND kind = 'bool'
  )
  SELECT CASE
    WHEN (SELECT member_id FROM me) IS NULL THEN false
    WHEN (SELECT role FROM me) = 'owner' THEN true
    ELSE COALESCE(
      (SELECT (o.value = 'true') FROM public.member_permission_overrides o
         WHERE o.tenant_id = p_tenant_id AND o.member_id = (SELECT member_id FROM me)
           AND o.domain = p_key LIMIT 1),
      (SELECT (v.value = 'true') FROM public.tenant_view_scopes v
         WHERE v.tenant_id = p_tenant_id AND v.role = (SELECT role FROM me)
           AND v.domain = p_key LIMIT 1),
      (SELECT CASE (SELECT role FROM me)
                WHEN 'admin'   THEN (SELECT default_admin   FROM dom)
                WHEN 'manager' THEN (SELECT default_manager FROM dom)
                ELSE               (SELECT default_staff   FROM dom)
              END = 'true')
    )
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.effective_bool(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.effective_bool(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.effective_bool(uuid, text) TO authenticated;

COMMIT;

-- =====================================================================
-- 本番ゲート検証SQL（秘書実施・BEGIN..ROLLBACK・READ-ONLY／書込は ROLLBACK のみ）
-- ---------------------------------------------------------------------
-- 全て kintai prod（zjjbfffhbobwwxyvdszl・list_projects で name=kintai 突合してから）。
--
-- 7-0. 事前突合:
--   list_projects → name=kintai / id=zjjbfffhbobwwxyvdszl 目視（receipt-scanner と誤爆しない）。
--   SELECT role, count(*) FROM tenant_members GROUP BY role;  → admin=0 を確認・内訳 baseline。
--   SELECT count(*) FROM tenant_view_scopes WHERE role='admin';  → 0。
--   advisor(security/performance) baseline 取得（適用後の非増悪比較）。
--
-- 7-1. effective_* が §5 既定を返す（override空・全 role×全 domain）:
--   BEGIN; <108 適用>; -- ROLLBACK 内で admin は仮メンバー INSERT して模擬。
--   各 role の auth.uid() を SET LOCAL request.jwt.claims で模擬し:
--     scope系: SELECT public.effective_scope(:tenant,:domain);
--       owner=tenant / admin=tenant / manager=tenant（全 scope domain）
--       staff: attendance=self, shift_preference=self, shift=tenant(★非単調),
--              reports=own_stores, tasks=own_stores, projects=own_stores
--     bool系: SELECT public.effective_bool(:tenant,:key);
--       owner/admin/manager=true / staff=false（pay/legal_name/reports_profit/leave）
--   ROLLBACK;
--
-- 7-2. 3 view domain は effective 実効==現行実効:
--   attendance/shift/shift_preference。staff の shift は effective=tenant==view_scope_for('manager','shift')=tenant。
--   staff の attendance は effective=self（現行 self 実効と一致・view_scope_for は manager 用ヘルパ）。
--
-- 7-3. overrides/change_log/admin preset は 0行:
--   SELECT count(*) FROM public.member_permission_overrides;  → 0
--   SELECT count(*) FROM public.permission_change_log;        → 0
--   SELECT count(*) FROM public.tenant_view_scopes WHERE role='admin';  → 0
--
-- 7-4. RLS 未差替＝各ドメイン可視 rowset の bit 一致（同一 ROLLBACK 内 before→apply→after）:
--   owner/manager/staff 各1名の SET LOCAL request.jwt.claims で count＋id 集合が完全一致:
--     attendance_records / shifts(staff=tenant 全件) / daily_reports / tasks / projects
--     / tenant_members_visible(pay4列+legal_name の NULL パターン) / leave_requests
--
-- 7-5. 後方互換＝set_view_scope/view_scope_for 従来通り（BEGIN..ROLLBACK）:
--   SELECT public.set_view_scope(:tenant,'attendance','own_stores');  → 成功（value/kind 未指定でも CHECK 通過）
--   SELECT public.view_scope_for(:tenant,'manager','attendance');     → 'own_stores'
--   SELECT public.set_view_scope(:tenant,'attendance','tenant');      → 成功（戻し）
--   ROLLBACK;
--
-- 7-6. フロント behavior-neutral（Engineer B）: git diff で can.ts export＋TenantContext:335/:400 のみ。
--   tsc0 / build / vitest(can.test 全 role×capability) / eslint(rules-of-hooks) green。
--
-- 7-7. 適用と事後: ROLLBACK 全 PASS → apply(COMMIT) → 再検証(7-1/7-3/7-4 代表)
--   → advisor 非増悪（書込 policy 無しテーブル3つの「RLS 有効だが policy 無し」INFO は意図的）
--   → pg_proc.proacl で effective_scope/effective_bool/scope_rank の anon 除外証跡（=X/postgres に anon 無し）
--   → dual push（newWorld + kintai/main）。
-- =====================================================================

-- =====================================================================
-- ロールバック手順（参考・実行しない）— admin 該当0・ヘルパ未消費で完全 no-op。
--   DB を先に戻し、その後フロントを git revert。
--   1. DROP FUNCTION IF EXISTS public.effective_scope(uuid,text);
--      DROP FUNCTION IF EXISTS public.effective_bool(uuid,text);
--      DROP FUNCTION IF EXISTS public.scope_rank(text);            -- 未消費のため依存なし
--   2. DROP TABLE IF EXISTS public.permission_change_log;
--      DROP TABLE IF EXISTS public.member_permission_overrides;    -- 0行・FK 先なし
--   3. tenant_view_scopes: 追加列を戻す
--      ALTER TABLE public.tenant_view_scopes DROP COLUMN IF EXISTS value, DROP COLUMN IF EXISTS kind;
--      ＋ domain/scope CHECK を 105 相当（3値 / {own_stores,tenant}）へ張替（105 seed 以外の行が無いこと確認）。
--      role CHECK は 107 のまま（触らない）。★テーブル自体は 105/106 稼働中ゆえ DROP しない。
--   4. DROP TABLE IF EXISTS public.permission_domains;             -- 最後・他が参照しなくなってから
--   5. フロント: can.ts の isManagerial export 除去・TenantContext の2箇所を元式へ git revert。
-- =====================================================================
