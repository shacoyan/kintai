-- 044_invite_url_with_stores.sql
-- Phase 1: 招待URL機能 — DB スキーマ
-- 設計書: .company/engineering/docs/2026-05-10-kintai-invite-url-techdesign.md §4
-- 注: 043 は予約・欠番（命名規則踏襲）
--
-- 追加内容:
--   1) public.invite_code_stores 中間テーブル + RLS
--   2) public.regenerate_invite_code_with_stores RPC (owner/manager)
--   3) public.join_tenant_with_invite_v2 RPC (authenticated)
--
-- 規律: 041/042 SECURITY DEFINER 4 行テンプレ準拠
--   SET search_path = public / REVOKE PUBLIC / REVOKE anon / GRANT authenticated

BEGIN;

-- =============================================================
-- §1 invite_code_stores 中間テーブル
-- =============================================================

CREATE TABLE IF NOT EXISTS public.invite_code_stores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id    UUID NOT NULL REFERENCES public.stores(id)  ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invite_code_stores_tenant_store_unique UNIQUE (tenant_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_invite_code_stores_tenant
  ON public.invite_code_stores(tenant_id);

ALTER TABLE public.invite_code_stores ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- §2 RLS: owner / manager のみ参照・操作可能
-- =============================================================

DROP POLICY IF EXISTS "invite_code_stores_select_admin" ON public.invite_code_stores;
CREATE POLICY "invite_code_stores_select_admin" ON public.invite_code_stores
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
       WHERE tm.tenant_id = invite_code_stores.tenant_id
         AND tm.user_id = auth.uid()
         AND tm.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS "invite_code_stores_modify_admin" ON public.invite_code_stores;
CREATE POLICY "invite_code_stores_modify_admin" ON public.invite_code_stores
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
       WHERE tm.tenant_id = invite_code_stores.tenant_id
         AND tm.user_id = auth.uid()
         AND tm.role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
       WHERE tm.tenant_id = invite_code_stores.tenant_id
         AND tm.user_id = auth.uid()
         AND tm.role IN ('owner', 'manager')
    )
    AND
    -- store_id が同じテナントに属することを確認（クロステナント混入防止）
    EXISTS (
      SELECT 1 FROM public.stores s
       WHERE s.id = invite_code_stores.store_id
         AND s.tenant_id = invite_code_stores.tenant_id
    )
  );

-- =============================================================
-- §3 招待コード再生成 + 店舗紐付け一括更新 RPC
--   regenerate_invite_code_with_stores(
--     p_tenant_id  UUID,
--     p_new_code   TEXT,
--     p_expires_at TIMESTAMPTZ NULL,
--     p_max_uses   INTEGER NULL,
--     p_store_ids  UUID[]
--   ) RETURNS VOID
-- =============================================================

