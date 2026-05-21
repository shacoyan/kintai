/**
 * TasksPage — kintai タスク管理 Phase 1 Loop 6 (Engineer A)
 *
 * 純粋リファクタ: 既存の inline 実装を Engineer C の components/Task/* に置換。
 * 機能変更は一切なし。挙動を完全維持。
 */

import { useState, useMemo, useCallback, type ChangeEvent } from 'react';
import { Plus, AlertTriangle } from 'lucide-react';
import { useTasks, useTaskMutations, type TaskInput } from '../hooks/useTasks';
import { useProjects } from '../hooks/useProjects';
import { useTenant } from '../contexts/TenantContext';
import { useStoreContext } from '../contexts/StoreContext';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../contexts/ToastContext';
import {
  Button,
  Checkbox,
  Card,
  Heading,
  Spinner,
} from '../components/ui';
import type {
  Task,
  TaskStatus,
} from '../types';
import {
  TaskCard,
  TaskList,
  TaskFilterBar,
  TaskDialog,
  type TaskInput as ComponentsTaskInput,
  type TaskFilterValue,
  type MemberOption,
  type StoreOption,
} from '../components/Task';

// ─── ダイアログ状態 ──────────────────────────────────────────

interface DialogState {
  mode: 'create' | 'edit';
  task?: Task;
}

// ─── メインページ ────────────────────────────────────────────

