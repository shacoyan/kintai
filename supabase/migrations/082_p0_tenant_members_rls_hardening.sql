-- Migration 082: tenant_members RLS 権限昇格 修正（#1 INSERT / #2 UPDATE）
--
-- 背景:
--   #1 本番に残る "Users can insert own membership" は WITH CHECK が
--      user_id = auth.uid() のみで role/tenant_id 無制約 → 任意ユーザーが
--      他テナントに role='owner' を直 INSERT して招待検証をバイパス可能。
--      009_security_fixes のハードニング版が本番から消失＝回帰。
--   #2 062 の "tenant_members_managerial_update" は USING/WITH CHECK とも
--      is_tenant_managerial() のみ → manager が自分の行を role='owner' に
--      自己昇格できる。複数 owner 禁止制約も無い。
--
-- 設計方針（非破壊）:
--   - staff 参加は join_tenant_with_invite_v2/v3（全て SECURITY DEFINER）
--     経由で RLS をバイパスして INSERT する。よって staff の table 直 INSERT
--     policy は復活させない（招待検証バイパスの別穴になるため）。
--   - createTenant(src/contexts/TenantContext.tsx) の「owner 自己 INSERT」は
--     許可し続ける: user_id=auth.uid() かつ role='owner' かつ
--     tenants.owner_id=auth.uid()。
--   - owner への昇格 / owner 行の改変は transfer_tenant_ownership
--     （SECURITY DEFINER）が唯一の正規経路 → direct UPDATE からは全面禁止。
--   - staff <-> manager の正規ロール変更と、本人/管理者による非ロール列の更新は維持。
--   - P1 対策として identity 列(user_id/tenant_id/id/created_at)の列権限ガードを併設
--     （RLS だけでは NEW.user_id 差し替え=招待迂回の UPDATE 経路を防げないため）。
--
-- 前提（実測済 2026-06-14）:
--   - join_tenant_with_invite_v3/v2 = SECURITY DEFINER（v1 は本番不在）
--   - transfer_tenant_ownership = SECURITY DEFINER
--   - is_tenant_owner / is_tenant_managerial / get_my_tenant_ids = SECURITY DEFINER STABLE
--   - tenants.owner_id 列が存在
--
-- Depends:
--   - 008/009 (is_tenant_owner, owner_can_update_tenant_members)
--   - 058 (is_tenant_managerial)
--   - 062 (tenant_members_managerial_update ← 本 migration で置換)
--
-- Rollback / 検証SQL: 本ファイル末尾のコメントブロックを参照。

BEGIN;

-- =========================================================================
-- #1 INSERT 権限昇格の修正
-- =========================================================================

-- 緩い INSERT policy を撤去（回帰している脆弱 policy）
DROP POLICY IF EXISTS "Users can insert own membership" ON public.tenant_members;
-- 念のため、過去バージョンの名残も掃除（idempotent / 存在しなくても無害）
DROP POLICY IF EXISTS "Users can insert own membership as staff" ON public.tenant_members;
DROP POLICY IF EXISTS "Owner can insert own membership" ON public.tenant_members;
DROP POLICY IF EXISTS "tenant_members_insert_self_owner" ON public.tenant_members;

-- owner 自己 INSERT のみ許可:
--   ・user_id が自分
--   ・role は 'owner'（staff/manager の直 INSERT は不可。staff は join RPC 経由）
--   ・対象 tenant の owner_id が自分（= 自分が作成した自テナント）
-- → createTenant の直後 INSERT を許可。他テナントへの owner 自己 INSERT は
--   tenants.owner_id 照合で弾かれる。
CREATE POLICY "tenant_members_insert_self_owner"
  ON public.tenant_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.tenants t
      WHERE t.id = tenant_members.tenant_id
        AND t.owner_id = auth.uid()
    )
  );

COMMENT ON POLICY "tenant_members_insert_self_owner" ON public.tenant_members IS
  '#1 fix: createTenant の owner 自己 INSERT のみ許可（自テナント・role=owner 限定）。'
  'staff 参加は join_tenant_with_invite_v* (SECURITY DEFINER) 経由で RLS バイパス。';

-- anon は tenant_members を INSERT する正規経路が無い（staff 参加は join RPC=DEFINER、
-- owner 作成は authenticated の createTenant）。anon の INSERT 列権限は残骸のため剥奪。
-- INSERT policy が TO authenticated のため anon は既に RLS で全拒否されるが、列権限も外して多層化。
REVOKE INSERT ON public.tenant_members FROM anon;

-- =========================================================================
-- #2 UPDATE 権限昇格の修正
-- =========================================================================