CREATE OR REPLACE FUNCTION public.regenerate_invite_code_with_stores(
  p_tenant_id  UUID,
  p_new_code   TEXT,
  p_expires_at TIMESTAMPTZ,
  p_max_uses   INTEGER,
  p_store_ids  UUID[]
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role TEXT;
  v_store_id    UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_caller_role
    FROM public.tenant_members
   WHERE tenant_id = p_tenant_id
     AND user_id = auth.uid();

  -- owner/manager 両方許可（設計書 §6.1）
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_new_code IS NULL OR length(p_new_code) <> 6 THEN
    RAISE EXCEPTION 'invalid invite code length';
  END IF;

  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'invalid max uses';
  END IF;

  -- tenants 更新（行ロック相当: PK で WHERE → 直列化）
  UPDATE public.tenants
     SET invite_code            = p_new_code,
         invite_code_expires_at = p_expires_at,
         invite_code_max_uses   = p_max_uses,
         invite_code_used_count = 0
   WHERE id = p_tenant_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant not found';
  END IF;

  -- 既存の店舗紐付けクリア
  DELETE FROM public.invite_code_stores WHERE tenant_id = p_tenant_id;

  -- 新しい店舗紐付け追加（NULL/空配列ならスキップ）
  IF p_store_ids IS NOT NULL THEN
    FOREACH v_store_id IN ARRAY p_store_ids LOOP
      -- store_id がテナントに属することを確認（不正 ID 弾き）
      IF EXISTS (
        SELECT 1 FROM public.stores
         WHERE id = v_store_id
           AND tenant_id = p_tenant_id
      ) THEN
        INSERT INTO public.invite_code_stores (tenant_id, store_id)
        VALUES (p_tenant_id, v_store_id)
        ON CONFLICT (tenant_id, store_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.regenerate_invite_code_with_stores(UUID, TEXT, TIMESTAMPTZ, INTEGER, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regenerate_invite_code_with_stores(UUID, TEXT, TIMESTAMPTZ, INTEGER, UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.regenerate_invite_code_with_stores(UUID, TEXT, TIMESTAMPTZ, INTEGER, UUID[]) TO authenticated;

-- =============================================================
-- §4 招待コード join + store_members 自動 INSERT RPC
--   join_tenant_with_invite_v2(
--     p_invite_code  TEXT,
--     p_display_name TEXT
--   ) RETURNS UUID
-- 既存 join_tenant_with_invite(text,text) は v1 として temporariliy 並存。
-- マイナーリリース 1 周期後に DROP 予定（045+）。
-- =============================================================

CREATE OR REPLACE FUNCTION public.join_tenant_with_invite_v2(
  p_invite_code   TEXT,
  p_display_name  TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id   UUID;
  v_expires_at  TIMESTAMPTZ;
  v_max_uses    INTEGER;
  v_used_count  INTEGER;
  v_user_id     UUID := auth.uid();
  v_member_id   UUID;
  v_store_count INTEGER;
  v_store_id    UUID;
  v_idx         INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_display_name IS NULL OR length(btrim(p_display_name)) = 0 THEN
    RAISE EXCEPTION 'display name required';
  END IF;
  IF length(btrim(p_display_name)) > 30 THEN
    RAISE EXCEPTION 'display name too long';
  END IF;

  -- tenants 行ロック（並列 join のレース対策）
  SELECT id, invite_code_expires_at, invite_code_max_uses, invite_code_used_count
    INTO v_tenant_id, v_expires_at, v_max_uses, v_used_count
    FROM public.tenants
   WHERE invite_code = p_invite_code
     AND deleted_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite code not found';
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < now() THEN
    RAISE EXCEPTION 'invite code expired';
  END IF;

  IF v_max_uses IS NOT NULL AND v_used_count >= v_max_uses THEN
    RAISE EXCEPTION 'invite code max uses reached';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = v_tenant_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'already a member';
  END IF;

  -- tenant_members INSERT（legal_name は NULL のまま → onboarding が後続で埋める）
  INSERT INTO public.tenant_members (tenant_id, user_id, display_name, role)
  VALUES (v_tenant_id, v_user_id, btrim(p_display_name), 'staff')
  RETURNING id INTO v_member_id;

  -- invite_code_stores から店舗一覧取得 → store_members 自動 INSERT
  -- N=0: テナント加入のみ
  -- N>=1: 最初の 1 件のみ is_primary=true（017 uniq_store_members_primary_per_member 尊重）
  SELECT COUNT(*) INTO v_store_count
    FROM public.invite_code_stores
   WHERE tenant_id = v_tenant_id;

  IF v_store_count > 0 THEN
    FOR v_store_id IN
      SELECT store_id
        FROM public.invite_code_stores
       WHERE tenant_id = v_tenant_id
       ORDER BY created_at, store_id  -- 安定順序
    LOOP
      INSERT INTO public.store_members (store_id, member_id, is_primary, is_manager)
      VALUES (v_store_id, v_member_id, (v_idx = 0), false)
      ON CONFLICT (store_id, member_id) DO NOTHING;
      v_idx := v_idx + 1;
    END LOOP;
  END IF;

  -- used_count 加算
  UPDATE public.tenants
     SET invite_code_used_count = v_used_count + 1
   WHERE id = v_tenant_id;

  RETURN v_tenant_id;
END $$;

REVOKE ALL ON FUNCTION public.join_tenant_with_invite_v2(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_tenant_with_invite_v2(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.join_tenant_with_invite_v2(TEXT, TEXT) TO authenticated;

-- =============================================================
-- §5 検証コメント（apply 後の SELECT 用）
-- =============================================================
-- SELECT proname FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND proname IN ('join_tenant_with_invite_v2','regenerate_invite_code_with_stores');
-- expected: 2 rows
--
-- SELECT has_function_privilege('anon',          'join_tenant_with_invite_v2(text,text)', 'EXECUTE') AS anon_v2,
--        has_function_privilege('authenticated', 'join_tenant_with_invite_v2(text,text)', 'EXECUTE') AS auth_v2,
--        has_function_privilege('anon',          'regenerate_invite_code_with_stores(uuid,text,timestamptz,integer,uuid[])', 'EXECUTE') AS anon_regen,
--        has_function_privilege('authenticated', 'regenerate_invite_code_with_stores(uuid,text,timestamptz,integer,uuid[])', 'EXECUTE') AS auth_regen;
-- expected: f, t, f, t
--
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'invite_code_stores';
-- expected: invite_code_stores | t
--
-- SELECT polname FROM pg_policy WHERE polrelid = 'public.invite_code_stores'::regclass ORDER BY polname;
-- expected: invite_code_stores_modify_admin, invite_code_stores_select_admin

COMMIT;

-- =============================================================
-- [ROLLBACK]
-- =============================================================
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.join_tenant_with_invite_v2(TEXT, TEXT);
-- DROP FUNCTION IF EXISTS public.regenerate_invite_code_with_stores(UUID, TEXT, TIMESTAMPTZ, INTEGER, UUID[]);
-- DROP POLICY IF EXISTS "invite_code_stores_modify_admin" ON public.invite_code_stores;
-- DROP POLICY IF EXISTS "invite_code_stores_select_admin" ON public.invite_code_stores;
-- DROP TABLE IF EXISTS public.invite_code_stores CASCADE;
-- COMMIT;
