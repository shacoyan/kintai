import { format, parseISO } from 'date-fns';
import { Calendar, Check, Plus } from 'lucide-react';
import type { Task, TaskPriority, TaskStatus } from '../../types';
import { ActionMenu, type ActionMenuItem } from '../ui';
import { statusMeta } from './taskStatusMeta';

export interface SubtaskKanbanProps {
  /** 親の子配列 (childrenByParentId.get(parent.id) ?? []) */
  children: Task[];
  /** userId → 表示名 */
  memberNames: Map<string, string>;
  /** 子の完了 (既存 handleComplete) */
  onComplete: (childId: string) => void;
  /** 子の再開 (既存 handleReopen) */
  onReopen: (childId: string) => void;
  /** 子の編集ダイアログを開く (openEdit) */
  onEditChild: (child: Task) => void;
  /** 子の削除確認を開く (setDeletingTaskId) */
  onDeleteChild: (child: Task) => void;
  /** 「+子タスクを追加」 (openCreateChild(parent)) */
  onAddChild: () => void;
  /** 子ごとの完了/操作可否 (既存 canActOnTask) */
  canAct: (t: Task) => boolean;
  canManage: boolean;
  /** 削除可否判定用 (canManage || child.created_by === currentUserId) */
  currentUserId?: string | null;
  /** 「+子タスクを追加」を出すか (親に対する権限) */
  showAddButton: boolean;
}

const priorityDotColor: Record<TaskPriority, string> = {
  3: 'bg-red-500',
  2: 'bg-orange-500',
  1: 'bg-stone-400',
  0: 'bg-blue-400',
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

/** priority DESC → due_date ASC NULLS LAST (KanbanBoard.sortTasks 流用) */
function sortTasks(a: Task, b: Task): number {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }
  const dateA = a.due_date;
  const dateB = b.due_date;
  if (dateA && dateB) return dateA < dateB ? -1 : dateA > dateB ? 1 : 0;
  if (dateA) return -1;
  if (dateB) return 1;
  return 0;
}

interface SubtaskCardProps {
  child: Task;
  memberNames: Map<string, string>;
  onComplete: (childId: string) => void;
  onReopen: (childId: string) => void;
  onEditChild: (child: Task) => void;
  onDeleteChild: (child: Task) => void;
  canAct: (t: Task) => boolean;
  canManage: boolean;
  currentUserId?: string | null;
}

/**
 * 子1件 = compact カード。完了チェック + タイトル + 担当 + 期限 + 優先度ドット + 「…」メニュー。
 * カード全体の onClick は付けない（誤操作防止。操作はチェック/メニューに限定）。
 * 権限判定は SubtaskSection と完全同一ロジック。
 */
