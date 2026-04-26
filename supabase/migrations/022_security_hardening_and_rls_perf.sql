-- =============================================================================
-- 022_security_hardening_and_rls_perf.sql
--
-- 目的:
--   Loop E 申し送り (E-1, E-2, E-5) + migration 021 の Supabase advisor 警告対応を
--   1 つの migration にまとめる。
--
-- 概要:
--   A. set_store_member_manager 関数の強化
--      - search_path = '' + 全テーブル参照を完全修飾化（公式ベスプラ）
--      - PUBLIC / anon の EXECUTE 権限を REVOKE（Defense in Depth）
--      - 3 引数版 (p_store_id, p_member_id, p_is_manager) を新規追加
--        （クライアント側 select id → rpc の TOCTOU を解消）
--      - 並行更新を pg_advisory_xact_lock で直列化
--   B. shift_submission_deadlines (021) の advisor 警告対応
--      - touch_ssd_updated_at に SET search_path = public, pg_temp 追加
--      - RLS 内 auth.uid() を (select auth.uid()) に置換（行単位再評価回避）
--      - ssd_modify_by_owner_or_manager (FOR ALL) を INSERT/UPDATE/DELETE 3 本に分割
--      - created_by / store_id への単独 index を追加
--
-- 冪等性:
--   - 関数は CREATE OR REPLACE
--   - ポリシーは DROP IF EXISTS → CREATE
--   - index は CREATE INDEX IF NOT EXISTS
--
-- スキーマ前提（015 / 017 / 021 由来・無改変）:
--   public.store_members(id, store_id, member_id, is_primary, is_manager, created_at)
--     ※ updated_at / deleted_at カラムは存在しない
--   public.stores(id, tenant_id, name, created_at)
--   public.tenant_members(id, tenant_id, user_id, role, ...)
--     role IN ('owner','manager','staff')
--   public.shift_submission_deadlines(id, tenant_id, store_id, target_month,
--                                     deadline_at, created_by, created_at, updated_at)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A-1. set_store_member_manager(uuid, boolean) 再定義
--      （019 の 2 引数版を search_path='' + 完全修飾 + advisory_lock 強化）
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_store_member_manager(
  target_store_member_id uuid,
  new_is_manager         boolean
)
RETURNS public.store_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result          public.store_members;
  caller_user_id  uuid := auth.uid();
  target_tenant_id uuid;
