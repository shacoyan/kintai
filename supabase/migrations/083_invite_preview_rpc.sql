-- Migration 083 (#3): 招待プレビュー RPC（preview_invite）
--
-- 目的: 全認証ユーザーが tenant_invite_codes / tenants を素の SELECT で列挙し、
--       他テナントの有効招待コード・name・owner_id を取得 → join_tenant_with_invite_v3 で
--       他社へ侵入できる列挙脆弱性（P0 #3）を塞ぐための SECURITY DEFINER RPC。
--       code 完全一致 1 件（active のみ）を評価し、invite_code 文字列・owner_id・revoked_at 値は返さない。
--
-- ★適用順序（厳守 — 逆順だと未参加ユーザーのプレビューが即死する）:
--   ① 本 083（RPC 追加のみ・非破壊）を apply（先に apply しても無害）
--   ② src/pages/JoinPage.tsx を supabase.rpc('preview_invite') へ切替え、本番デプロイ
--   ③ デプロイ反映確認後に 084_invite_enumeration_lockdown.sql を apply（列挙 policy を DROP）

BEGIN;

CREATE OR REPLACE FUNCTION public.preview_invite(p_code text)
RETURNS TABLE (
  tenant_id    uuid,
  tenant_name  text,
  expires_at   timestamptz,
  max_uses     integer,
  used_count   integer,
  is_valid     boolean,
  reason       text,
  stores       jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_code_id     uuid;
  v_tenant_id   uuid;
  v_expires_at  timestamptz;
  v_max_uses    integer;
  v_used_count  integer;
  v_tenant_name text;
  v_deleted_at  timestamptz;
  v_is_valid    boolean := true;
  v_reason      text := 'ok';
  v_stores      jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_code IS NULL OR length(btrim(p_code)) = 0 THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::timestamptz,
                        NULL::integer, NULL::integer,
                        false, 'not_found'::text, '[]'::jsonb;
    RETURN;
  END IF;

  -- 完全一致かつ active(revoked_at IS NULL) のみ評価。
  -- 部分ユニーク tenant_invite_codes_code_unique_active により最大1件保証＝決定的。
  -- join_tenant_with_invite_v3 も active のみを引くため、preview と join の整合が取れる。
  SELECT ic.id, ic.tenant_id, ic.expires_at, ic.max_uses, ic.used_count
    INTO v_code_id, v_tenant_id, v_expires_at, v_max_uses, v_used_count
    FROM public.tenant_invite_codes ic
   WHERE ic.code = p_code
     AND ic.revoked_at IS NULL;   -- LIKE 等は使わない（列挙防止）。revoked は拾わない（v_code_id NULL→not_found 秘匿）

  IF v_code_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::timestamptz,
                        NULL::integer, NULL::integer,
                        false, 'not_found'::text, '[]'::jsonb;
    RETURN;
  END IF;

  SELECT t.name, t.deleted_at
    INTO v_tenant_name, v_deleted_at
    FROM public.tenants t
   WHERE t.id = v_tenant_id;

  -- 状態判定（理由は返すが、code 文字列・owner_id・revoked_at 値そのものは返さない）
  IF v_tenant_name IS NULL OR v_deleted_at IS NOT NULL THEN
    v_is_valid := false; v_reason := 'not_found';   -- 削除済テナントは存在を隠す
    v_tenant_name := NULL; v_tenant_id := NULL;
  ELSIF v_expires_at IS NOT NULL AND v_expires_at < now() THEN
    v_is_valid := false; v_reason := 'expired';
  ELSIF v_max_uses IS NOT NULL AND v_used_count >= v_max_uses THEN
    v_is_valid := false; v_reason := 'max_uses_reached';
  END IF;

  -- 配属店舗（有効時のみ。無効時は店舗も伏せる）
  IF v_is_valid THEN
    SELECT COALESCE(
             jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name)
                       ORDER BY ics.sort_order, ics.store_id),
             '[]'::jsonb)
      INTO v_stores
      FROM public.tenant_invite_code_stores ics
      JOIN public.stores s ON s.id = ics.store_id
     WHERE ics.invite_code_id = v_code_id;
  END IF;

  RETURN QUERY SELECT v_tenant_id, v_tenant_name, v_expires_at,
                      v_max_uses, v_used_count, v_is_valid, v_reason, v_stores;
END;
$function$;

-- RLS4 テンプレ（anon 排除）
REVOKE EXECUTE ON FUNCTION public.preview_invite(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.preview_invite(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.preview_invite(text) TO authenticated;

COMMIT;
