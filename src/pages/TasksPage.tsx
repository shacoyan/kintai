/**
 * TasksPage — kintai タスク管理 Phase 1 Loop 4 (Engineer A)
 *
 * 全社タスクの一覧表示 + 新規作成 + 編集 + 完了 / 再開 + 削除。
 *
 * - Engineer C の TaskFilterBar / TaskCard / TaskList / TaskDialog は未完成のため、
 *   本ファイル内に inline コンポーネント (TaskRow / TaskDialog / 削除確認) を fallback として実装。
 *   Engineer C 完成後は TaskRow → TaskCard、TaskDialog → 共通 TaskDialog に差し替え可能な構造。
 *
 * - 権限制御 (§3-5):
 *   - isParttime === true: 「+ 新規」ボタン非表示 / 自分が assignee でないタスクのアクションを非表示
 *   - owner / manager: 全タスクの編集 / 完了 / 再開 / 削除可
 *
 * 設計書: .company/engineering/docs/2026-05-22-kintai-task-management-phase1-techdesign.md
 */

import React, { useState, useMemo, useCallback, type ChangeEvent } from 'react';
import { format, parseISO, isBefore, startOfDay } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Plus, Pencil, Check, RotateCcw, Trash2, AlertTriangle } from 'lucide-react';
import { useTasks, useTaskMutations, type TaskInput } from '../hooks/useTasks';
import { useProjects } from '../hooks/useProjects';
import { useTenant } from '../contexts/TenantContext';
import { useStoreContext } from '../contexts/StoreContext';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../contexts/ToastContext';
import {
  Button,
  Input,
  Textarea,
  Select,
  Checkbox,
  Badge,
  Card,
  EmptyState,
  Heading,
  Spinner,
} from '../components/ui';
import type {
  Task,
  TaskStatus,
  TaskPriority,
  TenantMember,
  Project,
  Store,
} from '../types';
import {
  TASK_STATUS_LABELS,
  TASK_PRIORITY_LABELS,
} from '../types';

// ─── ヘルパー ────────────────────────────────────────────────

/** 優先度に応じた Badge の tone を返す。緊急=danger / 高=warning / 通常・低=neutral */
const priorityTone = (p: TaskPriority): 'danger' | 'warning' | 'neutral' =>
  p === 3 ? 'danger' : p === 2 ? 'warning' : 'neutral';

/** ステータスに応じた Badge の tone を返す。 */
const statusTone = (s: TaskStatus): 'neutral' | 'info' | 'success' =>
  s === 'in_progress' ? 'info' : s === 'done' ? 'success' : 'neutral';

/** 期限切れ (今日より前) 判定。due_date は YYYY-MM-DD 文字列。 */
const isOverdue = (d: string | null | undefined): boolean =>
  d ? isBefore(parseISO(d), startOfDay(new Date())) : false;

/** YYYY-MM-DD → M/d(曜日) 形式に整形 */
const fmtDate = (d: string | null | undefined): string =>
  d ? format(parseISO(d), 'M/d(E)', { locale: ja }) : '';

