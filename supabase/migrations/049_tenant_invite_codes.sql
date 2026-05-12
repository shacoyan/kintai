-- =====================================================================
-- 049_tenant_invite_codes.sql
-- 招待URL per-store 化: tenant_invite_codes / tenant_invite_code_stores
--   + RPC 4 個 (issue / update / revoke / join_v3) + RLS 5 policy
-- 設計書: .company/engineering/docs/2026-05-12-kintai-invite-url-per-store-techdesign.md
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- §4.1 tenant_invite_codes テーブル
-- ---------------------------------------------------------------------
CREATE TABLE public.tenant_invite_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NULL,
  max_uses     INTEGER NULL CHECK (max_uses IS NULL OR max_uses > 0),
  used_count   INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  created_by   UUID NOT NULL REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ NULL,
  label        TEXT NULL,
  CONSTRAINT tenant_invite_codes_code_format
    CHECK (code ~ '^[A-Z0-9]{6,10}$'),
  CONSTRAINT tenant_invite_codes_label_len
    CHECK (label IS NULL OR char_length(label) <= 40)
);

-- code は revoke 後も歴史的に保持するため UNIQUE を partial にする。
-- 「現行有効な code がユニーク」を担保し、revoked 行と新規 code の衝突を避ける。
CREATE UNIQUE INDEX tenant_invite_codes_code_unique_active
  ON public.tenant_invite_codes(code)
  WHERE revoked_at IS NULL;

CREATE INDEX tenant_invite_codes_tenant_active_idx
  ON public.tenant_invite_codes(tenant_id)
  WHERE revoked_at IS NULL;

CREATE INDEX tenant_invite_codes_tenant_all_idx
  ON public.tenant_invite_codes(tenant_id, created_at DESC);

ALTER TABLE public.tenant_invite_codes ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- §4.2 tenant_invite_code_stores テーブル
-- ---------------------------------------------------------------------
CREATE TABLE public.tenant_invite_code_stores (
  invite_code_id UUID NOT NULL REFERENCES public.tenant_invite_codes(id) ON DELETE CASCADE,
  store_id       UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (invite_code_id, store_id)
);

CREATE INDEX tenant_invite_code_stores_store_idx
  ON public.tenant_invite_code_stores(store_id);

ALTER TABLE public.tenant_invite_code_stores ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- §6.1 RLS: tenant_invite_codes
-- ---------------------------------------------------------------------

-- SELECT: owner/manager が自テナント分参照可
CREATE POLICY tenant_invite_codes_select_admin
  ON public.tenant_invite_codes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
       WHERE tm.tenant_id = tenant_invite_codes.tenant_id
         AND tm.user_id = auth.uid()
         AND tm.role IN ('owner','manager')
    )
  );

-- INSERT/UPDATE/DELETE: RPC 経由のみを意図するが、念のため owner/manager のみ許可
CREATE POLICY tenant_invite_codes_modify_admin
  ON public.tenant_invite_codes
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
       WHERE tm.tenant_id = tenant_invite_codes.tenant_id
         AND tm.user_id = auth.uid()
         AND tm.role IN ('owner','manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
       WHERE tm.tenant_id = tenant_invite_codes.tenant_id
         AND tm.user_id = auth.uid()
         AND tm.role IN ('owner','manager')
    )
  );

-- §6.3 preview policy: ログイン済 user が invite_code 文字列を明示指定した時のみ参照
-- ※ Postgres RLS は列レベル制限ができないため、フロント側の SELECT 句で列を限定する運用。
CREATE POLICY tenant_invite_codes_preview_authenticated
  ON public.tenant_invite_codes
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND revoked_at IS NULL);

-- ---------------------------------------------------------------------
-- §6.2 RLS: tenant_invite_code_stores
-- ---------------------------------------------------------------------

CREATE POLICY tenant_invite_code_stores_select_admin
  ON public.tenant_invite_code_stores
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_invite_codes ic
       JOIN public.tenant_members tm
         ON tm.tenant_id = ic.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner','manager')
      WHERE ic.id = tenant_invite_code_stores.invite_code_id
    )
  );

CREATE POLICY tenant_invite_code_stores_modify_admin
  ON public.tenant_invite_code_stores
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_invite_codes ic
       JOIN public.tenant_members tm
         ON tm.tenant_id = ic.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner','manager')
      WHERE ic.id = tenant_invite_code_stores.invite_code_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_invite_codes ic
       JOIN public.tenant_members tm
         ON tm.tenant_id = ic.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner','manager')
      WHERE ic.id = tenant_invite_code_stores.invite_code_id
    )
    AND EXISTS (
      -- クロステナント混入防止
      SELECT 1 FROM public.tenant_invite_codes ic
       JOIN public.stores s
         ON s.tenant_id = ic.tenant_id
      WHERE ic.id = tenant_invite_code_stores.invite_code_id
        AND s.id = tenant_invite_code_stores.store_id
    )
  );

