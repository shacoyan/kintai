-- ============================================================================
-- 067_task_assignees.sql
-- Purpose: タスク複数担当者対応。中間テーブル task_assignees 新設 + 既存
--          tasks.assignee_user_id の移行 + RLS/RPC/トリガ更新。
--   - assignee_user_id は「primary assignee (後方互換)」として残し、
--     task_assignees の最古 1 行と同期 (トリガ)。
-- Depends : 056 / 057 (tasks) / 058 (is_tenant_managerial, get_my_tenant_ids,
--           is_my_store, is_tenant_parttime, tasks RLS) / 060 (RPC)
-- Rollback (逆順):
--   DROP FUNCTION IF EXISTS public.set_task_assignees(uuid, uuid[]);
--   DROP FUNCTION IF EXISTS public.is_task_assignee(uuid);
--   DROP TRIGGER  IF EXISTS trg_task_assignees_sync ON public.task_assignees;
--   DROP FUNCTION IF EXISTS public.task_assignees_sync_primary();
--   DROP TRIGGER  IF EXISTS trg_task_assignees_validate ON public.task_assignees;
--   DROP FUNCTION IF EXISTS public.task_assignees_validate();
--   -- (RLS/complete_task は 058/060 の旧定義を再 apply して戻す)
--   DROP TABLE IF EXISTS public.task_assignees;
-- ============================================================================

-- 1. テーブル ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_assignees (
  task_id    UUID NOT NULL REFERENCES public.tasks(id)  ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  tenant_id  UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignees_user
  ON public.task_assignees (user_id);
CREATE INDEX IF NOT EXISTS idx_task_assignees_task
  ON public.task_assignees (task_id);
CREATE INDEX IF NOT EXISTS idx_task_assignees_tenant
  ON public.task_assignees (tenant_id);

-- 2. 既存データ移行 ---------------------------------------------------------
INSERT INTO public.task_assignees (task_id, user_id, tenant_id, created_at)
SELECT t.id, t.assignee_user_id, t.tenant_id, t.created_at
FROM public.tasks t
WHERE t.assignee_user_id IS NOT NULL
ON CONFLICT (task_id, user_id) DO NOTHING;

-- 3. cross-tenant 検証トリガ (FK 偽装防止) ----------------------------------
CREATE OR REPLACE FUNCTION public.task_assignees_validate()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_task_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_task_tenant FROM public.tasks WHERE id = NEW.task_id;
  IF v_task_tenant IS NULL THEN
    RAISE EXCEPTION 'task not found: %', NEW.task_id USING ERRCODE='23503';
  END IF;
  IF NEW.tenant_id <> v_task_tenant THEN
    RAISE EXCEPTION 'task_assignees.tenant_id mismatch' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'assignee not a member of tenant' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_assignees_validate ON public.task_assignees;
CREATE TRIGGER trg_task_assignees_validate
  BEFORE INSERT OR UPDATE ON public.task_assignees
  FOR EACH ROW EXECUTE FUNCTION public.task_assignees_validate();

-- 4. primary assignee 同期トリガ -------------------------------------------
--    task_assignees の変更後、tasks.assignee_user_id を「最古 created_at の
--    担当者 (なければ NULL)」へ追従。後方互換 (旧 RLS/集約) を生かす。
CREATE OR REPLACE FUNCTION public.task_assignees_sync_primary()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_task_id uuid := COALESCE(NEW.task_id, OLD.task_id);
  v_primary uuid;
BEGIN
  SELECT user_id INTO v_primary
  FROM public.task_assignees
  WHERE task_id = v_task_id
  ORDER BY created_at ASC, user_id ASC
  LIMIT 1;

  -- assignee_user_id 列のみ更新 (status トリガ等を起こさない)
  UPDATE public.tasks
  SET assignee_user_id = v_primary
  WHERE id = v_task_id
    AND assignee_user_id IS DISTINCT FROM v_primary;

  RETURN NULL; -- AFTER trigger
END;
$$;

DROP TRIGGER IF EXISTS trg_task_assignees_sync ON public.task_assignees;
CREATE TRIGGER trg_task_assignees_sync
  AFTER INSERT OR DELETE OR UPDATE ON public.task_assignees
  FOR EACH ROW EXECUTE FUNCTION public.task_assignees_sync_primary();

-- 5. RLS ---------------------------------------------------------------------
ALTER TABLE public.task_assignees ENABLE ROW LEVEL SECURITY;

-- 担当者判定ヘルパ (SECURITY DEFINER 4 行テンプレ)
CREATE OR REPLACE FUNCTION public.is_task_assignee(p_task_id uuid)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.task_assignees
    WHERE task_id = p_task_id AND user_id = auth.uid()
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_task_assignee(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_task_assignee(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_task_assignee(uuid) TO authenticated;

-- task_assignees の RLS は「親 task が見えるなら見える / 書込は managerial or
-- 自店舗 staff (tasks_update と同等)」。書込は基本 RPC 経由だが直アクセスも閉じる。
DROP POLICY IF EXISTS task_assignees_select ON public.task_assignees;
CREATE POLICY task_assignees_select ON public.task_assignees
  FOR SELECT USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id)  -- RLS は tasks 側で評価
  );

DROP POLICY IF EXISTS task_assignees_insert ON public.task_assignees;
CREATE POLICY task_assignees_insert ON public.task_assignees
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND NOT is_tenant_parttime(tenant_id)
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_id
        AND ( is_tenant_managerial(t.tenant_id)
              OR (t.store_id IS NOT NULL AND is_my_store(t.store_id)) )
    )
  );

