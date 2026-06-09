/**
 * TasksPage — kintai タスク管理 Phase 2 Loop 4 (Engineer A)
 *
 * Kanban / List 切替トグル + StoreTabBar 統合 + localStorage persist。
 * 既存 List 機能は完全維持。
 *
 * 設計書: .company/engineering/docs/2026-05-22-kintai-task-kanban-phase2-techdesign.md §3-6
 */

import { useState, useMemo, useCallback, useEffect, type ChangeEvent } from 'react';
import { format, isPast, parseISO } from 'date-fns';
import {
  Plus,
  AlertTriangle,
  Filter,
  Info,
  Calendar,
  Check,
  ListChecks,
} from 'lucide-react';
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
  ActionMenu,
  type ActionMenuItem,
} from '../components/ui';
import type {
  Task,
  TaskPriority,
  TaskStatus,
} from '../types';
import {
  TaskFilterBar,
  TaskDialog,
  TaskDetailDialog,
  SubtaskSection,
  type TaskInput as ComponentsTaskInput,
  type TaskFilterValue,
  type MemberOption,
  type StoreOption,
} from '../components/Task';
import { statusMeta } from '../components/Task/taskStatusMeta';
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
import { getProjectColor } from '../lib/projectColor';

// ─── ダイアログ状態 ──────────────────────────────────────────

interface DialogState {
  mode: 'create' | 'edit' | 'detail';
  task?: Task;
  /** create mode で kanban カラム + ボタンから渡された初期 status */
  initialStatus?: TaskStatus;
  /** create mode で子タスクとして作成する場合の親 task id */
  parentTaskId?: string | null;
  /** create mode の初期 store (子タスクで親 store を継承) */
  initialStoreId?: string | null;
  /** create mode の初期 project (子タスクで親 project を継承) */
  initialProjectId?: string | null;
}

function buildTaskMenuItems(args: {
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}): ActionMenuItem[] {
  const items: ActionMenuItem[] = [];
  if (args.canEdit) items.push({ key: 'edit', label: '編集', onSelect: args.onEdit });
  if (args.canDelete) items.push({ key: 'delete', label: '削除', tone: 'danger', onSelect: args.onDelete });
  return items;
}

const priorityDotColor: Record<TaskPriority, string> = {
  3: 'bg-red-500',
  2: 'bg-orange-500',
  1: 'bg-stone-400',
  0: 'bg-blue-400',
};

const priorityLabel: Record<TaskPriority, string> = {
  3: '緊急',
  2: '高',
  1: '通常',
  0: '低',
};