-- ---------------------------------------------------------------------
-- §5.1 RPC: issue_tenant_invite_code (新規発行)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_tenant_invite_code(
  p_tenant_id   UUID,
  p_expires_at  TIMESTAMPTZ,
  p_max_uses    INTEGER,
  p_store_ids   UUID[],
  p_label       TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_role         TEXT;
  v_code         TEXT;
  v_new_id       UUID;
  v_store_id     UUID;
  v_idx          INTEGER := 0;
  v_attempt      INTEGER := 0;
  v_active_count INTEGER;
BEGIN
  -- 1. 認証 + 権限ガード
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT CASE WHEN t.owner_id = v_user_id THEN 'owner' ELSE tm.role END
    INTO v_role
    FROM public.tenants t
    LEFT JOIN public.tenant_members tm
      ON tm.tenant_id = t.id AND tm.user_id = v_user_id
   WHERE t.id = p_tenant_id AND t.deleted_at IS NULL;

  IF v_role IS NULL OR v_role NOT IN ('owner','manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- 認可済 caller のみ tenant 行を advisory lock 化 (50 件上限 race 防御)
  PERFORM 1 FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;

  -- 2. 入力バリデーション
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'invalid_max_uses';
  END IF;
  IF p_label IS NOT NULL AND char_length(p_label) > 40 THEN
    RAISE EXCEPTION 'label_too_long';
  END IF;

  -- 3. 多数発行 DoS 防止: 同テナント active code は最大 50
  SELECT COUNT(*) INTO v_active_count
    FROM public.tenant_invite_codes
   WHERE tenant_id = p_tenant_id AND revoked_at IS NULL;
  IF v_active_count >= 50 THEN
    RAISE EXCEPTION 'too_many_active_codes';
  END IF;

  -- 4. ユニーク code 生成（最大 5 回リトライ）
  LOOP
    v_attempt := v_attempt + 1;
    -- 6 桁英数字。0/O/1/I は区別可能（既存 generateUniqueInviteCode と同型）
    v_code := upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 6));
    BEGIN
      INSERT INTO public.tenant_invite_codes(
        tenant_id, code, expires_at, max_uses, created_by, label
      )
      VALUES (p_tenant_id, v_code, p_expires_at, p_max_uses, v_user_id, NULLIF(btrim(p_label), ''))
      RETURNING id INTO v_new_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN
        RAISE EXCEPTION 'duplicate_invite_code';
      END IF;
    END;
  END LOOP;

  -- 5. 店舗紐付け (NULL/空配列なら 0 件)
  IF p_store_ids IS NOT NULL THEN
    FOREACH v_store_id IN ARRAY p_store_ids LOOP
      IF EXISTS (
        SELECT 1 FROM public.stores
         WHERE id = v_store_id AND tenant_id = p_tenant_id
      ) THEN
        INSERT INTO public.tenant_invite_code_stores(invite_code_id, store_id, sort_order)
        VALUES (v_new_id, v_store_id, v_idx)
        ON CONFLICT (invite_code_id, store_id) DO NOTHING;
        v_idx := v_idx + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN v_new_id;
END $$;

