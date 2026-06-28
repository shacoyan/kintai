-- =====================================================================
-- 105_view_scopes_store_rls.sql
-- 権限管理UI化 Phase 1 — 勤怠/シフトの店舗スコープ RLS 強制エンジン + 設定置き場
-- 設計書: .company/engineering/docs/2026-06-29-kintai-permissions-phase1-store-scope-rls.md
-- Phase 0: can() 単一窓口 (commit cddb891) 完了済。
-- =====================================================================
-- 【何を】
--   attendance_records / shifts / shift_preferences の SELECT RLS を
--   「店舗スコープを DB で強制できる形」に書換える。同時に強制挙動を切替える
--   設定置き場テーブル tenant_view_scopes と、設定を読む SECURITY DEFINER
--   ヘルパ view_scope_for(tenant_id, role, domain) を新設する。
--
-- 【デフォルト挙動不変の宣言（最重要）】
--   全 active テナント × manager × 3 domain を scope='tenant' でシードし、
--   ヘルパの未設定既定も 'tenant'（fail-open=絞らない）。よって本 migration を
--   適用しても誰のアクセスも 1 ミリも変わらない（現行挙動を完全再現）。
--   Phase 2 の UI で scope を 'own_stores' に変えて初めて manager の閲覧が
--   所属店に絞られる。RLS で DB 強制＝UIだけの権限にしない。
--
-- 【スコープの鉄則】
--   1. デフォルト適用で挙動完全不変。  2. 権限を広げない（staff 漏れゼロ）。
--   3. SELECT のみ変更（INSERT/UPDATE/DELETE と既存ハードニング 086/087/100/101/102/103 は不変）。
--   4. owner は常に全店（設定に関わらずスコープ対象外）。
--
-- 【store_id 実態（実スキーマ確認済）】
--   attendance_records.store_id = NULLABLE (015: ON DELETE SET NULL)
--     → RLS 述語に store_id IS NULL OR is_my_store(store_id) を入れ、
--       store 無し勤怠は managerial に常に可視（締め出さない安全側）。
--   shifts.store_id / shift_preferences.store_id = NOT NULL (020)
--     → 防御的に同書式を統一（NULL 項は常に false で無害）。
--
-- 【SELECT のみ変更の根拠（4操作横串）】
--   本 migration は SELECT ポリシーのみ DROP/CREATE する。INSERT/UPDATE/DELETE
--   ポリシー及び BEFORE トリガ（086/100/102）は別 cmd・別レイヤのため非接触。
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 2. 設定置き場テーブル tenant_view_scopes（拡張可能）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_view_scopes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner','manager','staff')),
  domain      text NOT NULL CHECK (domain IN ('attendance','shift','shift_preference')),
  scope       text NOT NULL CHECK (scope IN ('tenant','own_stores')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, role, domain)
);

ALTER TABLE public.tenant_view_scopes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.tenant_view_scopes IS
  'Phase1 権限管理: テナント×role×domain の閲覧スコープ設定。scope=tenant(全店)/own_stores(所属店のみ)。owner は設定に関わらず常に全店。未設定は tenant（fail-open）。';

-- ---------------------------------------------------------------------
-- 3. tenant_view_scopes の RLS（4操作・Phase 2 を見据え厳格）
--    読み=managerial / 書込=owner 限定（Phase 2 の manager 権限昇格を先行封鎖）。
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "tvs_select" ON public.tenant_view_scopes;
CREATE POLICY "tvs_select" ON public.tenant_view_scopes
  FOR SELECT TO authenticated
  USING (
    (tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids))
    AND is_tenant_managerial(tenant_id)
  );

DROP POLICY IF EXISTS "tvs_insert" ON public.tenant_view_scopes;
CREATE POLICY "tvs_insert" ON public.tenant_view_scopes
  FOR INSERT TO authenticated
  WITH CHECK (is_tenant_owner(tenant_id));

DROP POLICY IF EXISTS "tvs_update" ON public.tenant_view_scopes;
CREATE POLICY "tvs_update" ON public.tenant_view_scopes
  FOR UPDATE TO authenticated
  USING (is_tenant_owner(tenant_id))
  WITH CHECK (is_tenant_owner(tenant_id));

DROP POLICY IF EXISTS "tvs_delete" ON public.tenant_view_scopes;
CREATE POLICY "tvs_delete" ON public.tenant_view_scopes
  FOR DELETE TO authenticated
  USING (is_tenant_owner(tenant_id));

