-- 033_invite_code_limits.sql
-- 目的: 招待コードに有効期限・使用回数上限を追加
-- スコープ: tenants テーブル拡張 + atomic な使用回数加算 RPC
-- 後方互換: 既存テナントは expires_at=NULL / max_uses=NULL / used_count=0 で「無期限・無制限」扱い

BEGIN;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS invite_code_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS invite_code_max_uses    INTEGER NULL CHECK (invite_code_max_uses IS NULL OR invite_code_max_uses > 0),
  ADD COLUMN IF NOT EXISTS invite_code_used_count  INTEGER NOT NULL DEFAULT 0 CHECK (invite_code_used_count >= 0);

CREATE INDEX IF NOT EXISTS idx_tenants_invite_code_expires
  ON public.tenants(invite_code_expires_at)
  WHERE invite_code_expires_at IS NOT NULL;

-- atomic な使用回数加算 (joinTenant の race condition 緩和)
-- SECURITY DEFINER で RLS をバイパスして UPDATE
-- 検証は SQL 内で行う (期限切れ・上限超過なら例外)
CREATE OR REPLACE FUNCTION public.increment_invite_code_use(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expires_at TIMESTAMPTZ;
  v_max_uses INTEGER;
  v_used_count INTEGER;
BEGIN
  SELECT invite_code_expires_at, invite_code_max_uses, invite_code_used_count
    INTO v_expires_at, v_max_uses, v_used_count
    FROM public.tenants
    WHERE id = p_tenant_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant not found';
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < now() THEN
    RAISE EXCEPTION 'invite code expired';
  END IF;

  IF v_max_uses IS NOT NULL AND v_used_count >= v_max_uses THEN
    RAISE EXCEPTION 'invite code max uses reached';
  END IF;

  UPDATE public.tenants
    SET invite_code_used_count = v_used_count + 1
    WHERE id = p_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_invite_code_use(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_invite_code_use(UUID) TO authenticated;

-- ============================================================
-- Loop 12 Phase 2 (Reviewer M3): atomic な招待コード join
-- ============================================================
-- 目的: SELECT → INSERT → +1 を 1 トランザクション + 行ロックで完結し、
--        上限 1 のコードに同時 2 人 join しても 1 人だけ成功するよう保証する。
-- 戻り値: 参加した tenant_id (UUID)
-- 例外メッセージ:
--   'not authenticated'         -- auth.uid() NULL
--   'invite code not found'     -- コード不一致
--   'invite code expired'       -- expires_at 超過
--   'invite code max uses reached' -- used_count >= max_uses
--   'already a member'          -- 既に member
CREATE OR REPLACE FUNCTION public.join_tenant_with_invite(
  p_invite_code TEXT,
  p_display_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_max_uses INTEGER;
  v_used_count INTEGER;
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_display_name IS NULL OR length(btrim(p_display_name)) = 0 THEN
    RAISE EXCEPTION 'display name required';
  END IF;

  -- 招待コードでテナントを行ロック付き取得
  SELECT id, invite_code_expires_at, invite_code_max_uses, invite_code_used_count
    INTO v_tenant_id, v_expires_at, v_max_uses, v_used_count
    FROM public.tenants
    WHERE invite_code = p_invite_code
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

  INSERT INTO public.tenant_members (tenant_id, user_id, display_name, role)
  VALUES (v_tenant_id, v_user_id, p_display_name, 'staff');

  UPDATE public.tenants
    SET invite_code_used_count = v_used_count + 1
    WHERE id = v_tenant_id;

  RETURN v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.join_tenant_with_invite(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_tenant_with_invite(TEXT, TEXT) TO authenticated;

COMMIT;

-- [ROLLBACK]
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.join_tenant_with_invite(TEXT, TEXT);
-- DROP FUNCTION IF EXISTS public.increment_invite_code_use(UUID);
-- DROP INDEX IF EXISTS public.idx_tenants_invite_code_expires;
-- ALTER TABLE public.tenants
--   DROP COLUMN IF EXISTS invite_code_used_count,
--   DROP COLUMN IF EXISTS invite_code_max_uses,
--   DROP COLUMN IF EXISTS invite_code_expires_at;
-- COMMIT;
