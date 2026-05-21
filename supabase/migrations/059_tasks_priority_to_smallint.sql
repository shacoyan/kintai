-- 059_tasks_priority_to_smallint.sql
-- P1-1 修正 (Reviewer 指摘対応): tasks.priority を TEXT enum → SMALLINT (0=low/1=normal/2=high/3=urgent) に型変換。
-- TEXT enum は ORDER BY で文字列ソート ('high' < 'low' < 'normal' < 'urgent') になり priority 順表示が破綻するため。
-- 057 を書き直さず新規 migration を切るのは migration 履歴を本番で巻き戻さない安全運用 (既存データ 0 行のため USING 変換も安全)。

BEGIN;

-- 1. 既存 DEFAULT を一旦剥がす (TYPE 変換のため)
ALTER TABLE public.tasks ALTER COLUMN priority DROP DEFAULT;

-- 2. 既存 CHECK 制約を削除 (動的名対応のため pg_constraint から検索)
DO $$
DECLARE
  v_name TEXT;
BEGIN
  SELECT conname INTO v_name
  FROM pg_constraint
  WHERE conrelid = 'public.tasks'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%priority%';
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tasks DROP CONSTRAINT %I', v_name);
  END IF;
END $$;

-- 3. TEXT → SMALLINT 型変換 (既存値マッピング)
ALTER TABLE public.tasks
  ALTER COLUMN priority TYPE SMALLINT
  USING CASE priority
    WHEN 'low'    THEN 0
    WHEN 'normal' THEN 1
    WHEN 'high'   THEN 2
    WHEN 'urgent' THEN 3
    ELSE 1  -- 未知値は normal にフォールバック (本番 0 行のため発火しない)
  END;

-- 4. 新しい DEFAULT (1=normal) と CHECK
ALTER TABLE public.tasks ALTER COLUMN priority SET DEFAULT 1;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_priority_check
  CHECK (priority BETWEEN 0 AND 3);

-- 5. ORDER BY 用 INDEX を再構築 (priority DESC, due_date ASC NULLS LAST)
DROP INDEX IF EXISTS public.idx_tasks_tenant_open;
DROP INDEX IF EXISTS public.idx_tasks_assignee_open;
DROP INDEX IF EXISTS public.idx_tasks_store_open;

CREATE INDEX idx_tasks_tenant_open
  ON public.tasks(tenant_id, priority DESC, due_date)
  WHERE status IN ('todo','in_progress');
CREATE INDEX idx_tasks_assignee_open
  ON public.tasks(assignee_user_id, priority DESC, due_date)
  WHERE status IN ('todo','in_progress') AND assignee_user_id IS NOT NULL;
CREATE INDEX idx_tasks_store_open
  ON public.tasks(store_id, priority DESC, due_date)
  WHERE status IN ('todo','in_progress') AND store_id IS NOT NULL;

COMMIT;
