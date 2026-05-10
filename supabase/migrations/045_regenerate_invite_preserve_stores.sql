-- =============================================================
-- migration 045: regenerate_invite_code_with_stores の店舗紐付け semantics 修正
--
-- 背景: 044 では p_store_ids の値に関わらず DELETE が無条件で走り、
--   TS 側で {expiresInDays, maxUses} のみを指定した「コードのみ再発行」
--   呼び出しでも既存の店舗紐付けが silent に削除されていた (Reviewer P1-1)。
--
-- 新 semantics:
--   p_store_ids IS NULL  → 既存の invite_code_stores を保持（書き換えなし）
--   p_store_ids = '{}'   → 全削除（紐付けクリア）
--   p_store_ids = ARRAY  → DELETE 後 INSERT で置換
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
  v_user_id  UUID := auth.uid();
  v_role     TEXT;
  v_store_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- 権限確認: owner or manager (tenants.owner_id か tenant_members.role)
  SELECT CASE
           WHEN t.owner_id = v_user_id THEN 'owner'
           ELSE tm.role
         END
    INTO v_role
    FROM public.tenants t
    LEFT JOIN public.tenant_members tm
      ON tm.tenant_id = t.id
     AND tm.user_id = v_user_id
   WHERE t.id = p_tenant_id
     AND t.deleted_at IS NULL;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'invalid max uses';
  END IF;

  -- tenants 更新
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

  -- 店舗紐付けは p_store_ids が NULL の時は触らない（既存保持）
  IF p_store_ids IS NOT NULL THEN
    -- 全削除（空配列なら INSERT もスキップで「クリア」になる）
    DELETE FROM public.invite_code_stores WHERE tenant_id = p_tenant_id;

    FOREACH v_store_id IN ARRAY p_store_ids LOOP
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
