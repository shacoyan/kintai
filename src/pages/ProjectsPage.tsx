import { useState, useEffect, useCallback, useMemo } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Button,
  Select,
  EmptyState,
  ConfirmDialog,
  Card,
  Badge,
  ActionMenu,
  type ActionMenuItem,
} from '../components/ui';
import { Archive, CheckSquare, Pencil, Plus, RotateCcw, Square, Trash2 } from 'lucide-react';
import type { Project, ProjectStatus, Task, TaskStatus } from '../types';
import { ProjectDialog } from '../components/Project';
import type { ProjectInput, ProjectStoreOption } from '../components/Project';
import { useProjects, useProjectMutations } from '../hooks/useProjects';
import { useTasks } from '../hooks/useTasks';
import { useStore } from '../hooks/useStore';
import { useTenant } from '../contexts/TenantContext';
import { useToast } from '../contexts/ToastContext';
import { messages } from '../lib/messages';
import { getProjectColor } from '../lib/projectColor';

// === 2026-05-22 タスク管理 Phase 1 Loop 6 ===
// プロジェクト管理画面 (一覧 + フィルタ + ダイアログ)
// 権限:
//   - isParttime: 閲覧のみ (アクション全非表示)
//   - managerial (owner / manager): 全権 (新規/編集/アーカイブ/復活/削除/全社プロジェクト可)
//   - staff: 自店舗プロジェクト編集/アーカイブ可、削除不可、全社プロジェクトは閲覧のみ

const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done', 'cancelled'];