export function TasksPage(): JSX.Element {
  const { user } = useAuth();
  const { myRole, members, isParttime, currentTenant } = useTenant();
  const { stores, currentStore } = useStoreContext();
  const { showToast } = useToast();

  const tenantId = currentTenant?.id ?? '';
  const storeId = currentStore?.id;
  const canManage = myRole === 'owner' || myRole === 'manager';

  // ── フィルタ状態 ──
  const [filter, setFilter] = useState<TaskFilterValue>({
    status: ['todo', 'in_progress'],
  });
  const [mineOnly, setMineOnly] = useState<boolean>(false);

  const enabledStatuses = useMemo<TaskStatus[]>(
    () => filter.status?.length ? filter.status : ['todo', 'in_progress', 'done', 'cancelled'],
    [filter.status],
  );

  // ── データ取得 ──
  const {
    tasks,
    isLoading: tasksLoading,
    error: tasksError,
    refetch,
  } = useTasks({
    tenantId,
    storeId,
    status: enabledStatuses,
    assigneeUserId: mineOnly ? user?.id : filter.assigneeUserId,
  });

  const { projects } = useProjects({ tenantId, storeId });

  const {
    createTask,
    updateTask,
    deleteTask,
    completeTask,
    reopenTask,
  } = useTaskMutations();

  // プロジェクトフィルタはクライアントサイドで適用
  const filteredTasks = useMemo<Task[]>(() => {
    if (!filter.projectId) return tasks;
    return tasks.filter((t) => t.project_id === filter.projectId);
  }, [tasks, filter.projectId]);

  // ── Adapter ──
  const memberOptions = useMemo<MemberOption[]>(
    () => members.map((m) => ({ id: m.user_id, name: m.display_name ?? '不明' })),
    [members],
  );

  const storeOptions = useMemo<StoreOption[]>(
    () => stores.map((s) => ({ id: s.id, name: s.name })),
    [stores],
  );

  const memberNames = useMemo(
    () => new Map(members.map((m) => [m.user_id, m.display_name ?? '不明'])),
    [members],
  );

  const projectNames = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  // ── ダイアログ状態 ──
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);

  const openCreate = (): void => setDialog({ mode: 'create' });
  const openEdit = (task: Task): void => setDialog({ mode: 'edit', task });
  const closeDialog = (): void => {
    if (!saving) setDialog(null);
  };

  const openDeleteConfirm = (id: string): void => setDeletingTaskId(id);
  const closeDeleteConfirm = (): void => {
    if (!deleting) setDeletingTaskId(null);
  };

  // ── 完了 / 再開 ──
  const handleComplete = useCallback(
    async (id: string) => {
      try {
        await completeTask(id);
        showToast('タスクを完了にしました', 'success');
        await refetch();
      } catch (err) {
        const message = err instanceof Error ? err.message : '完了処理に失敗しました';
        showToast(message, 'error');
      }
    },
    [completeTask, refetch, showToast],
  );

  const handleReopen = useCallback(
    async (id: string) => {
      try {
        await reopenTask(id);
        showToast('タスクを再開しました', 'success');
        await refetch();
      } catch (err) {
        const message = err instanceof Error ? err.message : '再開処理に失敗しました';
        showToast(message, 'error');
      }
    },
    [reopenTask, refetch, showToast],
  );

  const handleDelete = useCallback(async () => {
    if (!deletingTaskId) return;
    setDeleting(true);
    try {
      await deleteTask(deletingTaskId);
      showToast('タスクを削除しました', 'success');
      await refetch();
      setDeletingTaskId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '削除に失敗しました';
      showToast(message, 'error');
    } finally {
      setDeleting(false);
    }
  }, [deletingTaskId, deleteTask, refetch, showToast]);

  // バイトの場合: 自分が担当でないタスクのアクションは非表示
  const canActOnTask = useCallback(
    (t: Task): boolean => {
      if (canManage) return true;
      if (!user?.id) return false;
      return t.assignee_user_id === user.id;
    },
    [canManage, user?.id],
  );

  // ────────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* ヘッダー */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <Heading level={1}>タスク</Heading>
          <p className="text-sm text-neutral-500 mt-1">
            タスクの進捗を管理します
          </p>
        </div>
        {!isParttime && (
          <Button
            variant="primary"
            iconLeft={<Plus size={16} />}
            onClick={openCreate}
          >
            新規
          </Button>
        )}
      </header>

      {/* フィルタバー */}
      <div className="space-y-2">
        <TaskFilterBar
          value={filter}
          onChange={setFilter}
          projects={projects}
          members={memberOptions}
          showStoreFilter={false}
        />
        <div className="flex items-center">
          <Checkbox
            label="自分のタスクのみ"
            checked={mineOnly}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setMineOnly(e.target.checked)}
          />
        </div>
      </div>

      {/* エラー */}
      {tasksError && (
        <Card padding="sm">
          <div className="flex items-center gap-2 text-danger-600">
            <AlertTriangle size={16} />
            <span className="text-sm">
              {tasksError.message ?? 'タスクの取得に失敗しました'}
            </span>
          </div>
        </Card>
      )}

      {/* ローディング */}
      {tasksLoading && (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      )}

      {/* 一覧 */}
      {!tasksLoading && !tasksError && (
        <TaskList
          tasks={filteredTasks}
          memberNames={memberNames}
          projectNames={projectNames}
          emptyMessage="タスクはありません"
          renderItem={(t) => {
            const canAct = canActOnTask(t);
            const isDone = t.status === 'done';
            return (
              <TaskCard
                key={t.id}
                task={t}
                onClick={canAct && !isDone ? () => openEdit(t) : undefined}
                onComplete={canAct && !isDone ? () => handleComplete(t.id) : undefined}
                onReopen={canManage && isDone ? () => handleReopen(t.id) : undefined}
                onDelete={canManage ? () => openDeleteConfirm(t.id) : undefined}
                canEdit={canAct && !isDone}
                canComplete={canAct || canManage}
                canDelete={canManage}
                assigneeName={t.assignee_user_id ? memberNames.get(t.assignee_user_id) : undefined}
                projectName={t.project_id ? projectNames.get(t.project_id) : undefined}
              />
            );
          }}
        />
      )}

      {/* 新規/編集ダイアログ */}
      <TaskDialog
        open={dialog !== null}
        onOpenChange={(o) => { if (!o) closeDialog(); }}
        mode={dialog?.mode ?? 'create'}
        task={dialog?.mode === 'edit' ? dialog.task : undefined}
        tenantId={tenantId}
        projects={projects}
        members={memberOptions}
        stores={storeOptions}
        canEditAll={dialog !== null && (!isParttime || dialog.mode === 'create')}
        defaultStoreId={currentStore?.id ?? null}
        defaultAssigneeUserId={null}
        onSave={async (input: ComponentsTaskInput) => {
          setSaving(true);
          try {
            const isCreate = dialog?.mode === 'create';
            const safe: TaskInput = (!isParttime || isCreate)
              ? input
              : {
                  ...input,
                  title: dialog?.task?.title ?? input.title,
                  projectId: dialog?.task?.project_id ?? null,
                  storeId: dialog?.task?.store_id ?? null,
                  priority: dialog?.task?.priority ?? 1,
                  assigneeUserId: dialog?.task?.assignee_user_id ?? null,
                  dueDate: dialog?.task?.due_date ?? null,
                };

            if (isCreate) {
              await createTask(safe);
              showToast('タスクを作成しました', 'success');
            } else if (dialog?.task) {
              await updateTask(dialog.task.id, safe);
              showToast('タスクを更新しました', 'success');
            }
            await refetch();
            setDialog(null);
          } catch (err) {
            const fallback = dialog?.mode === 'create' ? '作成に失敗しました' : '更新に失敗しました';
            const message = err instanceof Error ? err.message : fallback;
            showToast(message, 'error');
          } finally {
            setSaving(false);
          }
        }}
      />

      {/* 削除確認 */}
      {deletingTaskId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={closeDeleteConfirm}
        >
          <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <Card>
              <Card.Header>タスクを削除しますか？</Card.Header>
              <Card.Body>
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  この操作は取り消せません。本当に削除してもよろしいですか？
                </p>
              </Card.Body>
              <Card.Footer>
                <Button
                  variant="secondary"
                  onClick={closeDeleteConfirm}
                  disabled={deleting}
                >
                  キャンセル
                </Button>
                <Button
                  variant="danger"
                  loading={deleting}
                  onClick={handleDelete}
                >
                  削除
                </Button>
              </Card.Footer>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

export default TasksPage;
