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
  assigneeUserIds?: string[];
  dueDate?: string | null; // YYYY-MM-DD
  parentTaskId?: string | null; // 068: 子タスク作成時のみ指定 (createTask 専用)
}

export interface UseTasksOptions {
  tenantId?: string;
  /**
   * 3 状態:
   *   string    = 当該店舗のみ (store_id = X) — 全社は含まない
   *   null      = 全社のみ (store_id IS NULL)
   *   undefined = 全件 (tenant 配下すべて)
   */
  storeId?: string | null;
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
// task_assignees ネストから assignee_user_ids 配列を組み立てる共通ヘルパ
// (created_at 昇順 → user_id。無ければ空配列。詰め忘れ厳禁)
// ---------------------------------------------------------------------------

type RawAssignee = { user_id: string; created_at: string };

function buildAssigneeUserIds(raw: RawAssignee[] | null | undefined): string[] {
  return (raw ?? [])
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
    .map((a) => a.user_id);
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

/** set_task_assignees の SQLSTATE → ユーザー向け文言 */
const SET_TASK_ASSIGNEES_MESSAGES: Record<string, string> = {
  '42501': '権限がありません',
  P0002: '対象タスクが見つかりません',
  '23514': 'テナントに所属しないメンバーは指定できません',
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
 * - 担当者フィルタ (assigneeUserId) は task_assignees を含む複数担当に対し
 *   「含む」判定でクライアントフィルタ (取得は全件)。
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
        .select('*, task_assignees(user_id, created_at)')
        .eq('tenant_id', opts.tenantId);

      // storeId の 3 状態:
      //   string: 指定店舗タスクのみ (store_id = X) — 全社は含まない
      //   null:   全社タスクのみ (store_id IS NULL)
      //   undefined: 全件 (フィルタなし)
      if (typeof opts.storeId === 'string') {
        query = query.eq('store_id', opts.storeId);
      } else if (opts.storeId === null) {
        query = query.is('store_id', null);
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

      // task_assignees ネストを assignee_user_ids 配列へ集約 (created_at 昇順 / 空配列保証)
      const mapped = ((data as unknown as Record<string, unknown>[]) ?? []).map((row) => {
        const { task_assignees, ...rest } = row as { task_assignees?: RawAssignee[] | null } & Record<string, unknown>;
        return { ...rest, assignee_user_ids: buildAssigneeUserIds(task_assignees) } as Task;
      });

      // 068 子タスク: 親ごとに子を集計し subtask_total/done を親へ付与。
      // B4 修正 (subtask-pill-undercount-status-filter):
      //   旧実装は同一クエリ結果 (mapped) 内の子だけで集計していたため、
      //   status / store フィルタで取得スコープから落ちた子を過少カウントしていた。
      //   → 親 id 集合に対し子を「フィルタ無条件」で別クエリ取得し、
      //     status / 件数だけを軽量に集計する (本体一覧は従来どおり filter 適用)。
      const parentIds = mapped.filter((t) => !t.parent_task_id).map((t) => t.id);

      // 親ごとの { total, done } 集計。子が存在しない親は 0/0。
      const countsByParent = new Map<string, { total: number; done: number }>();
      if (parentIds.length > 0) {
        const { data: childRows, error: childErr } = await supabase
          .from('tasks')
          .select('parent_task_id, status')
          .eq('tenant_id', opts.tenantId)
          .in('parent_task_id', parentIds);
        if (childErr) throw childErr;

        for (const row of (childRows as { parent_task_id: string | null; status: string }[] | null) ?? []) {
          if (!row.parent_task_id) continue;
          const acc = countsByParent.get(row.parent_task_id) ?? { total: 0, done: 0 };
          // 分母: cancelled も含む全子数 (デフォルト)。
          acc.total += 1;
          if (row.status === 'done') acc.done += 1;
          countsByParent.set(row.parent_task_id, acc);
        }
      }

      const withCounts = mapped.map((t) => {
        if (t.parent_task_id) return t; // 子は集計対象外
        const c = countsByParent.get(t.id) ?? { total: 0, done: 0 };
        return {
          ...t,
          subtask_total: c.total,
          subtask_done: c.done,
        };
      });

      // 担当者フィルタ: 複数担当に対し「含む」判定でクライアント側で絞る
      const filtered = opts.assigneeUserId
        ? withCounts.filter((task) => task.assignee_user_ids.includes(opts.assigneeUserId!))
        : withCounts;

      setTasks(filtered);
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
  countChildren: (parentTaskId: string) => Promise<number | null>;
}

/**
 * Task の CRUD + RPC ミューテーション群。
 *
 * - 0 行検知: RLS で弾かれた場合 supabase-js は silent success を返すため
 *   .select() で RETURNING を取り、null/空配列なら明示エラー化する。
 * - 担当者の書込は set_task_assignees RPC (SECURITY DEFINER) に集約。RPC は
 *   delete+insert で replace し、cross-tenant 等を RAISE EXCEPTION するので
 *   フロントは SQLSTATE を翻訳して throw する。
 * - RPC エラーは SQLSTATE を翻訳して throw する。呼び出し元の try/catch で受ける想定。
 */
export function useTaskMutations(): UseTaskMutationsResult {
  const createTask = useCallback(async (input: TaskInput): Promise<Task> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // assignee_user_id は primary (後方互換) で task_assignees のトリガ同期に委ねる。
    // 新規担当は set_task_assignees RPC で replace するため insert では null 固定。
    const insertRow: TaskInsert = {
      tenant_id: input.tenantId,
      project_id: input.projectId ?? null,
      store_id: input.storeId ?? null,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 1,
      status: input.status ?? 'todo',
      assignee_user_id: null,
      due_date: input.dueDate ?? null,
      parent_task_id: input.parentTaskId ?? null, // 068: 子タスク作成時のみ非 null
      created_by: user.id,
    };

    const { data, error } = await supabase
      .from('tasks')
      .insert(insertRow)
      .select()
      .single();
    if (error) throw new Error(`タスクの作成に失敗しました: ${error.message}`);
    if (!data) throw new Error('タスクの作成に失敗しました (RETURNING 0 行)');

    const { data: rpcData, error: rpcErr } = await supabase.rpc('set_task_assignees', {
      p_task_id: data.id,
      p_user_ids: input.assigneeUserIds ?? [],
    });
    if (rpcErr) throw translateRpcError(rpcErr, SET_TASK_ASSIGNEES_MESSAGES);

    const assignee_user_ids = buildAssigneeUserIds(rpcData as RawAssignee[] | null);
    return { ...data, assignee_user_ids } as Task;
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
      // assignee_user_id (primary) は task_assignees トリガ同期に委ねるため直接書かない。
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

      if (patch.assigneeUserIds !== undefined) {
        // 担当者指定あり → set_task_assignees で replace し RPC の返りから集約
        const { data: rpcData, error: rpcErr } = await supabase.rpc('set_task_assignees', {
          p_task_id: taskId,
          p_user_ids: patch.assigneeUserIds,
        });
        if (rpcErr) throw translateRpcError(rpcErr, SET_TASK_ASSIGNEES_MESSAGES);

        const assignee_user_ids = buildAssigneeUserIds(rpcData as RawAssignee[] | null);
        return { ...data, assignee_user_ids } as Task;
      }

      // 担当者未指定 → 担当者は触らず、現状の task_assignees を再取得して詰める
      const { data: selectData, error: selectError } = await supabase
        .from('tasks')
        .select('*, task_assignees(user_id, created_at)')
        .eq('id', taskId)
        .single();

      if (selectError || !selectData) {
        return { ...data, assignee_user_ids: [] } as Task;
      }

      const { task_assignees, ...rest } = selectData as { task_assignees?: RawAssignee[] | null } & Record<string, unknown>;
      return { ...rest, assignee_user_ids: buildAssigneeUserIds(task_assignees) } as Task;
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

  const countChildren = useCallback(async (parentTaskId: string): Promise<number | null> => {
    try {
      const { count, error } = await supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('parent_task_id', parentTaskId);
      if (error || count == null) return null;
      return count;
    } catch {
      return null;
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

  // bulk_assign_tasks (098): task_assignees を真実源とする replace に統一。
  // 各 task の担当者集合を assigneeUserId 1 名へ置換 (既存の他担当は削除)。
  // tasks.assignee_user_id (primary) は task_assignees の同期トリガに委ねる。
  // 戻り値は同期後の SETOF tasks (シグネチャ不変)。
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
    countChildren,
  };
}
