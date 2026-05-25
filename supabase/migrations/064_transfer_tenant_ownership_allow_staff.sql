-- 064_transfer_tenant_ownership_allow_staff.sql
-- Purpose: Relax constraint on transfer_tenant_ownership RPC.
-- Change: Allow 'staff' role in addition to 'manager' as a valid target for ownership transfer.
-- The old owner's downgrade destination remains 'manager' (existing behavior maintained).

CREATE OR REPLACE FUNCTION public.transfer_tenant_ownership(p_tenant_id uuid, p_new_owner_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
BEGIN
  IF auth.uid() = p_new_owner_user_id THEN
    RAISE EXCEPTION 'cannot transfer ownership to yourself' USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_caller_role FROM public.tenant_members WHERE tenant_id = p_tenant_id AND user_id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'permission denied: only owner can transfer ownership' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_target_role FROM public.tenant_members WHERE tenant_id = p_tenant_id AND user_id = p_new_owner_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'target user is not a member of this tenant' USING ERRCODE = '23503';
  END IF;

  IF v_target_role NOT IN ('manager', 'staff') THEN
    RAISE EXCEPTION 'target user must be a manager or staff (current role: %)', v_target_role USING ERRCODE = '22023';
  END IF;

  UPDATE public.tenant_members SET role = 'owner' WHERE tenant_id = p_tenant_id AND user_id = p_new_owner_user_id;
  UPDATE public.tenant_members SET role = 'manager' WHERE tenant_id = p_tenant_id AND user_id = auth.uid();
  UPDATE public.tenants SET owner_id = p_new_owner_user_id WHERE id = p_tenant_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.transfer_tenant_ownership(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transfer_tenant_ownership(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.transfer_tenant_ownership(uuid, uuid) TO authenticated;
