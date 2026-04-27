-- 034_tenant_member_self_delete.sql
-- 目的: tenant_members の DELETE RLS を緩和し、自分自身の行は DELETE 可能にする
--       (オーナーは UI 側で禁止。SQL では owner も DELETE 可なので、UI 制御 + 任意で CHECK 条件追加)
-- 既存ポリシー: owner/manager のみ DELETE 可だった想定 → self DELETE 用ポリシーを追加

BEGIN;

-- 自分自身の tenant_members 行を DELETE 可能にする (ただし owner は不可)
CREATE POLICY "tenant_members_delete_self_non_owner" ON public.tenant_members
  FOR DELETE USING (
    user_id = auth.uid()
    AND role <> 'owner'
  );

COMMIT;

-- [ROLLBACK]
-- BEGIN;
-- DROP POLICY IF EXISTS "tenant_members_delete_self_non_owner" ON public.tenant_members;
-- COMMIT;
