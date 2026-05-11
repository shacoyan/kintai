-- 046_remove_tenant_member_rpc.sql
-- owner/manager が他テナントメンバーを削除する SECURITY DEFINER RPC。
-- - role='owner' は削除不可 (テナント所有者保護)。
-- - 削除実行者 (auth.uid()) は同テナントの owner または manager であること。
-- - 削除実行者自身 (self) は不可 (退会は tenant_members_delete_self_non_owner policy 経由)。
-- - store_members は FK CASCADE で自動削除される。
--
-- 背景: tenant_members の DELETE RLS は self-only のため owner/manager が他人を消す経路がなく、
-- bare `.delete()` が RLS 0 行除外で無音 success になっていた。RPC + 戻り値ガードで二重防御。
-- 2026-05-11 規律準拠 (search_path + REVOKE PUBLIC + REVOKE anon + GRANT authenticated)。

CREATE OR REPLACE FUNCTION public.remove_tenant_member(p_member_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target RECORD;
  v_caller_role text;
BEGIN
  -- 対象メンバー取得
  SELECT id, tenant_id, user_id, role
    INTO v_target
    FROM public.tenant_members
   WHERE id = p_member_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found' USING ERRCODE = 'P0001';
  END IF;

  -- owner は削除不可
  IF v_target.role = 'owner' THEN
    RAISE EXCEPTION 'cannot remove owner' USING ERRCODE = 'P0001';
  END IF;

  -- 自分自身は削除不可 (退会は別経路: tenant_members_delete_self_non_owner)
  IF v_target.user_id = auth.uid() THEN
    RAISE EXCEPTION 'use leave-tenant flow to remove self' USING ERRCODE = 'P0001';
  END IF;

  -- 呼び出し元の role を取得 (同じ tenant 内)
  SELECT role INTO v_caller_role
    FROM public.tenant_members
   WHERE tenant_id = v_target.tenant_id
     AND user_id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- 削除実行 (store_members は FK CASCADE で連動削除)
  DELETE FROM public.tenant_members WHERE id = p_member_id;

  RETURN p_member_id;
END;
$$;

-- 4 行テンプレ (anon 排除 + 規律準拠)
REVOKE EXECUTE ON FUNCTION public.remove_tenant_member(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.remove_tenant_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.remove_tenant_member(uuid) TO authenticated;