const PROJECT_BAR_BG: Record<string, string> = {
  'border-blue-500': 'bg-blue-500',
  'border-emerald-500': 'bg-emerald-500',
  'border-orange-500': 'bg-orange-500',
  'border-purple-500': 'bg-purple-500',
  'border-pink-500': 'bg-pink-500',
  'border-cyan-500': 'bg-cyan-500',
  'border-amber-500': 'bg-amber-500',
  'border-indigo-500': 'bg-indigo-500',
  'border-stone-300 dark:border-stone-600': 'bg-stone-400 dark:bg-stone-500',
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

function getProjectBarBg(projectId: string): string {
  return PROJECT_BAR_BG[getProjectColor(projectId).border] ?? 'bg-stone-400 dark:bg-stone-500';
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatMonthDay(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function getWeekRange(now = new Date()): { start: Date; end: Date; label: string } {
  const today = startOfLocalDay(now);
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(today);
  start.setDate(today.getDate() + mondayOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    start,
    end,
    label: `${formatMonthDay(start)} – ${formatMonthDay(end)}`,
  };
}

function parseLocalDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

interface SummaryCardProps {
  label: string;
  value: number;
  hint: string;
  tone?: 'default' | 'danger';
}

function SummaryCard({ label, value, hint, tone = 'default' }: SummaryCardProps): JSX.Element {
  return (
    <Card padding="sm" className="flex flex-col gap-1 rounded-[8px] hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="text-xs text-stone-500 dark:text-stone-400">{label}</div>
      <div
        className={`num tabular-nums text-2xl font-semibold ${
          tone === 'danger'
            ? 'text-red-600 dark:text-red-400'
            : 'text-stone-900 dark:text-stone-100'
        }`}
      >
        {value}
      </div>
      <div className="text-[10px] text-stone-400 dark:text-stone-500">{hint}</div>
    </Card>
  );
}

export function ProjectsPage() {
  const { currentTenant, myRole, isParttime, myStoreIds, members } = useTenant();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // RequireTenant ガード後の前提
  const tenantId = currentTenant!.id;
  const managerial = myRole === 'owner' || myRole === 'manager';
  const readonly = isParttime;

  // フィルタ state (URL searchParams 同期で共有・戻る・ディープリンク可)
  // status: ?status=archived/all/active (param なし=active 既定)
  // view:   ?view=list/card     (param なし=既存 localStorage 値を fallback)
  const statusFilter: ProjectStatus | 'all' = (() => {
    const s = searchParams.get('status');
    return s === 'archived' || s === 'all' || s === 'active' ? s : 'active';
  })();
  const setStatusFilter = useCallback(
    (next: ProjectStatus | 'all') => {
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          if (next === 'active') sp.delete('status');
          else sp.set('status', next);
          return sp;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const [storeFilter, setStoreFilter] = useState<string>('all'); // 'all' | 'company' | <storeId>

  const readStoredViewMode = (): 'card' | 'list' => {
    try {
      if (typeof window === 'undefined') return 'card';
      const stored = window.localStorage.getItem('kintai:projects:viewMode');
      return stored === 'card' || stored === 'list' ? stored : 'card';
    } catch {
      return 'card';
    }
  };
  const viewMode: 'card' | 'list' = (() => {
    const v = searchParams.get('view');
    if (v === 'list' || v === 'card') return v;
    return readStoredViewMode();
  })();
  const setViewMode = useCallback(
    (next: 'card' | 'list') => {
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          sp.set('view', next);
          return sp;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // 店舗一覧 fetch (useStore は呼び出し側で明示 fetch が必要)
  const { stores, fetchStores } = useStore(tenantId);
  useEffect(() => {
    void fetchStores();
  }, [fetchStores]);

  const storeIdParam: string | null | undefined =
    storeFilter === 'all' ? undefined : storeFilter === 'company' ? null : storeFilter;

  const { projects, isLoading, error, refetch } = useProjects({
    tenantId,
    storeId: storeIdParam,
    status: undefined,
  });

  const {
    tasks,
    isLoading: tasksLoading,
    error: tasksError,
  } = useTasks({
    tenantId,
    status: TASK_STATUSES,
  });

  const { createProject, updateProject, archiveProject, deleteProject } = useProjectMutations();

  // dialog / mutation state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Project | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const storeNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stores) m.set(s.id, s.name);
    return m;
  }, [stores]);

  const memberMap = useMemo(
    () => new Map(members.map((member) => [member.user_id, member.display_name])),
    [members],
  );

  const tasksByProjectId = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const task of tasks) {
      const projectId = task.project_id;
      if (projectId === null) continue;
      const list = m.get(projectId);
      if (list) {
        list.push(task);
      } else {
        m.set(projectId, [task]);
      }
    }
    return m;
  }, [tasks]);

  // 各プロジェクトの「配下タスクの最短 due」(done/cancelled は除外)。
  // list view の「期限」列 (旧: — ハードコード) を実データ表示にするための集計。
  const minDueByProjectId = useMemo(() => {
    const m = new Map<string, string>();
    for (const [projectId, list] of tasksByProjectId) {
      let min: string | null = null;
      for (const task of list) {
        if (!task.due_date) continue;
        if (task.status === 'done' || task.status === 'cancelled') continue;
        if (min === null || task.due_date < min) min = task.due_date;
      }
      if (min) m.set(projectId, min);
    }
    return m;
  }, [tasksByProjectId]);

  const getStoreLabel = useCallback(
    (storeId: string | null): string => {
      if (storeId === null) return '全社';
      return storeNameMap.get(storeId) ?? '(不明な店舗)';
    },
    [storeNameMap],
  );

  const visibleProjects = useMemo(
    () =>
      projects.filter((project) =>
        statusFilter === 'all' ? true : project.status === statusFilter,
      ),
    [projects, statusFilter],
  );

  const weekRange = useMemo(() => getWeekRange(), []);

  const taskStats = useMemo(() => {
    const weekEndExclusive = new Date(weekRange.end);
    weekEndExclusive.setDate(weekRange.end.getDate() + 1);
    const today = startOfLocalDay(new Date());

    let doing = 0;
    let doneThisWeek = 0;
    let overdue = 0;

    for (const task of tasks) {
      if (task.status === 'in_progress') doing += 1;

      if (task.status === 'done') {
        // 完了日時は completed_at を基準にする (updated_at は再編集等で動くため不正確)。
        // 旧データで completed_at が未設定の場合のみ updated_at にフォールバック。
        const completedAt = new Date(task.completed_at ?? task.updated_at);
        if (completedAt >= weekRange.start && completedAt < weekEndExclusive) {
          doneThisWeek += 1;
        }
      }

      // 期限切れ: done と cancelled は対象外 (cancelled を含めると不要な期限切れ表示になる)
      if (task.due_date && task.status !== 'done' && task.status !== 'cancelled') {
        const dueDate = parseLocalDate(task.due_date);
        if (dueDate < today) overdue += 1;
      }
    }

    return { doing, doneThisWeek, overdue };
  }, [tasks, weekRange]);

  // 権限判定 ----
  // 2026-05-22 Loop 4 P0-2 fix:
  //   staff の編集権限を「自店舗 (myStoreIds に含まれる) のみ」に厳密化。
  const canEdit = useCallback(
    (project: Project): boolean => {
      if (readonly) return false;
      if (managerial) return true;
      // staff: 自店舗 (myStoreIds に含まれる store_id) のみ編集可。
      // 全社 (store_id === null) および他店舗は不可。
      if (myRole === 'staff') {
        return project.store_id !== null && myStoreIds.includes(project.store_id);
      }
      return false;
    },
    [readonly, managerial, myRole, myStoreIds],
  );

  const canArchiveOrRestore = useCallback(
    (project: Project): boolean => canEdit(project),
    [canEdit],
  );

  // 削除は managerial のみ。isParttime は readonly に含まれるため readonly で弾く。
  const canDelete = useCallback(
    (_project: Project): boolean => {
      if (readonly) return false;
      if (isParttime) return false;
      return managerial;
    },
    [readonly, managerial, isParttime],
  );

  const handleViewModeChange = useCallback(
    (nextMode: 'card' | 'list') => {
      setViewMode(nextMode);
      try {
        window.localStorage.setItem('kintai:projects:viewMode', nextMode);
      } catch {
        // localStorage may be unavailable in private or restricted contexts.
      }
    },
    [setViewMode],
  );

  // プロジェクトカード/行クリックで該当プロジェクトのタスク一覧へ遷移 (P3-9 ディープリンク)
  const openProjectTasks = useCallback(
    (projectId: string) => {
      navigate(`/tasks?projectId=${encodeURIComponent(projectId)}`);
    },
    [navigate],
  );

  // アクション ----
  const openCreate = useCallback(() => {
    setEditingProject(undefined);
    setMutationError(null);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((project: Project) => {
    setEditingProject(project);
    setMutationError(null);
    setDialogOpen(true);
  }, []);

  // C 部品の ProjectStoreOption 形式に adapter
  const storeOptionsForDialog: ProjectStoreOption[] = useMemo(
    () => stores.map((s) => ({ id: s.id, name: s.name })),
    [stores],
  );

  const handleSave = useCallback(
    async (input: ProjectInput) => {
      setMutationBusy(true);
      setMutationError(null);
      try {
        if (editingProject) {
          await updateProject(editingProject.id, {
            name: input.name,
            description: input.description ?? null,
            status: input.status ?? 'active',
            store_id: input.storeId ?? null,
          });
        } else {
          await createProject({
            tenantId,
            storeId: input.storeId ?? null,
            name: input.name,
            description: input.description ?? null,
            status: input.status ?? 'active',
          });
        }
        await refetch();
      } catch (e) {
        const msg = e instanceof Error ? e.message : '保存に失敗しました';
        setMutationError(msg);
        throw e;
      } finally {
        setMutationBusy(false);
      }
    },
    [editingProject, tenantId, createProject, updateProject, refetch],
  );

  const handleArchiveOrRestore = useCallback(
    async (project: Project) => {
      setMutationBusy(true);
      setMutationError(null);
      try {
        if (project.status === 'active') {
          await archiveProject(project.id);
          await refetch();
          // アーカイブ後の明示フィードバック。アーカイブ解除はリスト上の
          // 復活操作（同 handler の else 分岐）で行える。
          showToast(messages.toast.projectArchived, 'success');
        } else {
          // 復活（= 上記アーカイブの取り消し導線）
          await updateProject(project.id, { status: 'active' });
          await refetch();
          showToast(messages.toast.projectRestored, 'success');
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : '操作に失敗しました';
        setMutationError(msg);
      } finally {
        setMutationBusy(false);
      }
    },
    [archiveProject, updateProject, refetch, showToast],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setMutationBusy(true);
    setMutationError(null);
    try {
      await deleteProject(deleteTarget.id);
      setDeleteTarget(null);
      await refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '削除に失敗しました';
      showToast(msg, 'error');
    } finally {
      setMutationBusy(false);
    }
  }, [deleteTarget, deleteProject, refetch, showToast]);

  const handleArchiveConfirm = useCallback(async () => {
    if (!archiveTarget) return;
    await handleArchiveOrRestore(archiveTarget);
    setArchiveTarget(null);
  }, [archiveTarget, handleArchiveOrRestore]);

  // フィルタ options ----
  const storeFilterOptions = useMemo(
    () => [
      { value: 'all', label: '全店舗' },
      { value: 'company', label: '全社のみ' },
      ...stores.map((s) => ({ value: s.id, label: s.name })),
    ],
    [stores],
  );

  const getProjectViewModel = useCallback(
    (project: Project) => {
      const editable = canEdit(project);
      const archivable = canArchiveOrRestore(project);
      const deletable = canDelete(project);
      const colorClasses = getProjectColor(project.id);
      const projectTasks = tasksByProjectId.get(project.id) ?? [];
      const doneTasks = projectTasks.filter((task) => task.status === 'done').length;
      const totalTasks = projectTasks.length;
      const openTasks = totalTasks - doneTasks;
      const pct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
      const assignees = Array.from(
        new Set(projectTasks.flatMap((task) => task.assignee_user_ids ?? [])),
      ).map((userId) => ({
        userId,
        displayName: memberMap.get(userId) ?? '?',
      }));
      const visibleAssignees = assignees.slice(0, 3);
      const hiddenAssignees = assignees.slice(3);
      const menuItems: ActionMenuItem[] = [];

      if (editable) {
        menuItems.push({
          key: 'edit',
          label: '編集',
          icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
          disabled: mutationBusy,
          onSelect: () => openEdit(project),
        });
      }
      if (archivable) {
        menuItems.push({
          key: 'archive',
          label: project.status === 'active' ? 'アーカイブ' : '復活',
          icon:
            project.status === 'active' ? (
              <Archive className="h-4 w-4" aria-hidden="true" />
            ) : (
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            ),
          disabled: mutationBusy,
          // アーカイブは軽い確認を挟む（archiveProject 呼出は不変）。復活は取消導線につき即時。
          onSelect: () => {
            if (project.status === 'active') {
              setMutationError(null);
              setArchiveTarget(project);
            } else {
              void handleArchiveOrRestore(project);
            }
          },
        });
      }
      if (deletable) {
        menuItems.push({
          key: 'delete',
          label: '削除',
          tone: 'danger',
          icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
          disabled: mutationBusy,
          onSelect: () => {
            setMutationError(null);
            setDeleteTarget(project);
          },
        });
      }

      return {
        colorClasses,
        doneTasks,
        totalTasks,
        openTasks,
        pct,
        assignees,
        visibleAssignees,
        hiddenAssignees,
        menuItems,
      };
    },
    [
      canEdit,
      canArchiveOrRestore,
      canDelete,
      tasksByProjectId,
      memberMap,
      mutationBusy,
      openEdit,
      handleArchiveOrRestore,
    ],
  );

  const renderProjectCard = (project: Project): JSX.Element => {
    const {
      colorClasses,
      doneTasks,
      totalTasks,
      openTasks,
      pct,
      assignees,
      visibleAssignees,
      hiddenAssignees,
      menuItems,
    } = getProjectViewModel(project);

    return (
      <Card
        key={project.id}
        padding="sm"
        role="button"
        tabIndex={0}
        aria-label={`${project.name} のタスクを開く`}
        onClick={() => openProjectTasks(project.id)}
        onKeyDown={(e: ReactKeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.key === ' ') e.preventDefault();
            openProjectTasks(project.id);
          }
        }}
        className={`flex cursor-pointer flex-col gap-2.5 rounded-[8px] border-t-[3px] ${colorClasses.border} transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-stone-900 ${
          project.status === 'archived' ? 'opacity-55' : ''
        }`}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="line-clamp-1 text-sm font-semibold leading-[1.3] text-stone-900 dark:text-stone-100">
              {project.name}
            </div>
            <div className="mt-1 line-clamp-2 text-xs leading-[1.4] text-stone-500 dark:text-stone-400">
              {project.description || '説明はありません'}
            </div>
          </div>
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <ActionMenu
              items={menuItems}
              triggerLabel={`${project.name} の操作`}
              triggerSize="sm"
              bottomSheetTitle="プロジェクト操作"
              disabled={menuItems.length === 0}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={project.store_id === null ? 'primary' : 'neutral'}>
            {getStoreLabel(project.store_id)}
          </Badge>
          {project.status === 'archived' && <Badge tone="warning">アーカイブ</Badge>}
        </div>

        <div className="border-t border-stone-100 dark:border-stone-800" />

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="text-xs text-stone-500 dark:text-stone-400">進捗</span>
            <span className="num tabular-nums text-xs font-semibold text-stone-600 dark:text-stone-300">
              {doneTasks} / {totalTasks} ({pct}%)
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
            <div
              className={`h-full rounded-full transition-[width] ${getProjectBarBg(project.id)}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
          <CheckSquare className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="num tabular-nums">未完了 {openTasks}</span>
          <div className="flex-1" />
          {assignees.length > 0 && (
            <div className="flex">
              {visibleAssignees.map((assignee) => (
                <div
                  key={assignee.userId}
                  className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold first:ml-0 -ml-1.5 dark:border-stone-900 ${getAvatarColor(assignee.userId)}`}
                  title={assignee.displayName}
                  aria-label={assignee.displayName}
                >
                  {assignee.displayName.charAt(0)}
                </div>
              ))}
              {hiddenAssignees.length > 0 && (
                <div
                  className="flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-white bg-stone-200 text-[10px] font-semibold text-stone-700 -ml-1.5 dark:border-stone-900"
                  title={hiddenAssignees.map((assignee) => assignee.displayName).join(', ')}
                  aria-label={`他 ${hiddenAssignees.length} 人`}
                >
                  +{hiddenAssignees.length}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    );
  };

  const renderProjectListRow = (project: Project): JSX.Element => {
    const { doneTasks, totalTasks, pct, visibleAssignees, hiddenAssignees, menuItems } =
      getProjectViewModel(project);

    return (
      <div
        key={project.id}
        role="button"
        tabIndex={0}
        aria-label={`${project.name} のタスクを開く`}
        onClick={() => openProjectTasks(project.id)}
        onKeyDown={(e: ReactKeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.key === ' ') e.preventDefault();
            openProjectTasks(project.id);
          }
        }}
        className={`grid cursor-pointer items-center gap-3 border-b border-stone-100 px-4 py-2.5 last:border-b-0 hover:bg-stone-50 motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:border-stone-800 dark:hover:bg-stone-800/50 ${
          project.status === 'archived' ? 'opacity-55' : ''
        }`}
        style={{ gridTemplateColumns: '20px minmax(260px, 1fr) 120px 100px 100px 70px 40px' }}
      >
        <div className="flex items-center justify-center text-stone-400 dark:text-stone-500">
          {pct === 100 ? (
            <CheckSquare className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Square className="h-4 w-4" aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-stone-900 dark:text-stone-50">
            {project.name}
          </div>
          <div className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">
            {getStoreLabel(project.store_id)}
          </div>
        </div>

        <div>
          <Badge
            tone={
              project.status === 'archived'
                ? 'warning'
                : project.store_id === null
                  ? 'primary'
                  : 'neutral'
            }
          >
            {project.status === 'archived'
              ? 'アーカイブ'
              : project.store_id === null
                ? '全社'
                : '稼働中'}
          </Badge>
        </div>

        <div className="flex flex-col gap-1">
          <span className="num tabular-nums text-[11px] font-semibold text-stone-700 dark:text-stone-200">
            {doneTasks}/{totalTasks} ({pct}%)
          </span>
          <div className="h-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
            <div
              className={`h-full rounded-full ${getProjectBarBg(project.id)}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {(() => {
          const minDue = minDueByProjectId.get(project.id);
          if (!minDue) {
            return (
              <div className="num tabular-nums text-xs text-stone-600 dark:text-stone-300">—</div>
            );
          }
          const dueDate = parseLocalDate(minDue);
          const overdue = dueDate < startOfLocalDay(new Date());
          return (
            <div
              className={`num tabular-nums text-xs ${
                overdue ? 'text-red-600 dark:text-red-400' : 'text-stone-600 dark:text-stone-300'
              }`}
              title={overdue ? '期限切れのタスクがあります' : undefined}
            >
              {dueDate.getMonth() + 1}/{dueDate.getDate()}
            </div>
          );
        })()}

        <div className="flex">
          {visibleAssignees.map((assignee) => (
            <div
              key={assignee.userId}
              className={`flex h-5 w-5 items-center justify-center rounded-full border-2 border-white text-[9px] font-semibold first:ml-0 -ml-1.5 dark:border-stone-900 ${getAvatarColor(assignee.userId)}`}
              title={assignee.displayName}
              aria-label={assignee.displayName}
            >
              {assignee.displayName.charAt(0)}
            </div>
          ))}
          {hiddenAssignees.length > 0 && (
            <div
              className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-stone-200 text-[9px] font-semibold text-stone-700 -ml-1.5 dark:border-stone-900"
              title={hiddenAssignees.map((assignee) => assignee.displayName).join(', ')}
              aria-label={`他 ${hiddenAssignees.length} 人`}
            >
              +{hiddenAssignees.length}
            </div>
          )}
        </div>

        <div
          className="flex justify-end"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <ActionMenu
            items={menuItems}
            triggerLabel={`${project.name} の操作`}
            triggerSize="sm"
            bottomSheetTitle="プロジェクト操作"
            disabled={menuItems.length === 0}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-3.5 px-4 py-4 md:px-6 md:py-6">
      {mutationError && (
        <div
          role="alert"
          className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-800/20 dark:text-red-200"
        >
          {mutationError}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-800/20 dark:text-red-200"
        >
          プロジェクトの取得に失敗しました: {error.message}
        </div>
      )}
      {tasksError && (
        <div
          role="alert"
          className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-800/20 dark:text-red-200"
        >
          タスクの取得に失敗しました: {tasksError.message}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-40 md:w-48">
          <Select
            options={storeFilterOptions}
            value={storeFilter}
            size="sm"
            className="text-xs"
            aria-label="店舗"
            onChange={(e) => setStoreFilter(e.target.value)}
          />
        </div>
        <button
          type="button"
          className={`h-8 rounded-full border px-3 text-xs font-medium motion-safe:transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-stone-900 ${
            statusFilter === 'archived'
              ? 'border-blue-600 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300'
              : 'border-stone-300 bg-transparent text-stone-600 hover:border-stone-400 hover:bg-stone-50 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800'
          }`}
          onClick={() => setStatusFilter(statusFilter === 'archived' ? 'active' : 'archived')}
          aria-pressed={statusFilter === 'archived'}
        >
          {statusFilter === 'archived' ? '✓ アーカイブを表示' : 'アーカイブを表示'}
        </button>
        <div className="min-w-0 flex-1" />
        <div className="inline-flex shrink-0 items-center rounded-full bg-stone-100 p-1 dark:bg-stone-800">
          <button
            type="button"
            className={`h-7 rounded-full px-3 text-[13px] font-medium motion-safe:transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              viewMode === 'card'
                ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-50 shadow-sm'
                : 'text-stone-500 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
            }`}
            onClick={() => handleViewModeChange('card')}
            aria-pressed={viewMode === 'card'}
          >
            カード
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
        {managerial && !readonly && (
          <Button
            variant="primary"
            size="md"
            onClick={openCreate}
            iconLeft={<Plus className="h-4 w-4" aria-hidden="true" />}
          >
            新規プロジェクト
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard
          label="プロジェクト数"
          value={projects.filter((project) => project.status === 'active').length}
          hint="稼働中"
        />
        <SummaryCard label="進行中タスク" value={taskStats.doing} hint="全社" />
        <SummaryCard label="今週完了" value={taskStats.doneThisWeek} hint={weekRange.label} />
        <SummaryCard label="期限切れ" value={taskStats.overdue} hint="要対応" tone="danger" />
      </div>

      {isLoading || tasksLoading ? (
        <div className="py-12 text-center text-sm text-stone-500 dark:text-stone-400">
          読み込み中…
        </div>
      ) : visibleProjects.length === 0 ? (
        <EmptyState
          title="プロジェクトがありません"
          description={
            managerial && !readonly
              ? '「新規プロジェクト」から最初のプロジェクトを作成してください。'
              : '現在のフィルタに該当するプロジェクトはありません。'
          }
          action={
            managerial && !readonly
              ? {
                  label: '新規プロジェクト',
                  onClick: openCreate,
                  iconRight: <Plus className="h-4 w-4" aria-hidden="true" />,
                }
              : statusFilter !== 'active'
                ? {
                    label: '稼働中のみ表示',
                    onClick: () => setStatusFilter('active'),
                    variant: 'tertiary',
                  }
                : undefined
          }
        />
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {visibleProjects.map((project) => renderProjectCard(project))}
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {visibleProjects.map((project) => renderProjectCard(project))}
          </div>

          <div className="hidden overflow-hidden rounded-[8px] border border-stone-200 bg-white md:block dark:border-stone-700 dark:bg-stone-900">
            <div
              className="grid items-center gap-3 border-b border-stone-200 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-stone-500 dark:border-stone-700 dark:text-stone-400"
              style={{
                gridTemplateColumns: '20px minmax(260px, 1fr) 120px 100px 100px 70px 40px',
              }}
            >
              <div />
              <div>プロジェクト</div>
              <div>ステータス</div>
              <div>進捗</div>
              <div>期限</div>
              <div>メンバー</div>
              <div />
            </div>
            {visibleProjects.map((project) => renderProjectListRow(project))}
          </div>
        </div>
      )}

      <ProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={editingProject ? 'edit' : 'create'}
        project={editingProject}
        stores={storeOptionsForDialog}
        tenantId={tenantId}
        canCreateGlobal={managerial}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="プロジェクトを削除"
        description={
          <span>
            <span className="font-medium text-stone-900 dark:text-stone-100">
              {deleteTarget?.name ?? ''}
            </span>{' '}
            を削除します。この操作は取り消せません。
          </span>
        }
        confirmLabel="削除"
        variant="danger"
        loading={mutationBusy}
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={!!archiveTarget}
        title="プロジェクトをアーカイブ"
        description={
          <span>
            <span className="font-medium text-stone-900 dark:text-stone-100">
              {archiveTarget?.name ?? ''}
            </span>{' '}
            をアーカイブしますか？アーカイブ後もリストの「復活」から元に戻せます。
          </span>
        }
        confirmLabel="アーカイブ"
        loading={mutationBusy}
        onConfirm={() => void handleArchiveConfirm()}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
}
