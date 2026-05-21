/**
 * useTasks / useTaskMutations
 *
 * Phase 1 Loop 3 — 全社タスク管理のフロント基盤 (Engineer A)
 *
 * - useTasks: フィルタ付き一覧取得 (tenantId / storeId / status / assigneeUserId)
 * - useTaskMutations: CRUD + RPC (complete / reopen / bulk_assign)
 *
 * 設計書: .company/engineering/docs/2026-05-22-kintai-task-management-phase1-techdesign.md
 * 既存パターン参照: useLeave.ts (CRUD + notify) / useShiftPreference.ts (FriendlyError 連携)
 *
 * 落とし穴対策 (MEMORY):
 *  - supabase-js mutate silent success → .select() で RETURNING を取り 0 行を明示エラー化
 *  - bulk_assign_tasks の重複 ID → Array.from(new Set(taskIds)) で dedupe (Loop 2 Reviewer P2)
 *  - RPC エラーは SQLSTATE (error.code) を見て user-friendly メッセージに変換
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { formatSupabaseError, type FriendlyError } from '../lib/errors';
import type { Task, TaskStatus, TaskPriority, TaskInsert, TaskUpdate } from '../types';

// ---------------------------------------------------------------------------
// 型定義 — Task/TaskStatus/TaskPriority は types/index.ts 経由 (narrow union)
// TaskInput は hook 内部用 (UI から hook へ渡す引数の整形)
// ---------------------------------------------------------------------------

export interface TaskInput {
  tenantId: string;
  projectId?: string | null;
  storeId?: string | null;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  assigneeUserId?: string | null;
  dueDate?: string | null; // YYYY-MM-DD
}

export interface UseTasksOptions {
  tenantId?: string;
  storeId?: string;
  status?: TaskStatus[];
  assigneeUserId?: string;
}

export interface UseTasksResult {
  tasks: Task[];
  isLoading: boolean;
  error: FriendlyError | null;
  refetch: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// SQLSTATE → 日本語メッセージマッピング (RPC ごと)
// ---------------------------------------------------------------------------

/** complete_task の SQLSTATE → ユーザー向け文言 */
const COMPLETE_TASK_MESSAGES: Record<string, string> = {
  P0002: 'タスクが見つかりません、または権限がありません。',
  '40001': 'すでに完了しています。',
  '22023': 'キャンセルされたタスクは完了できません。',
  '42501': '権限がありません。',
};

/** reopen_task の SQLSTATE → ユーザー向け文言 */
const REOPEN_TASK_MESSAGES: Record<string, string> = {
  P0002: 'タスクが見つかりません、または権限がありません。',
  '42501': '権限がありません。',
  '22023': '完了済のタスクのみ再開できます。',
};

/** bulk_assign_tasks の SQLSTATE → ユーザー向け文言 */
const BULK_ASSIGN_MESSAGES: Record<string, string> = {
  '42501': '権限がありません。',
  '22023': 'アサインが無効です。',
  P0002: '対象のタスクが見つかりません。',
};

/**
 * Supabase エラーを SQLSTATE マップで翻訳。
 * マップにない場合は formatSupabaseError() でフォールバック。
 */
function translateRpcError(err: unknown, codeMap: Record<string, string>): Error {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';
  if (code && codeMap[code]) {
    const e = new Error(codeMap[code]);
    (e as Error & { code?: string }).code = code;
    return e;
  }
  const friendly = formatSupabaseError(err);
  const e = new Error(friendly.message);
  if (friendly.code) (e as Error & { code?: string }).code = friendly.code;
  return e;
}

// ---------------------------------------------------------------------------
// useTasks — 一覧取得 hook
// ---------------------------------------------------------------------------

/**
 * フィルタ付きタスク一覧を取得する hook。
 *
 * - opts.status を渡さない場合は全 status 取得 (RLS による絞り込みのみ)
 * - 並び順は priority DESC, due_date ASC NULLS LAST, created_at DESC (設計書 §2-2 INDEX 準拠)
 */
