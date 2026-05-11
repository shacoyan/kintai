-- =============================================================
-- migration 048: 招待コード本体を温存したまま設定のみ更新する RPC
--
-- 背景: 045 の regenerate_invite_code_with_stores は invite_code を
--   毎回新しい値に置き換える挙動のため、店長が「期限を伸ばすだけ」
--   「店舗紐付けを変えるだけ」のつもりで操作した際に、既に配布済みの
--   招待URLが silent に無効化されていた。
--
-- 本 RPC の責務:
--   - invite_code 列は UPDATE しない（既存コードを完全温存）
--   - invite_code_used_count もリセットしない（累積カウント維持）
--   - invite_code_expires_at / invite_code_max_uses のみ更新
--   - invite_code_stores は 045 と同じ semantics で書き換え
--       NULL=保持 / '{}'=全削除 / ARRAY=置換
--   - invite_code が NULL の場合は invite_code_missing エラー
--     → caller (フロント) は regenerate_invite_code_with_stores へ
--       フォールバックする責務を負う
-- =============================================================

CREATE OR REPLACE FUNCTION public.update_invite_code_settings(
  p_tenant_id  UUID,
  p_expires_at TIMESTAMPTZ,
  p_max_uses   INTEGER,
  p_store_ids  UUID[]
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_role        TEXT;
  v_invite_code TEXT;
  v_store_id    UUID;
BEGIN
  -- 1. 認証チェック
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- 2. 権限ガード: owner / manager のみ
  SELECT CASE
           WHEN t.owner_id = v_user_id THEN 'owner'
           ELSE tm.role
         END,
         t.invite_code
    INTO v_role, v_invite_code
    FROM public.tenants t
    LEFT JOIN public.tenant_members tm
      ON tm.tenant_id = t.id
     AND tm.user_id   = v_user_id
   WHERE t.id = p_tenant_id
     AND t.deleted_at IS NULL;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- 3. invite_code が NULL の場合は明示エラー → caller 側で reset ルートにフォールバック
  IF v_invite_code IS NULL THEN
    RAISE EXCEPTION 'invite_code_missing' USING ERRCODE = 'P0002';
  END IF;

  -- 4. max_uses 妥当性
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'invalid_max_uses';
  END IF;

  -- 5. tenants 更新 — invite_code は UPDATE しない（温存）
  --    invite_code_used_count もリセットしない（既存コードの累積カウント維持）
  UPDATE public.tenants
     SET invite_code_expires_at = p_expires_at,
         invite_code_max_uses   = p_max_uses
   WHERE id = p_tenant_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant_not_found';
  END IF;

  -- 6. 店舗紐付け — 045 と完全同型の semantics
  --    NULL  → 既存保持（DELETE しない）
  --    '{}'  → 全削除
  --    ARRAY → DELETE 後 INSERT で置換
  IF p_store_ids IS NOT NULL THEN
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

-- 4 行テンプレ厳守
REVOKE ALL ON FUNCTION public.update_invite_code_settings(UUID, TIMESTAMPTZ, INTEGER, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_invite_code_settings(UUID, TIMESTAMPTZ, INTEGER, UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_invite_code_settings(UUID, TIMESTAMPTZ, INTEGER, UUID[]) TO authenticated;

COMMENT ON FUNCTION public.update_invite_code_settings(UUID, TIMESTAMPTZ, INTEGER, UUID[]) IS
  '招待コード本体を温存したまま expires_at / max_uses / invite_code_stores のみ更新する。invite_code が NULL の場合は invite_code_missing エラーを返し、caller は regenerate_invite_code_with_stores にフォールバックする責務を負う。';
