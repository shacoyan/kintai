-- Migration 084 (#3): 招待コード/テナント 列挙 lockdown
--
-- ★この migration は JoinPage が preview_invite RPC（083）へ切替・本番デプロイ完了後にのみ apply すること。
--   順序を誤る（フロント未デプロイのまま apply する）と、未参加ユーザーの招待プレビューが即死する。
--   適用順序: ① 083 RPC apply → ② JoinPage を RPC 呼び出しへ切替えデプロイ → ③ 本 084 apply。
--
-- 目的: 全認証ユーザーが tenant_invite_codes / tenants を素の SELECT で列挙できる脆弱性（P0 #3）を塞ぐ。
--   - tenant_invite_codes: preview_authenticated（auth.uid IS NOT NULL AND revoked_at IS NULL）を DROP。
--     残す policy = tenant_invite_codes_select_admin / tenant_invite_codes_modify_admin（owner/manager スコープ）。
--     未参加ユーザーは preview_invite RPC（SECURITY DEFINER・code 完全一致1件のみ）でプレビューする。
--   - tenants: "Authenticated users can lookup by invite code"（auth.uid IS NOT NULL）を DROP。
--     残す policy = "Members can view their tenants"(get_my_tenant_ids) / "Owner can view own tenants"(owner_id=auth.uid())。

BEGIN;

DROP POLICY IF EXISTS "tenant_invite_codes_preview_authenticated" ON public.tenant_invite_codes;

DROP POLICY IF EXISTS "Authenticated users can lookup by invite code" ON public.tenants;

COMMIT;

-- ============================================================================
-- ロールバック SQL（列挙 lockdown を 084 適用前の状態へ戻す）
-- ※ 084 で削除した 2 policy を元の定義で復元する。preview_invite RPC（083）は残してよい（追加のみ・無害）。
-- ----------------------------------------------------------------------------
-- BEGIN;
--
-- CREATE POLICY "tenant_invite_codes_preview_authenticated"
--   ON public.tenant_invite_codes
--   FOR SELECT
--   TO authenticated
--   USING ((auth.uid() IS NOT NULL) AND (revoked_at IS NULL));
--
-- CREATE POLICY "Authenticated users can lookup by invite code"
--   ON public.tenants
--   FOR SELECT
--   TO public
--   USING (auth.uid() IS NOT NULL);
--
-- COMMIT;
-- ============================================================================