-- 脆弱な managerial UPDATE policy を撤去（062 由来）
DROP POLICY IF EXISTS "tenant_members_managerial_update" ON public.tenant_members;
-- owner 用 UPDATE policy も置換する（owner が他人を owner に昇格 / owner 行を直で
-- 書き換える経路を direct UPDATE から閉じ、owner 変更は transfer RPC に一本化）
DROP POLICY IF EXISTS "owner_can_update_tenant_members" ON public.tenant_members;
DROP POLICY IF EXISTS "tenant_members_update_non_owner" ON public.tenant_members;

-- 新 UPDATE policy（owner / manager 共通・列ガード入り）:
--   USING   … 改変対象の「既存(OLD)行」が owner でないこと（owner 行は direct UPDATE 不可）
--             かつ 呼び出し元が当該 tenant の owner/manager であること
--   WITHCHECK… 更新後(NEW)行の role が 'owner' でないこと（owner への昇格を全面禁止）
--             かつ tenant_id を別テナントへ書き換えていないこと（is_tenant_managerial(NEW.tenant_id) で担保）
-- ※ Postgres RLS: UPDATE の USING は OLD 行、WITH CHECK は NEW 行を参照する。
--   owner への昇格・降格・owner 同士の付け替えは transfer_tenant_ownership
--   （SECURITY DEFINER）経由のみ通る。staff<->manager 変更と非ロール列更新は通る。
CREATE POLICY "tenant_members_update_non_owner"
  ON public.tenant_members
  FOR UPDATE
  TO authenticated
  USING (
    role <> 'owner'                       -- OLD 行: owner 行は direct UPDATE 不可
    AND is_tenant_managerial(tenant_id)   -- 呼び出し元が当該 tenant の owner/manager
  )
  WITH CHECK (
    role <> 'owner'                       -- NEW 行: owner への昇格を禁止
    AND is_tenant_managerial(tenant_id)   -- NEW.tenant_id も owner/manager のテナントに限定（別 tenant への移送防止）
  );

COMMENT ON POLICY "tenant_members_update_non_owner" ON public.tenant_members IS
  '#2 fix: owner/manager は非 owner 行のみ direct UPDATE 可。OLD/NEW とも role=owner を禁止し '
  'owner 昇格・owner 行改変・別テナント移送を阻止。owner 変更は transfer_tenant_ownership(DEFINER)経由のみ。';

-- 列権限ガード: identity 列(user_id/tenant_id/id/created_at)を direct UPDATE から固定。
-- RLS policy だけでは NEW.user_id / NEW.tenant_id の改変を防げない（manager が自テナント
-- staff 行の user_id を任意ユーザーへ差し替え→招待検証を UPDATE 経路でバイパス可能、実証済=P1）。
-- フロント(useTenantAdmin.ts)が直 UPDATE する列のみ許可し、identity 列は除外する。
-- display_name/legal_name/onboarded_at は complete_onboarding(SECURITY DEFINER)経由で更新するため
-- direct UPDATE 権限は不要だが、owner 自身の表示名直編集 UI を将来足す保険として許可に含める。
REVOKE UPDATE ON public.tenant_members FROM authenticated;
REVOKE UPDATE ON public.tenant_members FROM anon;
GRANT UPDATE (
  role, hourly_rate, pay_type, monthly_salary, paid_leave_days,
  night_shift_enabled, is_parttime, role_id, display_name, legal_name, onboarded_at
) ON public.tenant_members TO authenticated;

COMMIT;

-- =========================================================================
-- ROLLBACK SQL（082 を 082 適用前の脆弱版へ正確復元する。手動実行）
-- =========================================================================
-- BEGIN;
--
-- -- #1 INSERT: 082 の owner 限定 policy を撤去し、元の緩い policy を復元
-- DROP POLICY IF EXISTS "tenant_members_insert_self_owner" ON public.tenant_members;
-- CREATE POLICY "Users can insert own membership"
--   ON public.tenant_members
--   FOR INSERT
--   TO public
--   WITH CHECK (user_id = auth.uid());
--
-- -- #2 UPDATE: 082 の non_owner policy を撤去し、元の2 policy を復元
-- DROP POLICY IF EXISTS "tenant_members_update_non_owner" ON public.tenant_members;
--
-- CREATE POLICY "owner_can_update_tenant_members"
--   ON public.tenant_members
--   FOR UPDATE
--   TO public
--   USING (
--     (tenant_id IN (SELECT get_my_tenant_ids())) AND is_tenant_owner(tenant_id)
--   )
--   WITH CHECK (
--     (tenant_id IN (SELECT get_my_tenant_ids())) AND is_tenant_owner(tenant_id)
--   );
--
-- CREATE POLICY "tenant_members_managerial_update"
--   ON public.tenant_members
--   FOR UPDATE
--   TO authenticated
--   USING (is_tenant_managerial(tenant_id))
--   WITH CHECK (is_tenant_managerial(tenant_id));
--
-- -- 列権限ガードの復元（082適用前=全列 UPDATE/INSERT 可 の状態へ戻す）
-- -- 082適用前は authenticated/anon とも tenant_members 全列の INSERT/UPDATE 権限を保持していた。
-- -- GRANT ALL ではなく元の全列 GRANT を復元する。※緊急時のみ使用。
-- GRANT UPDATE ON public.tenant_members TO authenticated;
-- GRANT UPDATE ON public.tenant_members TO anon;
-- GRANT INSERT ON public.tenant_members TO anon;
--
-- COMMIT;