-- ---------------------------------------------------------------------
-- 4. シード（現行再現・挙動不変の要）
--    全 active テナント × manager × 3 domain を scope='tenant' で投入。
--    owner 行はヘルパで即 'tenant' 返しのため不要。staff 行も Phase1 では
--    ヘルパが参照しないため不要（最小シード＝挙動不変）。冪等。
-- ---------------------------------------------------------------------
INSERT INTO public.tenant_view_scopes (tenant_id, role, domain, scope)
SELECT t.id, 'manager', d.domain, 'tenant'
FROM public.tenants t
CROSS JOIN (VALUES ('attendance'),('shift'),('shift_preference')) AS d(domain)
WHERE t.deleted_at IS NULL
ON CONFLICT (tenant_id, role, domain) DO NOTHING;

-- ---------------------------------------------------------------------
-- 5. ヘルパ view_scope_for（SECURITY DEFINER 4行テンプレ厳守・owner 特例 + 安全既定）
--    owner       → 常に 'tenant'（テーブル参照せず即返し。締め出し事故を構造的に防止）
--    それ以外    → tenant_view_scopes を引く。無ければ COALESCE で 'tenant'
--                  （シード漏れ・新規テナント・新規 domain いずれも「絞らない」に倒れる）。
--    STABLE/SECURITY DEFINER: RLS をすり抜けて確実に設定行を読む。
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.view_scope_for(
  p_tenant_id uuid,
  p_role      text,
  p_domain    text
) RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_role = 'owner' THEN 'tenant'
    ELSE COALESCE(
      (SELECT scope FROM public.tenant_view_scopes
        WHERE tenant_id = p_tenant_id
          AND role = p_role
          AND domain = p_domain
        LIMIT 1),
      'tenant')
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.view_scope_for(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.view_scope_for(uuid, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.view_scope_for(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. attendance_records SELECT 書換（self 不変・managerial のみ scope ゲート）
--    before(managerial): tenant_id IN (… role IN owner,manager …)
--    after : is_tenant_managerial(tenant_id)
--            AND ( is_tenant_owner(tenant_id)
--                  OR view_scope_for(...,'manager','attendance')='tenant'
--                  OR store_id IS NULL OR is_my_store(store_id) )
--    現行同値(scope='tenant'): view_scope_for='tenant' が TRUE 短絡 → is_tenant_managerial のみ
--      ≡ before の IN サブクエリ（058 helper 定義より論理等価・owner 含む）。
--    owner OR の意味: scope='own_stores'(Phase2) でも owner を述語側で無条件全件可視に
--      する（鉄則4）。デフォルト'tenant'下では view_scope_for='tenant' が既に TRUE のため
--      no-op で挙動完全不変。owner は元々全件可視なので追加 OR で権限は広がらない。
-- ---------------------------------------------------------------------

-- self 項は不変（参照のため明示再作成・099 と同形）
DROP POLICY IF EXISTS "Users view own records" ON public.attendance_records;
CREATE POLICY "Users view own records" ON public.attendance_records
  FOR SELECT TO authenticated
  USING (user_id = ( SELECT auth.uid() AS uid));

-- managerial 項を scope ゲートで書換
DROP POLICY IF EXISTS "Managers can view tenant records" ON public.attendance_records;
CREATE POLICY "Managers can view tenant records" ON public.attendance_records
  FOR SELECT TO authenticated
  USING (
    is_tenant_managerial(tenant_id)
    AND (
      is_tenant_owner(tenant_id)                              -- owner は設定に関わらず常に全店（鉄則4）
      OR view_scope_for(tenant_id, 'manager', 'attendance') = 'tenant'
      OR store_id IS NULL
      OR is_my_store(store_id)
    )
  );

-- ---------------------------------------------------------------------
-- 7. shift_preferences SELECT 書換（attendance と同型・store_id NOT NULL）
--    self: 不変 / managerial: scope ゲート
-- ---------------------------------------------------------------------

-- self 項は不変（099 と同形・明示再作成）
DROP POLICY IF EXISTS "shift_preferences_select_self" ON public.shift_preferences;
CREATE POLICY "shift_preferences_select_self" ON public.shift_preferences
  FOR SELECT TO authenticated
  USING (
    (user_id = ( SELECT auth.uid() AS uid))
    AND (tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids))
  );

-- managerial 項を scope ゲートで書換
DROP POLICY IF EXISTS "Managers can view all shift_preferences" ON public.shift_preferences;
CREATE POLICY "Managers can view all shift_preferences" ON public.shift_preferences
  FOR SELECT TO authenticated
  USING (
    is_tenant_managerial(tenant_id)
    AND (
      is_tenant_owner(tenant_id)                              -- owner は設定に関わらず常に全店（鉄則4）
      OR view_scope_for(tenant_id, 'manager', 'shift_preference') = 'tenant'
      OR store_id IS NULL
      OR is_my_store(store_id)
    )
  );

-- ---------------------------------------------------------------------
-- 8. shifts SELECT 書換 ⚠️ 最注意（単一 role 非依存 → 2ポリシー OR 合成）
--    before(単一): tenant_id IN get_my_tenant_ids()  ← staff 含む全員 tenant 全件
--    naive な self/managerial 分割は staff を絞る重大回帰になるため、
--    scope='tenant' 時に before と完全等価になる 2ポリシー OR 合成にする:
--      (1) shifts_select_tenant : scope='tenant' のとき従来どおり全員 tenant 全件
--      (2) shifts_select_scoped : 常時 OR で有効（own_stores 縮退先 + 本人は常に可視）
--    現行同値(scope='tenant'): (1)=tenant_id IN get_my_tenant_ids()=before、
--      (2) は (1) の部分集合 → OR 合成 = (1) = before。誰の可視行も不変。
--    own_stores 時(Phase2): (1)=owner なら is_tenant_owner OR で TRUE → owner は全件可視。
--      owner 以外は (1)=FALSE → (2) のみ = 本人のシフト OR 自店のシフト。
--      ※ shift だけ staff も自店に縮退する点は Phase2 設計の申し送り事項。
--    owner OR の意味: (1) shifts_select_tenant に is_tenant_owner OR を足すことで、
--      scope='own_stores' でも owner は (1) で全件 TRUE になり全店可視（鉄則4）。
--      デフォルト'tenant'下では view_scope_for='tenant' が既に TRUE で no-op。
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "shifts_select" ON public.shifts;

DROP POLICY IF EXISTS "shifts_select_tenant" ON public.shifts;
CREATE POLICY "shifts_select_tenant" ON public.shifts
  FOR SELECT TO authenticated
  USING (
    (tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids))
    AND (
      is_tenant_owner(tenant_id)                              -- owner は設定に関わらず常に全店（鉄則4）
      OR view_scope_for(tenant_id, 'manager', 'shift') = 'tenant'
    )
  );

DROP POLICY IF EXISTS "shifts_select_scoped" ON public.shifts;
CREATE POLICY "shifts_select_scoped" ON public.shifts
  FOR SELECT TO authenticated
  USING (
    (tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids))
    AND (
      (user_id = ( SELECT auth.uid() AS uid))            -- 本人のシフトは常に可視
      OR (store_id IS NULL OR is_my_store(store_id))     -- 自店のシフト（role 問わず）
    )
  );