BEGIN
  IF caller_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 同一 store_member 行への並行更新を直列化（TOCTOU 緩和）
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('store_member_manager:' || target_store_member_id::text)
  );

  SELECT s.tenant_id
    INTO target_tenant_id
    FROM public.store_members sm
    JOIN public.stores s ON s.id = sm.store_id
   WHERE sm.id = target_store_member_id;

  IF target_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Store member not found: %', target_store_member_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = target_tenant_id
       AND user_id   = caller_user_id
       AND role      = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only tenant owner can change is_manager';
  END IF;

  UPDATE public.store_members
     SET is_manager = new_is_manager
   WHERE id = target_store_member_id
   RETURNING * INTO result;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_store_member_manager(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_store_member_manager(uuid, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_store_member_manager(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- A-2. set_store_member_manager(uuid, uuid, boolean) 新規追加
--      （クライアント TOCTOU 解消用 3 引数版）
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_store_member_manager(
  p_store_id   uuid,
  p_member_id  uuid,
  p_is_manager boolean
)
RETURNS public.store_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result            public.store_members;
  caller_user_id    uuid := auth.uid();
  target_tenant_id  uuid;
  resolved_sm_id    uuid;
BEGIN
  IF caller_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- store + member 単位で並行更新を直列化
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('store_member_manager:' || p_store_id::text || ':' || p_member_id::text)
  );

  SELECT sm.id, s.tenant_id
    INTO resolved_sm_id, target_tenant_id
    FROM public.store_members sm
    JOIN public.stores s ON s.id = sm.store_id
   WHERE sm.store_id  = p_store_id
     AND sm.member_id = p_member_id;

  IF resolved_sm_id IS NULL THEN
    RAISE EXCEPTION 'Store member not found for store=% member=%', p_store_id, p_member_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = target_tenant_id
       AND user_id   = caller_user_id
       AND role      = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only tenant owner can change is_manager';
  END IF;

  UPDATE public.store_members
     SET is_manager = p_is_manager
   WHERE id = resolved_sm_id
   RETURNING * INTO result;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_store_member_manager(uuid, uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_store_member_manager(uuid, uuid, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_store_member_manager(uuid, uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- B-1. touch_ssd_updated_at 再定義（search_path 警告対応）
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_ssd_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- B-2 / B-3. shift_submission_deadlines RLS ポリシー再作成
--   - auth.uid() → (select auth.uid()) （行単位再評価を回避）
--   - FOR ALL を INSERT / UPDATE / DELETE に分割
-- ---------------------------------------------------------------------------

-- 既存ポリシーを drop（021 由来 + 過去再実行残骸）
DROP POLICY IF EXISTS ssd_select_by_store_member       ON public.shift_submission_deadlines;
DROP POLICY IF EXISTS ssd_modify_by_owner_or_manager   ON public.shift_submission_deadlines;
DROP POLICY IF EXISTS ssd_insert_by_owner_or_manager   ON public.shift_submission_deadlines;
DROP POLICY IF EXISTS ssd_update_by_owner_or_manager   ON public.shift_submission_deadlines;
DROP POLICY IF EXISTS ssd_delete_by_owner_or_manager   ON public.shift_submission_deadlines;

-- SELECT: テナント所属メンバーであれば閲覧可
CREATE POLICY ssd_select_by_store_member
  ON public.shift_submission_deadlines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      JOIN public.tenant_members tm ON tm.tenant_id = s.tenant_id
      WHERE s.id = shift_submission_deadlines.store_id
        AND tm.user_id = (select auth.uid())
    )
  );

-- INSERT: owner / manager のみ
CREATE POLICY ssd_insert_by_owner_or_manager
  ON public.shift_submission_deadlines
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      JOIN public.tenant_members tm ON tm.tenant_id = s.tenant_id
      WHERE s.id = shift_submission_deadlines.store_id
        AND tm.user_id = (select auth.uid())
        AND tm.role IN ('owner', 'manager')
    )
  );

-- UPDATE: owner / manager のみ
CREATE POLICY ssd_update_by_owner_or_manager
  ON public.shift_submission_deadlines
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      JOIN public.tenant_members tm ON tm.tenant_id = s.tenant_id
      WHERE s.id = shift_submission_deadlines.store_id
        AND tm.user_id = (select auth.uid())
        AND tm.role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      JOIN public.tenant_members tm ON tm.tenant_id = s.tenant_id
      WHERE s.id = shift_submission_deadlines.store_id
        AND tm.user_id = (select auth.uid())
        AND tm.role IN ('owner', 'manager')
    )
  );

-- DELETE: owner / manager のみ
CREATE POLICY ssd_delete_by_owner_or_manager
  ON public.shift_submission_deadlines
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      JOIN public.tenant_members tm ON tm.tenant_id = s.tenant_id
      WHERE s.id = shift_submission_deadlines.store_id
        AND tm.user_id = (select auth.uid())
        AND tm.role IN ('owner', 'manager')
    )
  );

-- ---------------------------------------------------------------------------
-- B-4. 単独 index 追加（FK 走査・絞り込みの高速化）
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_ssd_created_by
  ON public.shift_submission_deadlines (created_by);

CREATE INDEX IF NOT EXISTS idx_ssd_store_id
  ON public.shift_submission_deadlines (store_id);

COMMIT;

-- =============================================================================
-- ロールバック手順（参考・通常実行しない）
-- =============================================================================
--   BEGIN;
--   -- B-4 index 削除
--   DROP INDEX IF EXISTS public.idx_ssd_store_id;
--   DROP INDEX IF EXISTS public.idx_ssd_created_by;
--
--   -- B-2/B-3 ポリシーを 021 の状態に戻す
--   DROP POLICY IF EXISTS ssd_select_by_store_member     ON public.shift_submission_deadlines;
--   DROP POLICY IF EXISTS ssd_insert_by_owner_or_manager ON public.shift_submission_deadlines;
--   DROP POLICY IF EXISTS ssd_update_by_owner_or_manager ON public.shift_submission_deadlines;
--   DROP POLICY IF EXISTS ssd_delete_by_owner_or_manager ON public.shift_submission_deadlines;
--   -- 021 の ssd_select_by_store_member / ssd_modify_by_owner_or_manager を再適用
--
--   -- B-1 trigger 関数は OR REPLACE で 021 状態に戻す
--   -- A-2 3 引数版を削除
--   DROP FUNCTION IF EXISTS public.set_store_member_manager(uuid, uuid, boolean);
--   -- A-1 2 引数版は 019 の状態に戻したい場合は 019 の本体を再 CREATE OR REPLACE
--   COMMIT;
-- =============================================================================