function SubtaskCard({
  child,
  memberNames,
  onComplete,
  onReopen,
  onEditChild,
  onDeleteChild,
  canAct,
  canManage,
  currentUserId,
}: SubtaskCardProps): JSX.Element {
  const isDone = child.status === 'done';
  const isCancelled = child.status === 'cancelled';
  const childCanAct = canAct(child);
  const canEdit = isDone || isCancelled ? canManage : childCanAct;
  const canDelete = canManage || child.created_by === currentUserId;
  const assignees = (child.assignee_user_ids ?? []).map((id) => ({
    userId: id,
    name: memberNames.get(id) ?? '?',
  }));

  const menuItems: ActionMenuItem[] = [];
  if (canEdit) menuItems.push({ key: 'edit', label: '編集', onSelect: () => onEditChild(child) });
  if (canDelete) menuItems.push({ key: 'delete', label: '削除', tone: 'danger', onSelect: () => onDeleteChild(child) });

  return (
    <div className="flex items-start gap-2 rounded-[8px] border border-stone-200/70 bg-white px-2 py-2 dark:border-stone-700/60 dark:bg-stone-800">
      <button
        type="button"
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        onClick={(e) => {
          e.stopPropagation();
          if (isDone) {
            if (canManage) onReopen(child.id);
          } else if (childCanAct) {
            onComplete(child.id);
          }
        }}
        disabled={isDone ? !canManage : !childCanAct}
        aria-label={isDone ? '子タスクを再開' : '子タスクを完了'}
      >
        {isDone ? (
          <span className="flex h-4 w-4 items-center justify-center rounded-[4px] border border-emerald-600 bg-emerald-600">
            <Check className="h-[11px] w-[11px] text-white" aria-hidden="true" />
          </span>
        ) : (
          <span className="h-4 w-4 rounded-[4px] border-[1.5px] border-stone-300 bg-transparent dark:border-stone-600" />
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={`break-words text-[12.5px] leading-snug ${
            isDone || isCancelled
              ? 'text-stone-400 line-through'
              : 'text-stone-800 dark:text-stone-200'
          }`}
          title={child.title}
        >
          {child.title}
        </span>
        <div className="flex items-center gap-2">
          {assignees.length > 0 && (
            <span className="flex items-center -space-x-1.5">
              {assignees.slice(0, 2).map((a) => (
                <span
                  key={a.userId}
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold dark:border-stone-900 ${getAvatarColor(a.userId)}`}
                  title={a.name}
                >
                  {a.name.slice(0, 1)}
                </span>
              ))}
              {assignees.length > 2 && (
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-stone-200 text-[10px] font-semibold text-stone-600 dark:border-stone-900 dark:bg-stone-700 dark:text-stone-300"
                  title={assignees.slice(2).map((a) => a.name).join(', ')}
                >
                  +{assignees.length - 2}
                </span>
              )}
            </span>
          )}
          {child.due_date && (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
              <Calendar className="h-[11px] w-[11px]" aria-hidden="true" />
              <time dateTime={child.due_date}>{format(parseISO(child.due_date), 'MM/dd')}</time>
            </span>
          )}
          <span className="inline-flex items-center" title={`優先度 ${child.priority}`}>
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${priorityDotColor[child.priority]}`} />
          </span>
        </div>
      </div>

      {menuItems.length > 0 && (
        <span className="flex shrink-0 items-center">
          <ActionMenu
            items={menuItems}
            triggerSize="sm"
            align="end"
            triggerLabel="子タスク操作"
            bottomSheetTitle="子タスク操作"
          />
        </span>
      )}
    </div>
  );
}

/**
 * SubtaskKanban — 子タスク専用の軽量看板（DnD 不使用 / Phase 1）。
 *
 * 設計書: .company/engineering/docs/2026-06-10-kintai-task-detail-subtask-kanban.md §4
 *
 * - 子を status 別カラム（未着手 / 進行中 / 完了）に振り分け表示。
 * - cancelled は子が 1 件以上あるときだけ動的に 4 列目を出す。
 * - 各カードは完了チェックトグル + 「…」メニュー（編集/削除）。
 * - PC（md+）= 横並び grid、SP（< md）= 縦積み。横スクロールなし。
 * - 既存 Kanban の見た目（KanbanColumn / KanbanCard）クラスを参考、useSortable/useDroppable は使わない。
 */
export function SubtaskKanban({
  children,
  memberNames,
  onComplete,
  onReopen,
  onEditChild,
  onDeleteChild,
  onAddChild,
  canAct,
  canManage,
  currentUserId,
  showAddButton,
}: SubtaskKanbanProps): JSX.Element {
  const showCancelled = children.some((c) => c.status === 'cancelled');

  const baseStatuses: TaskStatus[] = ['todo', 'in_progress', 'done'];
  const columnStatuses: TaskStatus[] = showCancelled ? [...baseStatuses, 'cancelled'] : baseStatuses;

  const columnMap: Record<TaskStatus, Task[]> = {
    todo: [],
    in_progress: [],
    done: [],
    cancelled: [],
  };
  for (const child of children) {
    columnMap[child.status].push(child);
  }
  for (const status of columnStatuses) {
    columnMap[status].sort(sortTasks);
  }

  const gridCols = showCancelled ? 'md:grid-cols-4' : 'md:grid-cols-3';

  return (
    <div className="space-y-3">
      <div className={`grid grid-cols-1 gap-3 ${gridCols}`}>
        {columnStatuses.map((status) => {
          const meta = statusMeta[status];
          const colTasks = columnMap[status];
          return (
            <div
              key={status}
              className="flex flex-col overflow-hidden rounded-[10px] border border-stone-200/70 bg-stone-100 dark:border-stone-700/60 dark:bg-stone-800/60"
            >
              {/* カラムヘッダー */}
              <div className="flex items-center gap-2 border-b border-stone-200/70 bg-white px-3 py-2.5 dark:border-stone-700/60 dark:bg-stone-800">
                <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${meta.dot}`} />
                <span className="text-[12px] font-semibold text-stone-700 dark:text-stone-200">{meta.label}</span>
                <span className="font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
                  {colTasks.length}
                </span>
              </div>

              {/* カラム本体 */}
              <div className="flex flex-1 flex-col gap-2 p-2">
                {colTasks.length === 0 ? (
                  <div className="rounded-[8px] border border-dashed border-stone-300 p-4 text-center text-[11px] text-stone-400 dark:border-stone-700 dark:text-stone-500">
                    なし
                  </div>
                ) : (
                  colTasks.map((child) => (
                    <SubtaskCard
                      key={child.id}
                      child={child}
                      memberNames={memberNames}
                      onComplete={onComplete}
                      onReopen={onReopen}
                      onEditChild={onEditChild}
                      onDeleteChild={onDeleteChild}
                      canAct={canAct}
                      canManage={canManage}
                      currentUserId={currentUserId}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showAddButton && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddChild();
          }}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[12px] font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          子タスクを追加
        </button>
      )}
    </div>
  );
}
