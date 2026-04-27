-- 032_transfer_ownership.sql
-- 目的: テナントオーナー権限の atomic 譲渡
--   - 旧 owner は manager に降格、新 owner は manager から昇格
--   - 譲渡先は同 tenant の manager である必要 (staff から直接昇格は不可)
--   - tenants.owner_id も同時に更新

BEGIN;

CREATE OR REPLACE FUNCTION public.transfer_tenant_ownership(
  p_tenant_id UUID,
  p_new_owner_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
BEGIN
  IF auth.uid() = p_new_owner_user_id THEN
    RAISE EXCEPTION 'cannot transfer ownership to yourself' USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_caller_role
    FROM public.tenant_members
    WHERE tenant_id = p_tenant_id AND user_id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'permission denied: only owner can transfer ownership' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_target_role
    FROM public.tenant_members
    WHERE tenant_id = p_tenant_id AND user_id = p_new_owner_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'target user is not a member of this tenant' USING ERRCODE = '23503';
  END IF;

  IF v_target_role <> 'manager' THEN
    RAISE EXCEPTION 'target user must be a manager (current role: %)', v_target_role USING ERRCODE = '22023';
  END IF;

  -- 譲渡先 → owner
  UPDATE public.tenant_members
    SET role = 'owner'
    WHERE tenant_id = p_tenant_id AND user_id = p_new_owner_user_id;

  -- 旧 owner → manager
  UPDATE public.tenant_members
    SET role = 'manager'
    WHERE tenant_id = p_tenant_id AND user_id = auth.uid();

  -- tenants.owner_id 更新
  UPDATE public.tenants
    SET owner_id = p_new_owner_user_id
    WHERE id = p_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_tenant_ownership(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_tenant_ownership(UUID, UUID) TO authenticated;

COMMIT;

-- [ROLLBACK]
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.transfer_tenant_ownership(UUID, UUID);
-- COMMIT;