DROP POLICY IF EXISTS task_assignees_delete ON public.task_assignees;
CREATE POLICY task_assignees_delete ON public.task_assignees
  FOR DELETE USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND NOT is_tenant_parttime(tenant_id)
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_id
        AND ( is_tenant_managerial(t.tenant_id)
              OR (t.store_id IS NOT NULL AND is_my_store(t.store_id)) )
    )
  );
-- UPDATE は運用上発生しない (PK 2 列のみ) が、横串のため明示的に拒否相当の no-policy で塞ぐ
-- (UPDATE policy を作らない = UPDATE 不可)。

-- 6. tasks RLS を task_assignees ベースに更新 (assignee_user_id 単独判定を置換) --
DROP POLICY IF EXISTS tasks_select ON public.tasks;
CREATE POLICY tasks_select ON public.tasks
  FOR SELECT USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      store_id IS NULL
      OR is_tenant_managerial(tenant_id)
      OR is_my_store(store_id)
      OR is_task_assignee(id)
    )
  );

DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      is_tenant_managerial(tenant_id)
      OR (NOT is_tenant_parttime(tenant_id) AND store_id IS NOT NULL AND is_my_store(store_id))
      OR is_task_assignee(id)
    )
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      is_tenant_managerial(tenant_id)
      OR (NOT is_tenant_parttime(tenant_id) AND store_id IS NOT NULL AND is_my_store(store_id))
      OR is_task_assignee(id)
    )
  );
-- tasks_insert / tasks_delete は assignee 条件を含まないため変更不要 (横串確認済)。

-- 7. complete_task を task_assignees ベースへ更新 -----------------------------
CREATE OR REPLACE FUNCTION public.complete_task(p_task_id uuid)
RETURNS public.tasks
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid; v_task public.tasks%ROWTYPE; v_is_managerial boolean; v_is_assignee boolean;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='28000'; END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TASK_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE='P0002'; END IF;

  v_is_managerial := public.is_tenant_managerial(v_task.tenant_id);
  v_is_assignee := EXISTS (
    SELECT 1 FROM public.task_assignees WHERE task_id = p_task_id AND user_id = v_user
  );
  IF NOT (v_is_managerial OR v_is_assignee) THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE='P0002';
  END IF;

  IF v_task.status = 'done'      THEN RAISE EXCEPTION 'TASK_ALREADY_DONE' USING ERRCODE='40001'; END IF;
  IF v_task.status = 'cancelled' THEN RAISE EXCEPTION 'TASK_CANCELLED'    USING ERRCODE='22023'; END IF;

  UPDATE public.tasks SET status = 'done' WHERE id = p_task_id RETURNING * INTO v_task;
  RETURN v_task;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.complete_task(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_task(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.complete_task(uuid) TO authenticated;

-- 8. 複数担当 replace RPC ----------------------------------------------------
--    p_user_ids を「その task の担当者集合」に置換 (delete 差分 + insert 差分)。
--    権限: managerial or (非 parttime かつ自店舗 staff)。tasks_update と同等。
--    cross-tenant: task_assignees_validate トリガが各 user の tenant 所属を検証。
CREATE OR REPLACE FUNCTION public.set_task_assignees(p_task_id uuid, p_user_ids uuid[])
RETURNS SETOF public.task_assignees
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid; v_task public.tasks%ROWTYPE; v_allowed boolean; v_ids uuid[];
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='28000'; END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TASK_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE='P0002'; END IF;

  v_allowed := public.is_tenant_managerial(v_task.tenant_id)
    OR ( NOT public.is_tenant_parttime(v_task.tenant_id)
         AND v_task.store_id IS NOT NULL
         AND public.is_my_store(v_task.store_id) );
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;

  -- NULL/重複を正規化
  SELECT COALESCE(array_agg(DISTINCT x), '{}')
  INTO v_ids
  FROM unnest(COALESCE(p_user_ids, '{}'::uuid[])) AS x
  WHERE x IS NOT NULL;

  -- 不要担当を削除
  DELETE FROM public.task_assignees ta
  WHERE ta.task_id = p_task_id
    AND NOT (ta.user_id = ANY(v_ids));

  -- 追加 (検証トリガが tenant 所属を担保。非メンバーは 23514 で弾く)
  INSERT INTO public.task_assignees (task_id, user_id, tenant_id)
  SELECT p_task_id, uid, v_task.tenant_id
  FROM unnest(v_ids) AS uid
  ON CONFLICT (task_id, user_id) DO NOTHING;

  RETURN QUERY
    SELECT * FROM public.task_assignees WHERE task_id = p_task_id ORDER BY created_at ASC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_task_assignees(uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_task_assignees(uuid, uuid[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_task_assignees(uuid, uuid[]) TO authenticated;
