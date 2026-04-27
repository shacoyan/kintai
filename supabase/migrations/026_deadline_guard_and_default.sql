-- 026_deadline_guard_and_default.sql
-- Engineer C — マイグレーション
-- C-1: tenants に default_deadline_day (1..31) を追加
-- C-2: shift_preferences の RLS を締切ガード付きに再構築
-- (owner/manager は締切後もバイパス可能、staff は締切後 INSERT/UPDATE 拒否)

BEGIN;

-- C-1: tenants にデフォルト締切日カラムを追加
ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS default_deadline_day SMALLINT NULL
CHECK (default_deadline_day IS NULL OR default_deadline_day BETWEEN 1 AND 31);

-- C-2: 既存ポリシーをドロップして締切ガード付きポリシーに再構築
DROP POLICY IF EXISTS "Users manage own shift_preferences" ON public.shift_preferences;

-- SELECT: 本人
CREATE POLICY "shift_preferences_select_self"
ON public.shift_preferences
FOR SELECT
USING (
  user_id = auth.uid()
  AND tenant_id IN (SELECT get_my_tenant_ids())
);

-- INSERT: owner/manager はバイパス、staff は締切前のみ許可
CREATE POLICY "shift_preferences_insert_with_deadline"
ON public.shift_preferences
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND tenant_id IN (SELECT get_my_tenant_ids())
  AND (
    EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_id = shift_preferences.tenant_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
    OR
    NOT EXISTS (
      SELECT 1 FROM public.shift_submission_deadlines d
      WHERE d.tenant_id = shift_preferences.tenant_id
        AND d.store_id = shift_preferences.store_id
        AND d.target_month = date_trunc('month', shift_preferences.date)::date
        AND d.deadline_at < now()
    )
  )
);

-- UPDATE: owner/manager はバイパス（代理編集可）、staff は締切前のみ自分の行を許可
CREATE POLICY "shift_preferences_update_with_deadline"
ON public.shift_preferences
FOR UPDATE
USING (
  tenant_id IN (SELECT get_my_tenant_ids())
  AND (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_id = shift_preferences.tenant_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  )
)
WITH CHECK (
  tenant_id IN (SELECT get_my_tenant_ids())
  AND (
    EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_id = shift_preferences.tenant_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
    OR (
      user_id = auth.uid()
      AND NOT EXISTS (
        SELECT 1 FROM public.shift_submission_deadlines d
        WHERE d.tenant_id = shift_preferences.tenant_id
          AND d.store_id = shift_preferences.store_id
          AND d.target_month = date_trunc('month', shift_preferences.date)::date
          AND d.deadline_at < now()
      )
    )
  )
);

-- DELETE: 本人または owner/manager
CREATE POLICY "shift_preferences_delete_self_or_manager"
ON public.shift_preferences
FOR DELETE
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = shift_preferences.tenant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'manager')
  )
);

-- 締切判定用インデックス
CREATE INDEX IF NOT EXISTS idx_ssd_lookup
ON public.shift_submission_deadlines (tenant_id, store_id, target_month, deadline_at);

COMMIT;

-- [ROLLBACK]
-- ALTER TABLE public.tenants DROP COLUMN IF EXISTS default_deadline_day;
-- DROP POLICY IF EXISTS "shift_preferences_select_self" ON public.shift_preferences;
-- DROP POLICY IF EXISTS "shift_preferences_insert_with_deadline" ON public.shift_preferences;
-- DROP POLICY IF EXISTS "shift_preferences_update_with_deadline" ON public.shift_preferences;
-- DROP POLICY IF EXISTS "shift_preferences_delete_self_or_manager" ON public.shift_preferences;
-- DROP INDEX IF EXISTS public.idx_ssd_lookup;
-- 元の Users manage own shift_preferences (FOR ALL) を再作成する場合:
-- CREATE POLICY "Users manage own shift_preferences" ON public.shift_preferences
--   FOR ALL USING (user_id = auth.uid() AND tenant_id IN (SELECT get_my_tenant_ids()));