-- =========================================================================
-- 適用後 検証 SQL（本番で実行・全件 PASS が承認条件。BEGIN..ROLLBACK で無汚染）
-- =========================================================================
-- -- 事前: 検証用サンプル取得（read-only）
-- -- SELECT t.id AS tenant_id, t.owner_id,
-- --        (SELECT user_id FROM tenant_members WHERE tenant_id=t.id AND role='owner'   LIMIT 1) AS owner_uid,
-- --        (SELECT user_id FROM tenant_members WHERE tenant_id=t.id AND role='manager' LIMIT 1) AS manager_uid,
-- --        (SELECT user_id FROM tenant_members WHERE tenant_id=t.id AND role='staff'   LIMIT 1) AS staff_uid
-- -- FROM tenants t WHERE t.deleted_at IS NULL ORDER BY t.created_at LIMIT 5;
--
-- -- 6-0. policy が想定どおり置き換わったか（read-only）
-- -- SELECT policyname, cmd, roles, qual, with_check
-- -- FROM pg_policies WHERE tablename='tenant_members' ORDER BY cmd, policyname;
-- -- 期待: INSERT=tenant_members_insert_self_owner のみ /
-- --       UPDATE=tenant_members_update_non_owner のみ /
-- --       SELECT=Members can view co-members・DELETE=tenant_members_delete_self_non_owner は不変
--
-- -- 6-1(a) 自テナント owner 自己 INSERT は通る（createTenant 相当 / PASS=成功）
-- -- BEGIN;
-- --   SELECT set_config('role','authenticated', true);
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<TEST_USER_UID>','role','authenticated')::text, true);
-- --   INSERT INTO public.tenants (id,name,owner_id) VALUES ('00000000-0000-0000-0000-0000000000aa','__rls_test_tenant','<TEST_USER_UID>');
-- --   INSERT INTO public.tenant_members (tenant_id,user_id,role,display_name) VALUES ('00000000-0000-0000-0000-0000000000aa','<TEST_USER_UID>','owner','rls_test');
-- -- ROLLBACK;
-- -- 6-1(b) 他テナント（owner_id 他人）への owner 自己 INSERT は弾かれる（PASS=RLS violation）
-- -- BEGIN;
-- --   SELECT set_config('role','authenticated', true);
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<TEST_USER_UID>','role','authenticated')::text, true);
-- --   INSERT INTO public.tenant_members (tenant_id,user_id,role,display_name) VALUES ('<OTHER_TENANT_ID>','<TEST_USER_UID>','owner','rls_test');
-- -- ROLLBACK;
-- -- 6-1(c) 自テナントでも role='staff' の直 INSERT は弾かれる（PASS=RLS violation）
-- -- BEGIN;
-- --   SELECT set_config('role','authenticated', true);
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<TEST_USER_UID>','role','authenticated')::text, true);
-- --   INSERT INTO public.tenants (id,name,owner_id) VALUES ('00000000-0000-0000-0000-0000000000ab','__rls_test_tenant2','<TEST_USER_UID>');
-- --   INSERT INTO public.tenant_members (tenant_id,user_id,role,display_name) VALUES ('00000000-0000-0000-0000-0000000000ab','<TEST_USER_UID>','staff','rls_test');
-- -- ROLLBACK;
--
-- -- 6-2(a) manager の role='owner' 自己昇格 → 弾かれる（PASS=0行 or RLS violation）
-- -- BEGIN;
-- --   SELECT set_config('role','authenticated', true);
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<MANAGER_UID>','role','authenticated')::text, true);
-- --   UPDATE public.tenant_members SET role='owner' WHERE tenant_id='<TENANT_ID>' AND user_id='<MANAGER_UID>';
-- -- ROLLBACK;
-- -- 6-2(b) manager が owner 行を staff に降格 → 弾かれる（PASS=0行）
-- -- BEGIN;
-- --   SELECT set_config('role','authenticated', true);
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<MANAGER_UID>','role','authenticated')::text, true);
-- --   UPDATE public.tenant_members SET role='staff' WHERE tenant_id='<TENANT_ID>' AND user_id='<OWNER_UID>';
-- -- ROLLBACK;
-- -- 6-2(c) manager が staff を owner に昇格 → 弾かれる（PASS=WITH CHECK 違反 ERROR）
-- -- BEGIN;
-- --   SELECT set_config('role','authenticated', true);
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<MANAGER_UID>','role','authenticated')::text, true);
-- --   UPDATE public.tenant_members SET role='owner' WHERE tenant_id='<TENANT_ID>' AND user_id='<STAFF_UID>';
-- -- ROLLBACK;
--
-- -- 6-3(a) manager が staff を manager に昇格 → 通る（PASS=1行）
-- -- BEGIN;
-- --   SELECT set_config('role','authenticated', true);
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<MANAGER_UID>','role','authenticated')::text, true);
-- --   UPDATE public.tenant_members SET role='manager' WHERE tenant_id='<TENANT_ID>' AND user_id='<STAFF_UID>';
-- -- ROLLBACK;
-- -- 6-3(b) manager が manager を staff に降格 → 通る（PASS=1行）
-- -- BEGIN;
-- --   SELECT set_config('role','authenticated', true);
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<MANAGER_UID>','role','authenticated')::text, true);
-- --   UPDATE public.tenant_members SET role='staff' WHERE tenant_id='<TENANT_ID>' AND user_id='<OTHER_MANAGER_UID>';
-- -- ROLLBACK;
-- -- 6-3(c) 非ロール列（display_name 等）の更新は通る（PASS=1行）
-- -- BEGIN;
-- --   SELECT set_config('role','authenticated', true);
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<MANAGER_UID>','role','authenticated')::text, true);
-- --   UPDATE public.tenant_members SET display_name = display_name WHERE tenant_id='<TENANT_ID>' AND user_id='<STAFF_UID>';
-- -- ROLLBACK;
--
-- -- 6-X(a) manager が staff 行の user_id を外部ユーザーへ差し替え → 弾かれる（PASS=permission denied 列権限）
-- -- BEGIN;
-- --   SELECT set_config('role','authenticated', true);
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<MANAGER_UID>','role','authenticated')::text, true);
-- --   UPDATE public.tenant_members SET user_id='<OUTSIDE_UID>' WHERE tenant_id='<TENANT_ID>' AND user_id='<STAFF_UID>';
-- -- ROLLBACK;
-- -- 6-X(b) manager が staff 行の tenant_id を別テナントへ書き換え → 弾かれる（PASS=permission denied 列権限）
-- -- BEGIN;
-- --   SELECT set_config('role','authenticated', true);
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<MANAGER_UID>','role','authenticated')::text, true);
-- --   UPDATE public.tenant_members SET tenant_id='<OTHER_TENANT_ID>' WHERE tenant_id='<TENANT_ID>' AND user_id='<STAFF_UID>';
-- -- ROLLBACK;
-- -- 6-X(c) manager が staff 行の hourly_rate を UPDATE → 通る（PASS=1行・正規/非破壊）
-- -- BEGIN;
-- --   SELECT set_config('role','authenticated', true);
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<MANAGER_UID>','role','authenticated')::text, true);
-- --   UPDATE public.tenant_members SET hourly_rate=hourly_rate WHERE tenant_id='<TENANT_ID>' AND user_id='<STAFF_UID>';
-- -- ROLLBACK;
--
-- -- 6-4. transfer_tenant_ownership（DEFINER）経由の owner 変更は通る（PASS=エラーなく旧owner→manager / 新owner=owner）
-- -- BEGIN;
-- --   SELECT set_config('role','authenticated', true);
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<OWNER_UID>','role','authenticated')::text, true);
-- --   SELECT public.transfer_tenant_ownership('<TENANT_ID>','<MANAGER_UID>');
-- --   SELECT user_id, role FROM public.tenant_members WHERE tenant_id='<TENANT_ID>' AND user_id IN ('<OWNER_UID>','<MANAGER_UID>');
-- -- ROLLBACK;
--
-- -- 注: owner 自身の display_name 等 direct UPDATE 経路が UI に存在する場合、
-- --     USING role<>'owner' で弾かれる。6-3(c) を <OWNER_UID> でも実行し、
-- --     必要なら §6-5 補助 policy の要否を Tech Lead にエスカレーション（独断追加しない）。