/** members 配列から user_id → display_name を引く */
const memberName = (
  members: TenantMember[],
  userId: string | null | undefined,
): string =>
  userId
    ? members.find((m) => m.user_id === userId)?.display_name ?? '不明'
    : '未割当';

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
  // ステータスは複数選択 (todo/in_progress 初期 ON、done/cancelled 初期 OFF)
  const [statusFilter, setStatusFilter] = useState<Record<TaskStatus, boolean>>({
    todo: true,
    in_progress: true,
    done: false,
    cancelled: false,
  });
  const [projectIdFilter, setProjectIdFilter] = useState<string>('');
  const [mineOnly, setMineOnly] = useState<boolean>(false);

  // useTasks の status 依存配列の参照同一性を確保 (useMemo)
  const enabledStatuses = useMemo<TaskStatus[]>(
    () => (Object.keys(statusFilter) as TaskStatus[]).filter((k) => statusFilter[k]),
    [statusFilter],
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
    assigneeUserId: mineOnly ? user?.id : undefined,
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
    if (!projectIdFilter) return tasks;
    return tasks.filter((t) => t.project_id === projectIdFilter);
  }, [tasks, projectIdFilter]);

  // ── ダイアログ状態 ──
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [actingTaskId, setActingTaskId] = useState<string | null>(null);

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
      setActingTaskId(id);
      try {
        await completeTask(id);
        showToast('タスクを完了にしました', 'success');
        await refetch();
      } catch (err) {
        const message = err instanceof Error ? err.message : '完了処理に失敗しました';
        showToast(message, 'error');
      } finally {
        setActingTaskId(null);
      }
    },
    [completeTask, refetch, showToast],
  );

  const handleReopen = useCallback(
    async (id: string) => {
      setActingTaskId(id);
      try {
        await reopenTask(id);
        showToast('タスクを再開しました', 'success');
        await refetch();
      } catch (err) {
        const message = err instanceof Error ? err.message : '再開処理に失敗しました';
        showToast(message, 'error');
      } finally {
        setActingTaskId(null);
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

  // チェックボックスのトグル
  const toggleStatus = (s: TaskStatus): void => {
    setStatusFilter((prev) => ({ ...prev, [s]: !prev[s] }));
  };

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

      {/* フィルタバー (TaskFilterBar が完成したら差し替え) */}
      <Card padding="sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* ステータス multi-checkbox */}
          <div className="flex flex-wrap items-center gap-x-3">
            {(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((s) => (
              <Checkbox
                key={s}
                label={TASK_STATUS_LABELS[s]}
                checked={statusFilter[s]}
                onChange={() => toggleStatus(s)}
              />
            ))}
          </div>

          <div className="h-6 w-px bg-neutral-200 dark:bg-neutral-700" />

          {/* プロジェクトフィルタ */}
          <div className="min-w-[180px]">
            <Select
              aria-label="プロジェクトで絞り込み"
              value={projectIdFilter}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                setProjectIdFilter(e.target.value)
              }
              options={[
                { value: '', label: '全プロジェクト' },
                ...projects.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </div>

          <div className="h-6 w-px bg-neutral-200 dark:bg-neutral-700" />

          {/* 自分のみ */}
          <Checkbox
            label="自分のタスクのみ"
            checked={mineOnly}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setMineOnly(e.target.checked)}
          />
        </div>
      </Card>

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

      {/* 一覧 (TaskList が完成したら差し替え) */}
      {!tasksLoading && !tasksError && (
        filteredTasks.length === 0 ? (
          <EmptyState
            title="タスクはありません"
            description="条件を変更するか、新しいタスクを作成してください。"
          />
        ) : (
          <Card padding="none">
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-700">
              {filteredTasks.map((t) => (
                <li key={t.id}>
                  <TaskRow
                    task={t}
                    members={members}
                    canAct={canActOnTask(t)}
                    canManage={canManage}
                    isBusy={actingTaskId === t.id}
                    onEdit={() => openEdit(t)}
                    onComplete={() => handleComplete(t.id)}
                    onReopen={() => handleReopen(t.id)}
                    onDelete={() => openDeleteConfirm(t.id)}
                  />
                </li>
              ))}
            </ul>
          </Card>
        )
      )}

      {/* 新規/編集ダイアログ (TaskDialog が完成したら差し替え) */}
      {dialog && (
        <TaskDialog
          mode={dialog.mode}
          task={dialog.task}
          tenantId={tenantId}
          projects={projects}
          stores={stores}
          currentStoreId={storeId ?? null}
          members={members}
          saving={saving}
          canEditAll={!isParttime || dialog.mode === 'create'}
          onSave={async (input) => {
            setSaving(true);
            try {
              if (dialog.mode === 'create') {
                await createTask(input);
                showToast('タスクを作成しました', 'success');
              } else if (dialog.task) {
                await updateTask(dialog.task.id, input);
                showToast('タスクを更新しました', 'success');
              }
              await refetch();
              setDialog(null);
            } catch (err) {
              const fallback = dialog.mode === 'create' ? '作成に失敗しました' : '更新に失敗しました';
              const message = err instanceof Error ? err.message : fallback;
              showToast(message, 'error');
            } finally {
              setSaving(false);
            }
          }}
          onClose={closeDialog}
        />
      )}

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

// ─── タスク行 (inline fallback / Engineer C の TaskCard 完成後に差替) ─────

interface TaskRowProps {
  task: Task;
  members: TenantMember[];
  canAct: boolean;
  canManage: boolean;
  isBusy: boolean;
  onEdit: () => void;
  onComplete: () => void;
  onReopen: () => void;
  onDelete: () => void;
}

const TaskRow: React.FC<TaskRowProps> = ({
  task,
  members,
  canAct,
  canManage,
  isBusy,
  onEdit,
  onComplete,
  onReopen,
  onDelete,
}) => {
  const overdue = isOverdue(task.due_date);
  const isDone = task.status === 'done';

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-700/40">
      {/* 優先度 */}
      <Badge tone={priorityTone(task.priority)} withDot>
        {TASK_PRIORITY_LABELS[task.priority]}
      </Badge>

      {/* タイトル + ステータス */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`font-semibold truncate ${isDone ? 'text-neutral-500 line-through' : ''}`}>
            {task.title}
          </span>
          <Badge tone={statusTone(task.status)}>
            {TASK_STATUS_LABELS[task.status]}
          </Badge>
        </div>
      </div>

      {/* 期限 */}
      {task.due_date && (
        <span
          className={`text-xs whitespace-nowrap tabular-nums ${
            overdue && !isDone ? 'text-danger-600 font-semibold' : 'text-neutral-500'
          }`}
        >
          {fmtDate(task.due_date)}
        </span>
      )}

      {/* 担当者 */}
      <span className="text-xs text-neutral-500 whitespace-nowrap">
        {memberName(members, task.assignee_user_id)}
      </span>

      {/* アクション */}
      <div className="flex items-center gap-1">
        {canAct && !isDone && (
          <Button
            variant="tertiary"
            size="sm"
            iconLeft={<Pencil size={14} />}
            onClick={onEdit}
            disabled={isBusy}
          >
            編集
          </Button>
        )}
        {canAct && !isDone && (
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Check size={14} />}
            onClick={onComplete}
            loading={isBusy}
          >
            完了
          </Button>
        )}
        {canManage && isDone && (
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<RotateCcw size={14} />}
            onClick={onReopen}
            loading={isBusy}
          >
            再開
          </Button>
        )}
        {canManage && (
          <Button
            variant="danger"
            size="sm"
            iconLeft={<Trash2 size={14} />}
            onClick={onDelete}
            disabled={isBusy}
          >
            削除
          </Button>
        )}
      </div>
    </div>
  );
};

// ─── タスクダイアログ (inline fallback / Engineer C の TaskDialog 完成後に差替) ──

interface TaskDialogProps {
  mode: 'create' | 'edit';
  task?: Task;
  tenantId: string;
  projects: Project[];
  stores: Store[];
  currentStoreId: string | null;
  members: TenantMember[];
  saving: boolean;
  canEditAll: boolean;
  onSave: (input: TaskInput) => Promise<void>;
  onClose: () => void;
}

const TaskDialog: React.FC<TaskDialogProps> = ({
  mode,
  task,
  tenantId,
  projects,
  stores,
  currentStoreId,
  members,
  saving,
  canEditAll,
  onSave,
  onClose,
}) => {
  const [title, setTitle] = useState<string>(task?.title ?? '');
  const [description, setDescription] = useState<string>(task?.description ?? '');
  const [projectId, setProjectId] = useState<string>(task?.project_id ?? '');
  const [storeIdState, setStoreIdState] = useState<string>(
    task?.store_id ?? currentStoreId ?? '',
  );
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo');
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 1);
  const [assigneeUserId, setAssigneeUserId] = useState<string>(
    task?.assignee_user_id ?? '',
  );
  const [dueDate, setDueDate] = useState<string>(task?.due_date ?? '');
  const [titleError, setTitleError] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!title.trim()) {
      setTitleError('タイトルは必須です');
      return;
    }
    setTitleError('');
    await onSave({
      tenantId,
      projectId: canEditAll ? (projectId || null) : (task?.project_id ?? null),
      storeId: canEditAll ? (storeIdState || null) : (task?.store_id ?? null),
      title: canEditAll ? title.trim() : (task?.title ?? title.trim()),
      description: description.trim() || null,
      priority: canEditAll ? priority : (task?.priority ?? 1),
      status,
      assigneeUserId: canEditAll ? (assigneeUserId || null) : (task?.assignee_user_id ?? null),
      dueDate: canEditAll ? (dueDate || null) : (task?.due_date ?? null),
    });
  };

  // 選択肢
  const statusOptions = (Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((s) => ({
    value: s,
    label: TASK_STATUS_LABELS[s],
  }));

  const priorityOptions = ([0, 1, 2, 3] as TaskPriority[]).map((p) => ({
    value: String(p),
    label: TASK_PRIORITY_LABELS[p],
  }));

  const memberOptions = [
    { value: '', label: '未割当' },
    ...members.map((m) => ({ value: m.user_id, label: m.display_name ?? '不明' })),
  ];

  const projectOptions = [
    { value: '', label: 'なし' },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  const storeOptions = [
    { value: '', label: '全社共通' },
    ...stores.map((s) => ({ value: s.id, label: s.name })),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start md:items-center justify-center bg-black/50 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <Card>
          <Card.Header>
            {mode === 'create' ? 'タスクを作成' : 'タスクを編集'}
          </Card.Header>
          <form onSubmit={handleSubmit}>
            <Card.Body>
              <div className="space-y-4">
                {!canEditAll && (
                  <div
                    role="note"
                    className="text-xs text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-800/50 p-2 rounded"
                  >
                    アルバイト権限: ステータスと説明のみ編集できます
                  </div>
                )}
                <Input
                  label="タイトル"
                  required
                  value={title}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
                  error={titleError || undefined}
                  readOnly={!canEditAll}
                  disabled={saving}
                />

                <Textarea
                  label="説明"
                  value={description}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                    setDescription(e.target.value)
                  }
                  rows={3}
                  disabled={saving}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Select
                    label="プロジェクト"
                    value={projectId}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                      setProjectId(e.target.value)
                    }
                    options={projectOptions}
                    disabled={saving || !canEditAll}
                  />
                  <Select
                    label="店舗"
                    value={storeIdState}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                      setStoreIdState(e.target.value)
                    }
                    options={storeOptions}
                    disabled={saving || !canEditAll}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Select
                    label="ステータス"
                    value={status}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                      setStatus(e.target.value as TaskStatus)
                    }
                    options={statusOptions}
                    disabled={saving}
                  />
                  <Select
                    label="優先度"
                    value={String(priority)}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                      setPriority(Number(e.target.value) as TaskPriority)
                    }
                    options={priorityOptions}
                    disabled={saving || !canEditAll}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Select
                    label="担当者"
                    value={assigneeUserId}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                      setAssigneeUserId(e.target.value)
                    }
                    options={memberOptions}
                    disabled={saving || !canEditAll}
                  />
                  <Input
                    label="期限"
                    type="date"
                    value={dueDate}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setDueDate(e.target.value)
                    }
                    disabled={saving || !canEditAll}
                  />
                </div>
              </div>
            </Card.Body>
            <Card.Footer>
              <Button
                variant="secondary"
                type="button"
                onClick={onClose}
                disabled={saving}
              >
                キャンセル
              </Button>
              <Button
                variant="primary"
                type="submit"
                loading={saving}
              >
                {mode === 'create' ? '作成' : '保存'}
              </Button>
            </Card.Footer>
          </form>
        </Card>
      </div>
    </div>
  );
};

export default TasksPage;