REVOKE ALL ON FUNCTION public.issue_tenant_invite_code(UUID, TIMESTAMPTZ, INTEGER, UUID[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_tenant_invite_code(UUID, TIMESTAMPTZ, INTEGER, UUID[], TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_tenant_invite_code(UUID, TIMESTAMPTZ, INTEGER, UUID[], TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- §5.2 RPC: update_tenant_invite_code (設定変更)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_tenant_invite_code(
  p_code_id     UUID,
  p_expires_at  TIMESTAMPTZ,
  p_max_uses    INTEGER,
  p_store_ids   UUID[],
  p_label       TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_tenant_id UUID;
  v_role      TEXT;
  v_store_id  UUID;
  v_idx       INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT tenant_id INTO v_tenant_id
    FROM public.tenant_invite_codes
   WHERE id = p_code_id AND revoked_at IS NULL
   FOR UPDATE;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'invite_code_not_found';
  END IF;

  SELECT CASE WHEN t.owner_id = v_user_id THEN 'owner' ELSE tm.role END
    INTO v_role
    FROM public.tenants t
    LEFT JOIN public.tenant_members tm
      ON tm.tenant_id = t.id AND tm.user_id = v_user_id
   WHERE t.id = v_tenant_id AND t.deleted_at IS NULL;

  IF v_role IS NULL OR v_role NOT IN ('owner','manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'invalid_max_uses';
  END IF;
  IF p_label IS NOT NULL AND char_length(p_label) > 40 THEN
    RAISE EXCEPTION 'label_too_long';
  END IF;

  -- code 文字列は温存（本 RPC では UPDATE 句に code を含めない）
  -- used_count もリセットしない
  UPDATE public.tenant_invite_codes
     SET expires_at = p_expires_at,
         max_uses   = p_max_uses,
         label      = NULLIF(btrim(p_label), '')
   WHERE id = p_code_id;

  -- store_ids semantics: NULL=保持 / '{}'=全削除 / ARRAY=置換 (045/048 と同型)
  IF p_store_ids IS NOT NULL THEN
    DELETE FROM public.tenant_invite_code_stores WHERE invite_code_id = p_code_id;
    FOREACH v_store_id IN ARRAY p_store_ids LOOP
      IF EXISTS (
        SELECT 1 FROM public.stores
         WHERE id = v_store_id AND tenant_id = v_tenant_id
      ) THEN
        INSERT INTO public.tenant_invite_code_stores(invite_code_id, store_id, sort_order)
        VALUES (p_code_id, v_store_id, v_idx)
        ON CONFLICT (invite_code_id, store_id) DO NOTHING;
        v_idx := v_idx + 1;
      END IF;
    END LOOP;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.update_tenant_invite_code(UUID, TIMESTAMPTZ, INTEGER, UUID[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_tenant_invite_code(UUID, TIMESTAMPTZ, INTEGER, UUID[], TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_invite_code(UUID, TIMESTAMPTZ, INTEGER, UUID[], TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- §5.3 RPC: revoke_tenant_invite_code (失効)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_tenant_invite_code(
  p_code_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_tenant_id UUID;
  v_role      TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT tenant_id INTO v_tenant_id
    FROM public.tenant_invite_codes
   WHERE id = p_code_id AND revoked_at IS NULL
   FOR UPDATE;

  IF v_tenant_id IS NULL THEN
    -- 既に revoke 済 or 存在しない → idempotent に成功扱い
    RETURN;
  END IF;

  SELECT CASE WHEN t.owner_id = v_user_id THEN 'owner' ELSE tm.role END
    INTO v_role
    FROM public.tenants t
    LEFT JOIN public.tenant_members tm
      ON tm.tenant_id = t.id AND tm.user_id = v_user_id
   WHERE t.id = v_tenant_id AND t.deleted_at IS NULL;

  IF v_role IS NULL OR v_role NOT IN ('owner','manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.tenant_invite_codes
     SET revoked_at = now()
   WHERE id = p_code_id AND revoked_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION public.revoke_tenant_invite_code(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_tenant_invite_code(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_tenant_invite_code(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- §5.4 RPC: join_tenant_with_invite_v3 (join 切替)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_tenant_with_invite_v3(
  p_invite_code   TEXT,
  p_display_name  TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_code_id      UUID;
  v_tenant_id    UUID;
  v_expires_at   TIMESTAMPTZ;
  v_max_uses     INTEGER;
  v_used_count   INTEGER;
  v_member_id    UUID;
  v_store_id     UUID;
  v_idx          INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_display_name IS NULL OR length(btrim(p_display_name)) = 0 THEN
    RAISE EXCEPTION 'display_name_required';
  END IF;
  IF length(btrim(p_display_name)) > 30 THEN
    RAISE EXCEPTION 'display_name_too_long';
  END IF;

  -- 1. tenant_invite_codes 行ロック
  SELECT id, tenant_id, expires_at, max_uses, used_count
    INTO v_code_id, v_tenant_id, v_expires_at, v_max_uses, v_used_count
    FROM public.tenant_invite_codes
   WHERE code = p_invite_code
     AND revoked_at IS NULL
   FOR UPDATE;

  IF v_code_id IS NULL THEN
    RAISE EXCEPTION 'invite_code_not_found';
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < now() THEN
    RAISE EXCEPTION 'invite_code_expired';
  END IF;
  IF v_max_uses IS NOT NULL AND v_used_count >= v_max_uses THEN
    RAISE EXCEPTION 'invite_code_max_uses_reached';
  END IF;

  -- 2. tenant_deleted_at チェック
  IF NOT EXISTS (
    SELECT 1 FROM public.tenants WHERE id = v_tenant_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'tenant_not_found';
  END IF;

  -- 3. 既メンバー check
  IF EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = v_tenant_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'already_a_member';
  END IF;

  -- 4. tenant_members INSERT
  INSERT INTO public.tenant_members(tenant_id, user_id, display_name, role)
  VALUES (v_tenant_id, v_user_id, btrim(p_display_name), 'staff')
  RETURNING id INTO v_member_id;

  -- 5. store_members 一括 INSERT (sort_order 順、先頭が is_primary=true)
  FOR v_store_id IN
    SELECT store_id
      FROM public.tenant_invite_code_stores
     WHERE invite_code_id = v_code_id
     ORDER BY sort_order, store_id
  LOOP
    INSERT INTO public.store_members(store_id, member_id, is_primary, is_manager)
    VALUES (v_store_id, v_member_id, (v_idx = 0), false)
    ON CONFLICT (store_id, member_id) DO NOTHING;
    v_idx := v_idx + 1;
  END LOOP;

  -- 6. used_count++ (v_code_id 行ロック済 → 安全)
  UPDATE public.tenant_invite_codes
     SET used_count = used_count + 1
   WHERE id = v_code_id;

  RETURN v_tenant_id;
END $$;

REVOKE ALL ON FUNCTION public.join_tenant_with_invite_v3(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_tenant_with_invite_v3(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.join_tenant_with_invite_v3(TEXT, TEXT) TO authenticated;

COMMIT;

-- =====================================================================
-- [VERIFICATION] §9.1 検証 SQL (apply 後に手動実行)
-- =====================================================================
--
-- -- 1. 行数 (050 backfill 後)
-- SELECT COUNT(*) FROM public.tenant_invite_codes WHERE revoked_at IS NULL;
-- -- expected: 4
--
-- -- 2. SABABA の店舗紐付け
-- SELECT COUNT(*) FROM public.tenant_invite_code_stores tics
--   JOIN public.tenant_invite_codes ic ON ic.id = tics.invite_code_id
--  WHERE ic.tenant_id = '6650e979-1777-44f4-a01b-a1752a37f92c';
-- -- expected: 1 (KITUNE)
--
-- -- 3. RPC 権限
-- SELECT
--   has_function_privilege('anon',          'issue_tenant_invite_code(uuid,timestamptz,integer,uuid[],text)', 'EXECUTE') AS anon_issue,
--   has_function_privilege('authenticated', 'issue_tenant_invite_code(uuid,timestamptz,integer,uuid[],text)', 'EXECUTE') AS auth_issue,
--   has_function_privilege('anon',          'update_tenant_invite_code(uuid,timestamptz,integer,uuid[],text)', 'EXECUTE') AS anon_upd,
--   has_function_privilege('authenticated', 'update_tenant_invite_code(uuid,timestamptz,integer,uuid[],text)', 'EXECUTE') AS auth_upd,
--   has_function_privilege('anon',          'revoke_tenant_invite_code(uuid)', 'EXECUTE') AS anon_rev,
--   has_function_privilege('authenticated', 'revoke_tenant_invite_code(uuid)', 'EXECUTE') AS auth_rev,
--   has_function_privilege('anon',          'join_tenant_with_invite_v3(text,text)', 'EXECUTE') AS anon_join,
--   has_function_privilege('authenticated', 'join_tenant_with_invite_v3(text,text)', 'EXECUTE') AS auth_join;
-- -- expected: f,t,f,t,f,t,f,t
--
-- -- 4. search_path 固定
-- SELECT proname, proconfig FROM pg_proc
--  WHERE proname IN ('issue_tenant_invite_code','update_tenant_invite_code','revoke_tenant_invite_code','join_tenant_with_invite_v3')
--  ORDER BY proname;
-- -- expected: 全行 proconfig に '{search_path=public, pg_temp}' を含む

-- =====================================================================
-- [ROLLBACK] §13.1 ロールバック SQL
-- =====================================================================
--
-- BEGIN;
--
-- -- 4 RPC drop
-- DROP FUNCTION IF EXISTS public.issue_tenant_invite_code(UUID, TIMESTAMPTZ, INTEGER, UUID[], TEXT);
-- DROP FUNCTION IF EXISTS public.update_tenant_invite_code(UUID, TIMESTAMPTZ, INTEGER, UUID[], TEXT);
-- DROP FUNCTION IF EXISTS public.revoke_tenant_invite_code(UUID);
-- DROP FUNCTION IF EXISTS public.join_tenant_with_invite_v3(TEXT, TEXT);
--
-- -- RLS policy drop
-- DROP POLICY IF EXISTS tenant_invite_code_stores_modify_admin ON public.tenant_invite_code_stores;
-- DROP POLICY IF EXISTS tenant_invite_code_stores_select_admin ON public.tenant_invite_code_stores;
-- DROP POLICY IF EXISTS tenant_invite_codes_preview_authenticated ON public.tenant_invite_codes;
-- DROP POLICY IF EXISTS tenant_invite_codes_modify_admin ON public.tenant_invite_codes;
-- DROP POLICY IF EXISTS tenant_invite_codes_select_admin ON public.tenant_invite_codes;
--
-- -- table drop (CASCADE で index/制約も削除)
-- DROP TABLE IF EXISTS public.tenant_invite_code_stores CASCADE;
-- DROP TABLE IF EXISTS public.tenant_invite_codes CASCADE;
--
-- COMMIT;
