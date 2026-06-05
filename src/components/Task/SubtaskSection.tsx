import { format, parseISO } from 'date-fns';
import { Calendar, Check, Plus } from 'lucide-react';
import type { Task, TaskPriority } from '../../types';
import { ActionMenu, type ActionMenuItem } from '../ui';

export interface SubtaskSectionProps {
  parentTask: Task;
  /** tasks.filter(t => t.parent_task_id === parentTask.id) */
  children: Task[];
  /** userId → 表示名 */
  memberNames: Map<string, string>;
  /** 子の完了 (既存 handleComplete を渡す) */
  onComplete: (childId: string) => void;
  /** 子の再開 (既存 handleReopen) */
  onReopen: (childId: string) => void;
  /** 子の編集ダイアログを開く (openEdit) */
  onEditChild: (child: Task) => void;
  /** 子の削除確認を開く (setDeletingTaskId) */
  onDeleteChild: (child: Task) => void;
  /** 「+子タスクを追加」: 親情報を初期値に create ダイアログを開く */
  onAddChild: () => void;
  /** 子ごとの完了/操作可否 (既存 canActOnTask) */
  canAct: (t: Task) => boolean;
  canManage: boolean;
  /** 削除可否判定用 (canManage || child.created_by === currentUserId) */
  currentUserId?: string | null;
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

/**
 * 親タスク行展開部 / kanban Dialog 内で共有する子タスク一覧。
 * 子行 = 完了チェック / タイトル / 担当 / 期限 / 優先度 / 「…」メニュー、末尾に「+子タスクを追加」。
 */
export function SubtaskSection({
  parentTask,
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
}: SubtaskSectionProps): JSX.Element {
  const showAddButton = canManage || canAct(parentTask);

  return (
    <div className="space-y-1 border-l-2 border-stone-200 py-1 pl-6 dark:border-stone-700">
      {children.map((child) => {
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
          <div
            key={child.id}
            className="grid grid-cols-[20px_minmax(0,1fr)_auto_auto_auto_40px] items-center gap-2 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/50"
          >
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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

            <span
              className={`truncate text-[12.5px] ${
                isDone || isCancelled
                  ? 'text-stone-400 line-through'
                  : 'text-stone-800 dark:text-stone-200'
              }`}
              title={child.title}
            >
              {child.title}
            </span>

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

            <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
              {child.due_date && (
                <>
                  <Calendar className="h-[11px] w-[11px]" aria-hidden="true" />
                  <time dateTime={child.due_date}>{format(parseISO(child.due_date), 'MM/dd')}</time>
                </>
              )}
            </span>

            <span className="inline-flex items-center" title={`優先度 ${child.priority}`}>
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${priorityDotColor[child.priority]}`} />
            </span>

            <span className="flex items-center justify-center">
              {menuItems.length > 0 && (
                <ActionMenu
                  items={menuItems}
                  triggerSize="sm"
                  align="end"
                  triggerLabel="子タスク操作"
                  bottomSheetTitle="子タスク操作"
                />
              )}
            </span>
          </div>
        );
      })}

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