export function useTasks(opts?: UseTasksOptions): UseTasksResult {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<FriendlyError | null>(null);

  // opts.status は配列なので参照同一性に注意 (毎レンダで新しい配列だと無限ループ)
  // 呼び出し側で useMemo するのが望ましいが、ここでも防衛的に key 化する
  const statusKey = useMemo(
    () => (opts?.status ? [...opts.status].sort().join(',') : ''),
    [opts?.status],
  );

  const fetchTasks = useCallback(async () => {
    if (!opts?.tenantId) {
      setTasks([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('tasks')
        .select('*')
        .eq('tenant_id', opts.tenantId);

      // storeId の 3 状態:
      //   string: 指定店舗 OR 全社タスク (store_id IS NULL) を表示
      //   null:   全社タスクのみ (store_id IS NULL)
      //   undefined: 全件 (フィルタなし)
      if (typeof opts.storeId === 'string') {
        query = query.or(`store_id.is.null,store_id.eq.${opts.storeId}`);
      } else if (opts.storeId === null) {
        query = query.is('store_id', null);
      }
      if (opts.assigneeUserId) {
        query = query.eq('assignee_user_id', opts.assigneeUserId);
      }
      if (opts.status && opts.status.length > 0) {
        query = query.in('status', opts.status);
      }

      // priority DESC, due_date ASC NULLS LAST, created_at DESC
      query = query
        .order('priority', { ascending: false })
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });

      const { data, error: e } = await query;
      if (e) throw e;
      setTasks((data as Task[]) ?? []);
    } catch (err: unknown) {
      setError(formatSupabaseError(err));
      setTasks([]);
    } finally {
      setIsLoading(false);
    }
    // statusKey は status 配列の参照変化を吸収するための依存。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts?.tenantId, opts?.storeId, opts?.assigneeUserId, statusKey]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  return {
    tasks,
    isLoading,
    error,
    refetch: fetchTasks,
  };
}

// ---------------------------------------------------------------------------
// useTaskMutations — CRUD + RPC
// ---------------------------------------------------------------------------

export interface UseTaskMutationsResult {
  createTask: (input: TaskInput) => Promise<Task>;
  updateTask: (taskId: string, patch: Partial<TaskInput>) => Promise<Task>;
  deleteTask: (taskId: string) => Promise<void>;
  completeTask: (taskId: string) => Promise<Task>;
  reopenTask: (taskId: string) => Promise<Task>;
  bulkAssignTasks: (taskIds: string[], assigneeUserId: string) => Promise<Task[]>;
}

/**
 * Task の CRUD + RPC ミューテーション群。
 *
 * - 0 行検知: RLS で弾かれた場合 supabase-js は silent success を返すため
 *   .select() で RETURNING を取り、null/空配列なら明示エラー化する。
 * - RPC エラーは SQLSTATE を翻訳して throw する。呼び出し元の try/catch で受ける想定。
 */
export function useTaskMutations(): UseTaskMutationsResult {
  const createTask = useCallback(async (input: TaskInput): Promise<Task> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const insertRow: TaskInsert = {
      tenant_id: input.tenantId,
      project_id: input.projectId ?? null,
      store_id: input.storeId ?? null,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 1,
      status: input.status ?? 'todo',
      assignee_user_id: input.assigneeUserId ?? null,
      due_date: input.dueDate ?? null,
      created_by: user.id,
    };

    const { data, error } = await supabase
      .from('tasks')
      .insert(insertRow)
      .select()
      .single();
    if (error) throw new Error(`タスクの作成に失敗しました: ${error.message}`);
    if (!data) throw new Error('タスクの作成に失敗しました (RETURNING 0 行)');
    return data as Task;
  }, []);

  const updateTask = useCallback(
    async (taskId: string, patch: Partial<TaskInput>): Promise<Task> => {
      const updateRow: TaskUpdate = {};
      if (patch.projectId !== undefined) updateRow.project_id = patch.projectId;
      if (patch.storeId !== undefined) updateRow.store_id = patch.storeId;
      if (patch.title !== undefined) updateRow.title = patch.title;
      if (patch.description !== undefined) updateRow.description = patch.description;
      if (patch.priority !== undefined) updateRow.priority = patch.priority;
      if (patch.status !== undefined) updateRow.status = patch.status;
      if (patch.assigneeUserId !== undefined)
        updateRow.assignee_user_id = patch.assigneeUserId;
      if (patch.dueDate !== undefined) updateRow.due_date = patch.dueDate;

      const { data, error } = await supabase
        .from('tasks')
        .update(updateRow)
        .eq('id', taskId)
        .select()
        .single();
      if (error) {
        // PGRST116 = 0 行 (RLS で弾かれた / 存在しない)
        if ((error as { code?: string }).code === 'PGRST116') {
          throw new Error('タスクが見つかりません、または権限がありません。');
        }
        throw new Error(`タスクの更新に失敗しました: ${error.message}`);
      }
      if (!data) {
        throw new Error('タスクが見つかりません、または権限がありません。');
      }
      return data as Task;
    },
    [],
  );

  const deleteTask = useCallback(async (taskId: string): Promise<void> => {
    // .select() で RETURNING を取り 0 行なら silent failure を検知
    const { data, error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId)
      .select('id');
    if (error) throw new Error(`タスクの削除に失敗しました: ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error('タスクが見つかりません、または権限がありません。');
    }
  }, []);

  const completeTask = useCallback(async (taskId: string): Promise<Task> => {
    const { data, error } = await supabase.rpc('complete_task', {
      p_task_id: taskId,
    });
    if (error) throw translateRpcError(error, COMPLETE_TASK_MESSAGES);
    if (!data) throw new Error('タスクの完了処理に失敗しました。');
    return data as Task;
  }, []);

  const reopenTask = useCallback(async (taskId: string): Promise<Task> => {
    const { data, error } = await supabase.rpc('reopen_task', {
      p_task_id: taskId,
    });
    if (error) throw translateRpcError(error, REOPEN_TASK_MESSAGES);
    if (!data) throw new Error('タスクの再開処理に失敗しました。');
    return data as Task;
  }, []);

  const bulkAssignTasks = useCallback(
    async (taskIds: string[], assigneeUserId: string): Promise<Task[]> => {
      // 重複 ID dedupe (Loop 2 Reviewer P2 指摘対応)
      const dedupedIds = Array.from(new Set(taskIds));
      if (dedupedIds.length === 0) return [];

      const { data, error } = await supabase.rpc('bulk_assign_tasks', {
        p_task_ids: dedupedIds,
        p_assignee: assigneeUserId,
      });
      if (error) throw translateRpcError(error, BULK_ASSIGN_MESSAGES);
      return (data as Task[] | null) ?? [];
    },
    [],
  );

  return {
    createTask,
    updateTask,
    deleteTask,
    completeTask,
    reopenTask,
    bulkAssignTasks,
  };
}