const avatarColors = [
  'bg-stone-200 text-stone-700',
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-orange-100 text-orange-700',
  'bg-purple-100 text-purple-700',
  'bg-cyan-100 text-cyan-700',
  'bg-amber-100 text-amber-700',
  'bg-indigo-100 text-indigo-700',
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getAvatarColor(userId: string | null): string {
  if (!userId) return avatarColors[0];
  return avatarColors[hashString(userId) % avatarColors.length];
}

function getProjectDotColor(borderClass: string): string {
  if (borderClass.includes('border-blue-500')) return 'bg-blue-500';
  if (borderClass.includes('border-emerald-500')) return 'bg-emerald-500';
  if (borderClass.includes('border-orange-500')) return 'bg-orange-500';
  if (borderClass.includes('border-purple-500')) return 'bg-purple-500';
  if (borderClass.includes('border-pink-500')) return 'bg-pink-500';
  if (borderClass.includes('border-cyan-500')) return 'bg-cyan-500';
  if (borderClass.includes('border-amber-500')) return 'bg-amber-500';
  if (borderClass.includes('border-indigo-500')) return 'bg-indigo-500';
  return 'bg-stone-400';
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
  const [filterOpen, setFilterOpen] = useState<boolean>(false);

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

  // Issue1: 選択肢用と名前解決用を 1 回の全件取得で賄う。storeId を渡さず全件取得し、
  // 名前解決 (projectNames) は全件、ダイアログ/フィルタの選択肢 (selectableProjects) は
  // 「現在店舗 + 全社 (active のみ)」をクライアント側 memo で切り出す。
  // 他テナント混入は RLS (projects_select) で防がれるため全件保持で安全。
  const { projects } = useProjects({ tenantId });

  const {
    createTask,
    updateTask,
    deleteTask,
    completeTask,
    reopenTask,
    countChildren,
  } = useTaskMutations();

  // プロジェクトフィルタはクライアントサイドで適用
  const filteredTasks = useMemo<Task[]>(() => {
    if (!filter.projectId) return tasks;
    return tasks.filter((t) => t.project_id === filter.projectId);
  }, [tasks, filter.projectId]);

  // list / kanban のトップレベル表示は親タスクのみ (子は親展開内 / Dialog 内でのみ表示)
  const parentTasks = useMemo<Task[]>(
    () => filteredTasks.filter((t) => !t.parent_task_id),
    [filteredTasks],
  );

  // 子タスクは「全件 tasks」(フィルタ前) から親 id で再構築。
  // project/store/assignee フィルタで子が落ちても親展開内に出すため (設計 §6-2)。
  const childrenByParentId = useMemo<Map<string, Task[]>>(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.parent_task_id) continue;
      const arr = map.get(t.parent_task_id);
      if (arr) arr.push(t);
      else map.set(t.parent_task_id, [t]);
    }
    return map;
  }, [tasks]);

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

  // Issue1: ダイアログ/フィルタの選択肢用。現在店舗 + 全社 (store_id === null) の
  // active プロジェクトのみ。他店舗は除外。currentStore 未確定時は全社のみが残る。
  // 名前解決 (projectNames) は全件 Map のままなので他店舗/全社タスクのバッジ表示は壊れない。
  const selectableProjects = useMemo(
    () =>
      projects.filter(
        (p) => p.status === 'active' && (p.store_id === null || p.store_id === currentStore?.id),
      ),
    [projects, currentStore?.id],
  );

  const storeNames = useMemo(
    () => new Map(storeOptions.map((s) => [s.id, s.name])),
    [storeOptions],
  );

  // ── ダイアログ状態 ──
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  // CASCADE 削除される実際の子件数 (status/store/assignee 非依存・サーバ count)。
  // 'loading' = 取得中, number = 件数, null = 未取得 or 取得失敗。
  const [deleteChildCount, setDeleteChildCount] = useState<number | null | 'loading'>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);

  const openCreate = (initialStatus?: TaskStatus): void => setDialog({ mode: 'create', initialStatus });
  const openEdit = (task: Task): void => setDialog({ mode: 'edit', task });
  // タスククリック → 詳細ビュー（看板付き）。編集は詳細内の「編集」ボタンから。
  const openDetail = (task: Task): void => setDialog({ mode: 'detail', task });
  // 親タスクの store/project を継承して子タスク作成ダイアログを開く
  const openCreateChild = useCallback((parent: Task): void => {
    setDialog({
      mode: 'create',
      parentTaskId: parent.id,
      initialStoreId: parent.store_id ?? null,
      initialProjectId: parent.project_id ?? null,
    });
  }, []);
  const closeDialog = (): void => {
    if (!saving) setDialog(null);
  };

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

  // 削除確認モーダルを開いたら、CASCADE 対象の実子件数をサーバから取得。
  // list の status 絞り込み中でも実際に消える子数を正しく警告するため。
  useEffect(() => {
    if (!deletingTaskId) {
      setDeleteChildCount(null);
      return;
    }
    let cancelled = false;
    setDeleteChildCount('loading');
    countChildren(deletingTaskId).then((count) => {
      if (!cancelled) setDeleteChildCount(count);
    });
    return () => {
      cancelled = true;
    };
  }, [deletingTaskId, countChildren]);

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
      return (t.assignee_user_ids ?? []).includes(user.id);
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
    <div className="max-w-[1440px] mx-auto px-4 py-6 space-y-5">
      {/* ヘッダー */}
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <Heading level={1}>タスク</Heading>
          {isParttime && (
            <p className="inline-flex items-center gap-1.5 text-[12px] text-stone-500 dark:text-stone-400">
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
              バイトのため自分のタスクのみ表示中
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="min-w-0 md:flex-1">
            <StoreTabBar
              stores={stores}
              value={storeTab}
              onChange={handleStoreTabChange}
              counts={openTaskCountsByStore}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 md:gap-3">
            <div className="inline-flex shrink-0 items-center rounded-full bg-stone-100 p-1 dark:bg-stone-800">
              <button
                type="button"
                className={`h-7 rounded-full px-3 text-[13px] font-medium motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  viewMode === 'kanban'
                    ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-50 shadow-sm'
                    : 'text-stone-500 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
                }`}
                onClick={() => handleViewModeChange('kanban')}
                aria-pressed={viewMode === 'kanban'}
              >
                ボード
              </button>
              <button
                type="button"
                className={`h-7 rounded-full px-3 text-[13px] font-medium motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  viewMode === 'list'
                    ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-50 shadow-sm'
                    : 'text-stone-500 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
                }`}
                onClick={() => handleViewModeChange('list')}
                aria-pressed={viewMode === 'list'}
              >
                リスト
              </button>
            </div>

            <button
              type="button"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
              onClick={() => setFilterOpen((prev) => !prev)}
              aria-pressed={filterOpen}
            >
              <Filter className="h-4 w-4" aria-hidden="true" />
              フィルタ
            </button>

            {!isParttime && (
              <PrimaryActionButton onClick={() => openCreate()} icon={<Plus size={16} aria-hidden="true" />}>
                新規
              </PrimaryActionButton>
            )}
          </div>
        </div>
      </header>

      {filterOpen && (
        <div className="space-y-2 rounded-[10px] border border-stone-200/70 bg-white p-3 dark:border-stone-700/60 dark:bg-stone-800">
          <TaskFilterBar
            value={filter}
            onChange={setFilter}
            projects={selectableProjects}
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
        <div className="min-h-[calc(100vh-260px)]">
          <ResponsiveKanban
            tasks={parentTasks}
            onTaskClick={(task) => openDetail(task)}
            myRole={myRoleNarrow}
            isParttime={isParttime}
            currentUserId={user?.id}
            myStoreIds={myStoreIds}
            memberNames={memberNames}
            projectNames={projectNames}
            onSuccess={(m) => showToast(m, 'success')}
            onError={(m) => showToast(m, 'error')}
            onMutationSuccess={refetch}
            onAddInStatus={(status) => openCreate(status)}
            onTaskDelete={(task) => setDeletingTaskId(task.id)}
          />
        </div>
      )}

      {/* View別レンダリング: List */}
      {!tasksLoading && !tasksError && viewMode === 'list' && (
        <div className="overflow-x-auto rounded-[10px] border border-stone-200/70 bg-white dark:border-stone-700/60 dark:bg-stone-800">
          <div className="min-w-[920px]">
          <div className="grid grid-cols-[20px_32px_minmax(260px,1fr)_160px_80px_70px_80px_70px_40px] items-center gap-3 border-b border-stone-200/70 bg-stone-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-stone-500 dark:border-stone-700/60 dark:bg-stone-900 dark:text-stone-400">
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span>タイトル</span>
            <span>プロジェクト</span>
            <span>店舗</span>
            <span>優先度</span>
            <span>期限</span>
            <span>担当</span>
            <span aria-hidden="true" />
          </div>

          {parentTasks.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-stone-500 dark:text-stone-400">
              タスクはありません
            </div>
          ) : (
            parentTasks.map((t) => {
              const canAct = canActOnTask(t);
              const isDone = t.status === 'done';
              const canOpen = isDone || t.status === 'cancelled' ? canManage : canAct;
              const subtaskTotal = t.subtask_total ?? 0;
              const subtaskDone = t.subtask_done ?? 0;
              const hasSubtasks = subtaskTotal > 0;
              const projectColor = getProjectColor(t.project_id);
              const projectName = t.project_id ? projectNames.get(t.project_id) : undefined;
              const assignees = (t.assignee_user_ids ?? []).map((id) => ({
                userId: id,
                name: memberNames.get(id) ?? '?',
              }));
              const storeName = t.store_id ? storeNames.get(t.store_id) : '全社';
              const meta = statusMeta[t.status];
              const isOverdue =
                !!t.due_date &&
                isPast(parseISO(t.due_date)) &&
                t.status !== 'done' &&
                t.status !== 'cancelled';

              return (
                <div key={t.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => openDetail(t)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      openDetail(t);
                    }
                  }}
                  className={`grid grid-cols-[20px_32px_minmax(260px,1fr)_160px_80px_70px_80px_70px_40px] items-center gap-3 border-b border-l-[3px] border-b-stone-200/70 px-4 py-2.5 last:border-b-0 ${projectColor.border} cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-900/60`}
                >
                  <button
                    type="button"
                    className="flex h-5 w-5 items-center justify-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isDone) {
                        if (canManage) void handleReopen(t.id);
                      } else if (canAct) {
                        void handleComplete(t.id);
                      }
                    }}
                    disabled={isDone ? !canManage : !canAct}
                    aria-label={isDone ? 'タスクを再開' : 'タスクを完了'}
                  >
                    {isDone ? (
                      <span className="flex h-4 w-4 items-center justify-center rounded-[4px] border border-emerald-600 bg-emerald-600">
                        <Check className="h-[11px] w-[11px] text-white" aria-hidden="true" />
                      </span>
                    ) : (
                      <span className="h-4 w-4 rounded-[4px] border-[1.5px] border-stone-300 bg-transparent dark:border-stone-600" />
                    )}
                  </button>

                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${meta.text}`}>
                    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                    <span className="sr-only">{meta.label}</span>
                  </span>

                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="h-5 w-5 shrink-0" aria-hidden="true" />
                    <span
                      className={`truncate text-[13px] font-medium ${
                        isDone || t.status === 'cancelled'
                          ? 'text-stone-400 line-through'
                          : 'text-stone-900 dark:text-stone-100'
                      }`}
                    >
                      {t.title}
                    </span>
                    {hasSubtasks && (
                      <span
                        className={`inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full px-1.5 text-[10px] font-medium tabular-nums ${
                          subtaskDone === subtaskTotal
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : 'bg-stone-100 text-stone-600 dark:bg-stone-700 dark:text-stone-300'
                        }`}
                        aria-label={`子タスク${subtaskTotal}件中${subtaskDone}件完了`}
                      >
                        <ListChecks className="h-[11px] w-[11px]" aria-hidden="true" />
                        {subtaskDone}/{subtaskTotal}
                      </span>
                    )}
                  </span>

                  <span className="min-w-0">
                    {projectName && (
                      <span
                        className={`inline-flex h-[18px] max-w-full items-center gap-1 rounded-full px-1.5 text-[10px] font-medium ${projectColor.bg} ${projectColor.text}`}
                        title={projectName}
                      >
                        <span aria-hidden="true" className={`h-[5px] w-[5px] rounded-full ${getProjectDotColor(projectColor.border)}`} />
                        <span className="truncate">{projectName}</span>
                      </span>
                    )}
                  </span>

                  <span className="truncate text-[11px] text-stone-500 dark:text-stone-400">
                    {storeName}
                  </span>

                  <span className="inline-flex items-center gap-1.5 text-[11px] text-stone-700 dark:text-stone-300">
                    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${priorityDotColor[t.priority]}`} />
                    {priorityLabel[t.priority]}
                  </span>

                  <span
                    className={`inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400 ${
                      isOverdue ? 'font-semibold text-red-600 dark:text-red-400' : ''
                    }`}
                  >
                    {t.due_date && (
                      <>
                        <Calendar className="h-[11px] w-[11px]" aria-hidden="true" />
                        <time dateTime={t.due_date}>{format(parseISO(t.due_date), 'MM/dd')}</time>
                      </>
                    )}
                  </span>

                  <span className="flex items-center -space-x-1.5">
                    {assignees.slice(0, 3).map((a) => (
                      <span
                        key={a.userId}
                        className={`inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold dark:border-stone-900 ${getAvatarColor(a.userId)}`}
                        title={a.name}
                      >
                        {a.name.slice(0, 1)}
                      </span>
                    ))}
                    {assignees.length > 3 && (
                      <span
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-stone-200 text-[10px] font-semibold text-stone-600 dark:border-stone-900 dark:bg-stone-700 dark:text-stone-300"
                        title={assignees.slice(3).map((a) => a.name).join(', ')}
                      >
                        +{assignees.length - 3}
                      </span>
                    )}
                  </span>

                  <span
                    className="flex items-center justify-center"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
                  >
                    {(() => {
                      const canEdit = canOpen;
                      const canDelete = canManage || t.created_by === user?.id;
                      const menuItems = buildTaskMenuItems({
                        canEdit,
                        canDelete,
                        onEdit: () => openEdit(t),
                        onDelete: () => setDeletingTaskId(t.id),
                      });
                      if (menuItems.length === 0) return null;
                      return (
                        <ActionMenu
                          items={menuItems}
                          triggerSize="sm"
                          align="end"
                          triggerLabel="タスク操作"
                          bottomSheetTitle="タスク操作"
                        />
                      );
                    })()}
                  </span>
                </div>
                </div>
              );
            })
          )}
          </div>
        </div>
      )}

      {/* 詳細ビュー（看板付き・閲覧主体）。detail のみ描画。 */}
      {dialog?.mode === 'detail' && dialog.task && (() => {
        // P1: dialog.task は detail を開いた時点のスナップショット。子の完了/再開/削除 →
        // refetch() で tasks（subtask_total/subtask_done 含む）は最新化されるため、
        // id 解決で最新の親タスクを使い進捗バーの stale を防ぐ。
        const detailTask = tasks.find((t) => t.id === dialog.task!.id) ?? dialog.task;
        // P2: 旧 list 行の canOpen と同式で編集ボタンの出し分けを踏襲。
        const canEdit =
          detailTask.status === 'done' || detailTask.status === 'cancelled'
            ? canManage
            : canActOnTask(detailTask);
        return (
          <TaskDetailDialog
            open
            onClose={closeDialog}
            task={detailTask}
            children={childrenByParentId.get(detailTask.id) ?? []}
            memberNames={memberNames}
            projectNames={projectNames}
            storeNames={storeNames}
            onEdit={() => openEdit(detailTask)}
            canEdit={canEdit}
            onCompleteChild={(childId) => void handleComplete(childId)}
            onReopenChild={(childId) => void handleReopen(childId)}
            onEditChild={(child) => openEdit(child)}
            onDeleteChild={(child) => setDeletingTaskId(child.id)}
            onAddChild={() => openCreateChild(detailTask)}
            canAct={canActOnTask}
            canManage={canManage}
            currentUserId={user?.id}
          />
        );
      })()}

      {/* 新規/編集ダイアログ */}
      <TaskDialog
        open={dialog?.mode === 'edit' || dialog?.mode === 'create'}
        onOpenChange={(o) => { if (!o) closeDialog(); }}
        mode={dialog?.mode === 'edit' ? 'edit' : 'create'}
        task={dialog?.mode === 'edit' ? dialog.task : undefined}
        tenantId={tenantId}
        projects={selectableProjects}
        projectNames={projectNames}
        members={memberOptions}
        stores={storeOptions}
        canEditAll={dialog !== null && (!isParttime || dialog.mode === 'create')}
        defaultStoreId={
          dialog?.mode === 'create' && dialog.parentTaskId
            ? (dialog.initialStoreId ?? null)
            : (currentStore?.id ?? null)
        }
        defaultProjectId={dialog?.mode === 'create' ? (dialog.initialProjectId ?? null) : null}
        parentTaskId={dialog?.mode === 'create' ? (dialog.parentTaskId ?? null) : null}
        defaultAssigneeUserId={null}
        initialStatus={dialog?.mode === 'create' ? dialog.initialStatus : undefined}
        subtaskSection={(() => {
          const editingParent = dialog?.mode === 'edit' ? dialog.task : undefined;
          if (!editingParent || editingParent.parent_task_id) return undefined;
          return (
            <SubtaskSection
              parentTask={editingParent}
              children={childrenByParentId.get(editingParent.id) ?? []}
              memberNames={memberNames}
              onComplete={(id) => void handleComplete(id)}
              onReopen={(id) => void handleReopen(id)}
              onEditChild={(child) => openEdit(child)}
              onDeleteChild={(child) => setDeletingTaskId(child.id)}
              onAddChild={() => openCreateChild(editingParent)}
              canAct={canActOnTask}
              canManage={canManage}
              currentUserId={user?.id}
            />
          );
        })()}
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
                  // parttime は担当者を編集できない（UI も無効）→ 担当者は触らず
                  // undefined のままにして set_task_assignees RPC をスキップさせる。
                  assigneeUserIds: undefined,
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
                {(() => {
                  if (deleteChildCount === 'loading') {
                    return (
                      <p className="mb-2 text-sm text-stone-500 dark:text-stone-400">
                        子タスクの件数を確認しています…
                      </p>
                    );
                  }
                  if (deleteChildCount === null) {
                    // 取得失敗時は安全側に倒し、件数なしで CASCADE を明示警告する
                    return (
                      <p className="mb-2 flex items-start gap-1.5 text-sm font-medium text-red-600 dark:text-red-400">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>表示されていない子タスクも含め、関連する子タスクはすべて一緒に削除されます。</span>
                      </p>
                    );
                  }
                  return deleteChildCount > 0 ? (
                    <p className="mb-2 flex items-start gap-1.5 text-sm font-medium text-red-600 dark:text-red-400">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>このタスクには子タスクが {deleteChildCount} 件あります。削除すると子タスクもすべて一緒に削除されます。</span>
                    </p>
                  ) : null;
                })()}
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
                  disabled={deleting || deleteChildCount === 'loading'}
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
