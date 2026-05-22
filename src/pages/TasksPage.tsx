/**
 * TasksPage — kintai タスク管理 Phase 2 Loop 4 (Engineer A)
 *
 * Kanban / List 切替トグル + StoreTabBar 統合 + localStorage persist。
 * 既存 List 機能は完全維持。
 *
 * 設計書: .company/engineering/docs/2026-05-22-kintai-task-kanban-phase2-techdesign.md §3-6
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
import { ResponsiveKanban } from '../components/Kanban/ResponsiveKanban';
import { StoreTabBar } from '../components/Kanban/StoreTabBar';
import { PrimaryActionButton } from '../components/Kanban/PrimaryActionButton';
import {
  readViewMode,
  writeViewMode,
  readStoreTab,
  writeStoreTab,
} from '../lib/kanbanStorage';
import type { ViewMode, StoreTabValue } from '../components/Kanban/types';

// ─── ダイアログ状態 ──────────────────────────────────────────

interface DialogState {
  mode: 'create' | 'edit';
  task?: Task;
}

// ─── メインページ ────────────────────────────────────────────

export function TasksPage(): JSX.Element {
  const { user } = useAuth();
  const { myRole, members, isParttime, currentTenant, myStoreIds } = useTenant();
  const { stores, currentStore } = useStoreContext();
  const { showToast } = useToast();

  const tenantId = currentTenant?.id ?? '';
  const canManage = myRole === 'owner' || myRole === 'manager';

  // ── View Mode ──
  const [viewMode, setViewMode] = useState<ViewMode>(() => readViewMode());
  const handleViewModeChange = (mode: ViewMode): void => {
    setViewMode(mode);
    writeViewMode(mode);
  };

  // ── Store Tab ──
  const [storeTab, setStoreTab] = useState<StoreTabValue>(() => readStoreTab());
  const handleStoreTabChange = (tab: StoreTabValue): void => {
    setStoreTab(tab);
    writeStoreTab(tab);
  };

  // ── バイト自動フィルタ ──
  // isParttime===true の場合は自動的に「自分のタスクのみ」を強制 ON。
  // 非バイトはチェックボックスで手動 ON/OFF。
  const [mineOnlyManual, setMineOnlyManual] = useState<boolean>(false);
  const effectiveMineOnly = isParttime || mineOnlyManual;

  // ── フィルタ状態 ──
  // 初期値: 全 status 表示 (filter.status を空にすると enabledStatuses が全件にフォールバック)。
  // 旧実装は ['todo','in_progress'] 固定で「完了タスクが見えない」と誤解される報告があったため、
  // 既定で全件表示とし、ユーザーが必要に応じて絞り込む UX に変更。
  const [filter, setFilter] = useState<TaskFilterValue>({});

  const enabledStatuses = useMemo<TaskStatus[]>(
    () => {
      // Kanban view は 4 列すべて表示するため全 status 取得
      // (List view では filter.status を尊重 / 空なら全件)
      if (viewMode === 'kanban') {
        return ['todo', 'in_progress', 'done', 'cancelled'];
      }
      return filter.status?.length ? filter.status : ['todo', 'in_progress', 'done', 'cancelled'];
    },
    [filter.status, viewMode],
  );

  // ── StoreId 解決 (storeTab → useTasks 引数) ──
  //   all     → undefined (全件: tenant 配下全て)
  //   company → null      (store_id IS NULL のみ)
  //   store   → storeTab.storeId
  // Loop 4.5 P2-6: UseTasksOptions.storeId が string | null | undefined に拡張されたため
  // 「null as unknown as string | undefined」の hack を除去。
  const storeIdForHook = useMemo<string | null | undefined>(() => {
    if (storeTab.kind === 'all') return undefined;
    if (storeTab.kind === 'company') return null;
    return storeTab.storeId;
  }, [storeTab]);

  // ── データ取得 ──
  const {
    tasks,
    isLoading: tasksLoading,
    error: tasksError,
    refetch,
  } = useTasks({
    tenantId,
    storeId: storeIdForHook,
    status: enabledStatuses,
    assigneeUserId: effectiveMineOnly ? user?.id : filter.assigneeUserId,
  });

  const { projects } = useProjects({ tenantId, storeId: currentStore?.id });

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

  // ── 件数バッジ (未完了タスク数を各タブで集計) ──
  // Loop 4.5 P2-7: 元実装は Map<StoreTabValue, number> だったが、
  // StoreTabValue は object のため参照同一性が一致せず lookup が常に miss していた。
  // StoreTabBar 側の serializeKey 規約に合わせて Map<string, number> で渡す。キー規約:
  //   'all'           → 全件未完了数
  //   'company'       → store_id IS NULL の未完了数
  //   `store:<id>`    → 当該店舗の未完了数 (StoreTabBar.serializeKey と一致)
  // 集計対象は tasks (= storeTab で絞り込まれた現在表示分)。
  // 'all' 選択中は全件、'store:xx' 選択中は当該店舗+全社が集計対象 → バッジは
  // 「現在のスコープ内の未完了数」として機能する。Phase 3 で全件集計に拡張可。
  const openTaskCountsByStore = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    let allCount = 0;
    let companyCount = 0;
    const storeCounts = new Map<string, number>();

    for (const task of tasks) {
      if (task.status === 'done' || task.status === 'cancelled') continue;
      allCount++;
      if (task.store_id === null || task.store_id === undefined) {
        companyCount++;
      } else {
        storeCounts.set(task.store_id, (storeCounts.get(task.store_id) ?? 0) + 1);
      }
    }

    map.set('all', allCount);
    map.set('company', companyCount);
    for (const [storeId, count] of storeCounts) {
      map.set(`store:${storeId}`, count);
    }
    return map;
  }, [tasks]);

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

  // ── Kanban myRole fallback (UserRole | null → 'owner' | 'manager' | 'staff') ──
  const myRoleNarrow = useMemo<'owner' | 'manager' | 'staff'>(() => {
    if (myRole === 'owner') return 'owner';
    if (myRole === 'manager') return 'manager';
    return 'staff';
  }, [myRole]);

  // ────────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* ヘッダー */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <Heading level={1}>タスク</Heading>
          <p className="text-sm text-stone-500 mt-1">
            タスクの進捗を管理します
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View 切替トグル */}
          <div className="inline-flex items-center bg-stone-100 dark:bg-stone-800 rounded-full p-1">
            <button
              type="button"
              className={`rounded-full px-4 py-1.5 text-sm font-medium motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                viewMode === 'kanban'
                  ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-50 shadow-sm'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
              }`}
              onClick={() => handleViewModeChange('kanban')}
              aria-pressed={viewMode === 'kanban'}
            >
              ボード
            </button>
            <button
              type="button"
              className={`rounded-full px-4 py-1.5 text-sm font-medium motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-50 shadow-sm'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
              }`}
              onClick={() => handleViewModeChange('list')}
              aria-pressed={viewMode === 'list'}
            >
              リスト
            </button>
          </div>
          {!isParttime && (
            <PrimaryActionButton onClick={openCreate} icon={<Plus size={16} aria-hidden="true" />}>
              新規
            </PrimaryActionButton>
          )}
        </div>
      </header>

      {/* バイト自動フィルタヒント */}
      {isParttime && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          バイトのため自分のタスクのみ表示中
        </p>
      )}

      {/* StoreTabBar */}
      <StoreTabBar
        stores={stores}
        value={storeTab}
        onChange={handleStoreTabChange}
        counts={openTaskCountsByStore}
      />

      {/* フィルタバー (List時のみ表示。Kanban時は status 列で代替) */}
      {viewMode === 'list' && (
        <div className="space-y-2">
          <TaskFilterBar
            value={filter}
            onChange={setFilter}
            projects={projects}
            members={memberOptions}
            showStoreFilter={false}
          />
          {!isParttime && (
            <div className="flex items-center">
              <Checkbox
                label="自分のタスクのみ"
                checked={mineOnlyManual}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setMineOnlyManual(e.target.checked)}
              />
            </div>
          )}
        </div>
      )}

      {/* エラー */}
      {tasksError && (
        <Card padding="sm">
          <div className="flex items-center gap-2 text-red-600">
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

      {/* View別レンダリング: Kanban */}
      {!tasksLoading && !tasksError && viewMode === 'kanban' && (
        <ResponsiveKanban
          tasks={filteredTasks}
          onTaskClick={(task) => setDialog({ mode: 'edit', task })}
          myRole={myRoleNarrow}
          isParttime={isParttime}
          currentUserId={user?.id}
          myStoreIds={myStoreIds}
          memberNames={memberNames}
          projectNames={projectNames}
          onSuccess={(m) => showToast(m, 'success')}
          onError={(m) => showToast(m, 'error')}
          onMutationSuccess={refetch}
        />
      )}

      {/* View別レンダリング: List */}
      {!tasksLoading && !tasksError && viewMode === 'list' && (
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
                <p className="text-sm text-stone-600 dark:text-stone-300">
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
