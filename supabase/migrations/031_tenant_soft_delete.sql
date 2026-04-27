/*
 * 031_tenant_soft_delete.sql
 *
 * 【目的】
 *   tenants テーブルにソフトデリート機能を追加し、
 *   論理削除されたテナントを各種検索から除外する。
 *
 * 【スコープ】
 *   1. tenants.deleted_at カラム追加
 *   2. deleted_at IS NULL を条件とする部分インデックス作成
 *   3. get_my_tenant_ids() の再定義（論理削除テナントを除外）
 *   4. soft_delete_tenant() 関数の追加（オーナー権限チェック付き）
 *   5. セキュリティ設定（REVOKE / GRANT）
 */
BEGIN;

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_deleted_at_null ON public.tenants(id) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_my_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT tm.tenant_id
    FROM public.tenant_members tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.user_id = auth.uid()
      AND t.deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_tenant(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.tenant_members
        WHERE role = 'owner'
          AND user_id = auth.uid()
          AND tenant_id = p_tenant_id
    ) THEN
        RAISE EXCEPTION 'permission denied: only owner can delete tenant' USING ERRCODE = '42501';
    END IF;

    UPDATE public.tenants
    SET deleted_at = now()
    WHERE id = p_tenant_id
      AND deleted_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_tenant(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.soft_delete_tenant(UUID) TO authenticated;

COMMIT;

/*
 * [ROLLBACK]
 *
 * 変更を元に戻す場合は以下を実行してください:
 *
 * -- インデックス削除
 * DROP INDEX IF EXISTS public.idx_tenants_deleted_at_null;
 *
 * -- soft_delete_tenant 関数削除
 * DROP FUNCTION IF EXISTS public.soft_delete_tenant(UUID);
 *
 * -- get_my_tenant_ids を元の定義に戻す
 * CREATE OR REPLACE FUNCTION public.get_my_tenant_ids()
 * RETURNS SETOF UUID
 * LANGUAGE sql
 * SECURITY DEFINER
 * SET search_path = public
 * STABLE
 * AS $$
 *     SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid();
 * $$;
 *
 * -- カラム削除
 * ALTER TABLE public.tenants DROP COLUMN IF EXISTS deleted_at;
 */
