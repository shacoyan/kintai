-- Migration 094: create_tenant 原子化 RPC（P2/P3 B2）
--
-- 背景（実測 2026-06-15・TenantContext.tsx:257-292）:
--   createTenant は (1) tenants INSERT → (2) tenant_members INSERT(role='owner') の
--   2 段 DML をフロントから別々に発行している（item: create-tenant-non-atomic）。
--   (1) 成功後 (2) が失敗（ネットワーク断/RLS/一意制約）すると、オーナー不在の
--   孤立テナント行が残る。フロント catch はエラー表示するだけでロールバックしない。
--
-- 設計方針:
--   create_tenant(p_name text, p_display_name text) SECURITY DEFINER RPC を新設し、
--   tenants INSERT → tenant_members INSERT を 1 つの関数本体（=1トランザクション）で実行。
--   plpgsql 関数内で例外が起きれば関数全体が自動ロールバックし、孤立テナントは残らない。
--   - owner_id / tenant_members.user_id は auth.uid() をサーバ側で固定（フロント詐称不可）。
--   - invite_code はサーバ側で 6 桁英大字を生成し一意衝突時はリトライ（最大8回）。
--     （tenants.invite_code は NOT NULL かつ UNIQUE 想定。フロントの generateUniqueInviteCode
--      と同じ 6 桁方式だが、生成〜INSERT を原子化して TOCTOU 競合も縮小。）
--   - 戻り値は SETOF public.tenants（挿入された tenant 行全体）。フロントは .single() で
--     Tenant 型（invite_code 含む）を受け取り、CreateTenant.tsx の invite_code 表示に使う。
--   - MEMORY RLS 4 行テンプレ: SET search_path=public,pg_temp / REVOKE FROM PUBLIC /
--     REVOKE FROM anon / GRANT TO authenticated。
--
-- 横串確認:
--   既存 RLS は変更しない。SECURITY DEFINER により RLS をバイパスして 2 表へ INSERT するが、
--   owner_id=auth.uid() 固定 + 未認証は冒頭で弾くため、認可境界は維持（自分が owner の
--   テナントしか作れない）。
--
-- Rollback / 検証 SQL: 本ファイル末尾コメント参照。

BEGIN;

CREATE OR REPLACE FUNCTION public.create_tenant(
  p_name         text,
  p_display_name text
)
  RETURNS SETOF public.tenants
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_invite_code text;
  v_tenant      public.tenants%ROWTYPE;
  v_attempt     int;
BEGIN
  -- 認証必須
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '認証情報の取得に失敗しました（未認証ユーザーはワークスペースを作成できません）。'
      USING ERRCODE = '28000';
  END IF;

  -- 入力検証
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'ワークスペース名を入力してください。' USING ERRCODE = '23514';
  END IF;
  IF p_display_name IS NULL OR btrim(p_display_name) = '' THEN
    RAISE EXCEPTION '表示名を入力してください。' USING ERRCODE = '23514';
  END IF;

  -- 招待コード生成（6桁英大字）+ 一意衝突リトライ + tenants INSERT を原子化
  v_attempt := 0;
  LOOP
    v_attempt := v_attempt + 1;
    v_invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    BEGIN
      INSERT INTO public.tenants (name, invite_code, owner_id)
      VALUES (btrim(p_name), v_invite_code, v_uid)
      RETURNING * INTO v_tenant;
      EXIT;  -- 成功
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 8 THEN
        RAISE EXCEPTION '招待コードの生成に失敗しました。再度お試しください。';
      END IF;
      -- リトライ（別コードで再試行）
    END;
  END LOOP;

  -- オーナーを tenant_members に登録（同一トランザクション。失敗すれば tenants INSERT も巻戻る）
  INSERT INTO public.tenant_members (tenant_id, user_id, display_name, role)
  VALUES (v_tenant.id, v_uid, btrim(p_display_name), 'owner');

  RETURN NEXT v_tenant;
  RETURN;
END;
$function$;

COMMENT ON FUNCTION public.create_tenant(text, text) IS
  'P2/P3 B2(094): ワークスペース作成を原子化。tenants INSERT(owner_id=auth.uid()) → '
  'tenant_members INSERT(role=owner) を 1 トランザクションで実行し孤立テナントを防ぐ。'
  'invite_code はサーバ側で 6 桁生成・一意衝突リトライ。SETOF tenants を返す。';

-- MEMORY RLS 4 行テンプレ
REVOKE EXECUTE ON FUNCTION public.create_tenant(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_tenant(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_tenant(text, text) TO authenticated;

COMMIT;

-- =========================================================================
-- ROLLBACK SQL（094 適用前=RPC を除去。手動）
-- =========================================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.create_tenant(text, text);
-- COMMIT;

-- =========================================================================
-- 適用後 検証 SQL（本番で実行・全件 PASS が承認条件）
-- =========================================================================
-- -- 1.(正常) authenticated で create_tenant → tenants と tenant_members(owner) が 1 件ずつ
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<USER_UID>','role','authenticated')::text, true);
-- --   SELECT * FROM public.create_tenant('検証WS','検証オーナー');
-- --   -- → tenant 行が返り invite_code が 6 桁。
-- --   --    SELECT count(*) FROM tenant_members WHERE tenant_id=<返ったid> AND role='owner'; → 1
-- -- ROLLBACK;
--
-- -- 2.(原子性) tenant_members INSERT を擬似失敗させた場合に tenants 行が残らないこと
-- --    （関数内例外で全 ROLLBACK されるため、部分失敗時に孤立テナントが 0 件であることを確認）。
--
-- -- 3.(未認証) anon では EXECUTE 不可（REVOKE 済）。