COMMIT;

-- =====================================================================
-- ロールバック手順（参考・本番ゲート用。ポリシー復元を先・DROP は後追いで 42883 回避）
-- =====================================================================
-- BEGIN;
--   -- shifts: 2本 → 旧 単一に戻す
--   DROP POLICY IF EXISTS "shifts_select_scoped" ON public.shifts;
--   DROP POLICY IF EXISTS "shifts_select_tenant"  ON public.shifts;
--   CREATE POLICY "shifts_select" ON public.shifts FOR SELECT TO authenticated
--     USING (tenant_id IN ( SELECT get_my_tenant_ids() AS get_my_tenant_ids));
--   -- shift_preferences managerial 復元
--   DROP POLICY IF EXISTS "Managers can view all shift_preferences" ON public.shift_preferences;
--   CREATE POLICY "Managers can view all shift_preferences" ON public.shift_preferences
--     FOR SELECT TO authenticated
--     USING (tenant_id IN ( SELECT tenant_members.tenant_id FROM tenant_members
--       WHERE ((tenant_members.user_id = ( SELECT auth.uid() AS uid))
--         AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])))));
--   -- attendance managerial 復元
--   DROP POLICY IF EXISTS "Managers can view tenant records" ON public.attendance_records;
--   CREATE POLICY "Managers can view tenant records" ON public.attendance_records
--     FOR SELECT TO authenticated
--     USING (tenant_id IN ( SELECT tenant_members.tenant_id FROM tenant_members
--       WHERE ((tenant_members.user_id = ( SELECT auth.uid() AS uid))
--         AND (tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])))));
--   -- 関数・テーブルは後追い DROP（ポリシーが参照しなくなってから）
--   DROP FUNCTION IF EXISTS public.view_scope_for(uuid, text, text);
--   DROP TABLE IF EXISTS public.tenant_view_scopes;
-- COMMIT;
-- =====================================================================
