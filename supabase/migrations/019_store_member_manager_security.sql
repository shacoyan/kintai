-- ============================================================================
-- 019: 複数店舗対応 Loop D-1
--   store_members.is_manager の更新を tenant owner 限定化
--   - 既存 "Managers can manage store_members" FOR ALL ポリシーを drop
--   - SELECT は 015 由来 "Tenant members can view store_members" がそのまま残る
--   - INSERT / DELETE は manager OK の個別ポリシーで再作成
--   - UPDATE は manager OK だが is_manager 列を変更する場合は owner 限定 (WITH CHECK)
--   - 推奨 API: SECURITY DEFINER 関数 set_store_member_manager(uuid, boolean)
--
-- Plan A (本ファイル本体): RLS WITH CHECK サブクエリで OLD.is_manager を比較
-- Plan B (ファイル末尾コメント): BEFORE UPDATE トリガーによる代替案
--   Plan A が動作しなかった場合、本体を Plan B のブロックに差し替えること。
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "Managers can manage store_members" ON store_members;

-- SELECT: 既存 "Tenant members can view store_members" は 015 に存在するため再作成不要
-- (017 では drop していない)

CREATE POLICY "Managers can insert store_members" ON store_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM stores s
      JOIN tenant_members tm ON tm.tenant_id = s.tenant_id
      WHERE s.id = store_members.store_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Managers can delete store_members" ON store_members
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM stores s
      JOIN tenant_members tm ON tm.tenant_id = s.tenant_id
      WHERE s.id = store_members.store_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Managers can update store_members" ON store_members
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM stores s
      JOIN tenant_members tm ON tm.tenant_id = s.tenant_id
      WHERE s.id = store_members.store_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    -- is_manager の変更を含む UPDATE は owner のみ
    is_manager = (
      SELECT prev.is_manager FROM store_members prev WHERE prev.id = store_members.id
    )
    OR EXISTS (
      SELECT 1 FROM stores s
      JOIN tenant_members tm ON tm.tenant_id = s.tenant_id
      WHERE s.id = store_members.store_id
        AND tm.user_id = auth.uid()
        AND tm.role = 'owner'
    )
  );

-- 推奨 API: SECURITY DEFINER 関数 (RLS バイパス・owner ゲート付き)
CREATE OR REPLACE FUNCTION public.set_store_member_manager(
  target_store_member_id UUID,
  new_is_manager BOOLEAN
)
RETURNS store_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result store_members;
  caller_user_id UUID := auth.uid();
  target_tenant_id UUID;
BEGIN
  IF caller_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT s.tenant_id INTO target_tenant_id
  FROM store_members sm
  JOIN stores s ON s.id = sm.store_id
  WHERE sm.id = target_store_member_id;

  IF target_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Store member not found: %', target_store_member_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tenant_members
    WHERE tenant_id = target_tenant_id
      AND user_id = caller_user_id
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only tenant owner can change is_manager';
  END IF;

  UPDATE store_members
  SET is_manager = new_is_manager
  WHERE id = target_store_member_id
  RETURNING * INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.set_store_member_manager(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_store_member_manager(UUID, BOOLEAN) TO authenticated;

COMMIT;

-- ロールバック手順（参考）
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.set_store_member_manager(UUID, BOOLEAN);
--   DROP POLICY IF EXISTS "Managers can update store_members" ON store_members;
--   DROP POLICY IF EXISTS "Managers can delete store_members" ON store_members;
--   DROP POLICY IF EXISTS "Managers can insert store_members" ON store_members;
--   CREATE POLICY "Managers can manage store_members" ON store_members
--     FOR ALL USING ( ... 017 9-i 参照 ... );
--   COMMIT;

-- 検証クエリ（適用後手動実行）
--   1) owner として呼ぶと成功
--      SELECT public.set_store_member_manager('<sm_id>'::uuid, true);
--   2) manager として呼ぶと例外
--      → "Only tenant owner can change is_manager"
--   3) manager が直接 UPDATE store_members SET is_manager = true WHERE id = ...
--      → WITH CHECK 違反でエラー
--   4) manager が is_primary だけ UPDATE
--      → 成功 (is_manager は変わらないため WITH CHECK 通過)

/*
============================================================================
[Plan B] BEFORE UPDATE トリガーによる is_manager 変更制限
PostgreSQL のバージョン等の制約で Plan A (WITH CHECK サブクエリ) が動作しない場合の代替案。
本体の "Managers can update store_members" の WITH CHECK を以下のシンプル版に差し替え、
代わりにトリガーで is_manager 変更を owner 限定にする。
============================================================================

-- 必要に応じて Plan A の UPDATE ポリシーをシンプルな形に差し替え
-- DROP POLICY IF EXISTS "Managers can update store_members" ON store_members;
-- CREATE POLICY "Managers can update store_members" ON store_members
--   FOR UPDATE
--   USING (
--     EXISTS (
--       SELECT 1 FROM stores s
--       JOIN tenant_members tm ON tm.tenant_id = s.tenant_id
--       WHERE s.id = store_members.store_id
--         AND tm.user_id = auth.uid()
--         AND tm.role IN ('owner', 'manager')
--     )
--   )
--   WITH CHECK (
--     EXISTS (
--       SELECT 1 FROM stores s
--       JOIN tenant_members tm ON tm.tenant_id = s.tenant_id
--       WHERE s.id = store_members.store_id
--         AND tm.user_id = auth.uid()
--         AND tm.role IN ('owner', 'manager')
--     )
--   );

CREATE OR REPLACE FUNCTION public.enforce_store_member_manager_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  is_owner BOOLEAN;
BEGIN
  -- is_manager が変更されていない場合はそのまま許可
  IF OLD.is_manager = NEW.is_manager THEN
    RETURN NEW;
  END IF;

  -- is_manager が変更される場合、呼び出し元が対象テナントの owner か確認
  SELECT EXISTS (
    SELECT 1
    FROM stores s
    JOIN tenant_members tm ON tm.tenant_id = s.tenant_id
    WHERE s.id = NEW.store_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'owner'
  ) INTO is_owner;

  IF NOT is_owner THEN
    RAISE EXCEPTION 'Only tenant owner can change is_manager';
  END IF;

  RETURN NEW;
END;
$$;

-- トリガーの作成 (RLS の WITH CHECK 評価前に実行されるよう BEFORE UPDATE を使用)
-- DROP TRIGGER IF EXISTS trigger_enforce_store_member_manager_update ON store_members;
CREATE TRIGGER trigger_enforce_store_member_manager_update
  BEFORE UPDATE OF is_manager ON store_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_store_member_manager_update();

*/
