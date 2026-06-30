-- Migration 106: set_view_scope 書込 RPC（権限管理UI化 Phase 2）
--
-- 設計書: .company/engineering/docs/2026-06-30-kintai-permissions-phase2-view-scope-ui.md
--
-- ★本番未適用＝SQLファイルのみ。適用は秘書の本番ゲート（BEGIN..ROLLBACK 検証 → apply）。★
--
-- 背景:
--   Phase1(105) で tenant_view_scopes / view_scope_for / 店舗スコープ SELECT RLS を導入。
--   Phase2 は owner(社長) が管理画面から「店長(manager) の閲覧範囲」を
--   全店(tenant) / 自店のみ(own_stores) で切替えられる窓口を初めて出す。
--
-- 設計方針（無音事故の構造的排除）:
--   supabase-js の UPDATE/DELETE は RLS 0 行除外を「無音 success」にする。
--   フロントから直 upsert すると、非 owner が押しても 0 行で成功扱い → UI は反映したように
--   見えるが DB は不変、という split-brain を生む。
--   → 書込みは必ず本 SECURITY DEFINER RPC 経由とし、認可・入力検証を関数内で RAISE EXCEPTION し、
--      0 行無音を構造的に排除する。
--
-- 認可境界:
--   §4.2-2 の is_tenant_owner(p_tenant_id) 明示チェックは 105 の
--   tvs_insert/tvs_update WITH CHECK (is_tenant_owner(tenant_id)) と同条件。
--   SECURITY DEFINER で RLS をすり抜けて upsert するが、RLS を緩めず同じ認可境界を維持する。
--
-- 非接触の確認（4操作横串）:
--   tenant_view_scopes のテーブル / RLS ポリシー(105 tvs_select/insert/update/delete) /
--   view_scope_for / 他 migration は一切変更しない。本 migration が触るのは新規 RPC 関数 1 つだけ。
--
-- 冪等: CREATE OR REPLACE FUNCTION（関数のみ）。再適用しても UNIQUE 衝突は ON CONFLICT で吸収。
--
-- 検証 SQL（秘書が本番ゲートで BEGIN..ROLLBACK 実行）: 本ファイル末尾コメント参照。

BEGIN;

-- role は 'manager' 固定（本体 literal）。
-- 将来 p_role text DEFAULT 'manager' へ拡張する余地あり（その際は CHECK と認可境界を要再設計）。
CREATE OR REPLACE FUNCTION public.set_view_scope(
  p_tenant_id uuid,
  p_domain    text,
  p_scope     text
)
  RETURNS public.tenant_view_scopes
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.tenant_view_scopes;
BEGIN
  -- 1. 入力検証（DB レイヤで再強制・UI を信用しない）
  IF p_domain NOT IN ('attendance', 'shift', 'shift_preference') THEN
    RAISE EXCEPTION 'invalid domain: %', p_domain USING ERRCODE = '23514';
  END IF;
  IF p_scope NOT IN ('tenant', 'own_stores') THEN
    RAISE EXCEPTION 'invalid scope: %', p_scope USING ERRCODE = '23514';
  END IF;

  -- 2. 認可（非 owner を構造的に遮断 = 0 行無音を排除）
  --    is_tenant_owner は呼び出し元 auth.uid() 基準（009 helper）。
  --    SECURITY DEFINER でもこの明示チェックにより非 owner は確実に弾かれる。
  IF NOT public.is_tenant_owner(p_tenant_id) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- 3. upsert（冪等）— role は 'manager' 固定
  INSERT INTO public.tenant_view_scopes (tenant_id, role, domain, scope)
  VALUES (p_tenant_id, 'manager', p_domain, p_scope)
  ON CONFLICT (tenant_id, role, domain)
  DO UPDATE SET scope = EXCLUDED.scope, updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- RLS 4 行テンプレ（092 sweep と整合）
REVOKE EXECUTE ON FUNCTION public.set_view_scope(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_view_scope(uuid, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_view_scope(uuid, text, text) TO authenticated;

COMMIT;

-- =====================================================================
-- 本番ゲート検証 SQL（秘書・BEGIN..ROLLBACK で本番 scope 無汚染）
-- list_projects name=kintai 突合（prod = zjjbfffhbobwwxyvdszl）を必ず先に。
-- owner/manager/staff の JWT 文脈は SET LOCAL request.jwt.claims で擬似。
-- 実 UID / tenant_id は本番から差し込む（下記はプレースホルダ）。
-- =====================================================================
--
-- -- (1) owner で成功 + RETURNING 反映（own_stores）→ view_scope_for 波及
-- BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<OWNER_UID>","role":"authenticated"}';
--   SELECT * FROM public.set_view_scope('<TENANT_ID>'::uuid, 'attendance', 'own_stores');
--     -- 期待: 1 行返却・scope='own_stores'・updated_at 更新
--   SELECT public.view_scope_for('<TENANT_ID>'::uuid, 'manager', 'attendance');
--     -- 期待: 'own_stores'（設定が Phase1 ヘルパに波及）
-- ROLLBACK;
--
-- -- (2) manager で呼ぶと RAISE で遮断・行不変
-- BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<MANAGER_UID>","role":"authenticated"}';
--   SELECT * FROM public.set_view_scope('<TENANT_ID>'::uuid, 'attendance', 'own_stores');
--     -- 期待: ERROR 'not authorized'（42501）。行は不変。
-- ROLLBACK;
--
-- -- (2') staff でも同様に RAISE
-- BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<STAFF_UID>","role":"authenticated"}';
--   SELECT * FROM public.set_view_scope('<TENANT_ID>'::uuid, 'shift', 'own_stores');
--     -- 期待: ERROR 'not authorized'（42501）。
-- ROLLBACK;
--
-- -- (3) 無効 domain / scope は RAISE（owner 文脈でも入力検証で弾く）
-- BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<OWNER_UID>","role":"authenticated"}';
--   SELECT * FROM public.set_view_scope('<TENANT_ID>'::uuid, 'sales', 'own_stores');
--     -- 期待: ERROR 'invalid domain: sales'（23514）
--   SELECT * FROM public.set_view_scope('<TENANT_ID>'::uuid, 'attendance', 'all');
--     -- 期待: ERROR 'invalid scope: all'（23514）
-- ROLLBACK;
--
-- -- (4) 冪等（2 回呼びで UNIQUE 衝突せず 1 行・count=1）
-- BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<OWNER_UID>","role":"authenticated"}';
--   SELECT * FROM public.set_view_scope('<TENANT_ID>'::uuid, 'shift', 'own_stores');
--   SELECT * FROM public.set_view_scope('<TENANT_ID>'::uuid, 'shift', 'tenant');
--   SELECT count(*) FROM public.tenant_view_scopes
--     WHERE tenant_id = '<TENANT_ID>'::uuid AND role='manager' AND domain='shift';
--     -- 期待: count=1・scope='tenant'（最後の値で上書き）
-- ROLLBACK;
--
-- -- ACL（anon REVOKE / PUBLIC 無し）: pg_proc.proacl を確認
-- SELECT proname, proacl FROM pg_proc
--   WHERE proname = 'set_view_scope' AND pronamespace = 'public'::regnamespace;
--     -- 期待: =X/postgres（PUBLIC GRANT）が無い・anon=X 無し・authenticated=X 有り
--
-- ★ 全 ROLLBACK のため本番 tenant_view_scopes は scope='tenant' のまま無汚染。
-- ★ apply → 再検証 → advisor 非増悪 → dual push。
