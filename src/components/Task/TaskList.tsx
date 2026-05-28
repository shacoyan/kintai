import { ClipboardList } from 'lucide-react';
import type { Task, TaskStatus } from '../../types';
import { TASK_STATUS_LABELS } from '../../types';
import { EmptyState } from '../ui/EmptyState';
import { TaskCard } from './TaskCard';
import type { TaskCardProps } from './TaskCard';

export interface TaskListProps {
  tasks: Task[];
  /** Card に流すアクション群 (canEdit/canComplete/canDelete は task ごとに変えるなら renderItem を使う) */
  onTaskClick?: (task: Task) => void;
  onComplete?: (task: Task) => void;
  onReopen?: (task: Task) => void;
  onDelete?: (task: Task) => void;
  canEdit?: boolean;
  canComplete?: boolean;
  canDelete?: boolean;
  /** 担当者 ID -> 表示名 */
  memberNames?: Map<string, string>;
  /** プロジェクト ID -> 表示名 */
  projectNames?: Map<string, string>;
  /** ステータス別グルーピング */
  groupByStatus?: boolean;
  emptyMessage?: string;
  /** TaskCard をカスタム描画したい場合 */
  renderItem?: (task: Task) => JSX.Element;
}

const STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'done', 'cancelled'];

function buildCardProps(
  task: Task,
  props: TaskListProps,
): TaskCardProps {
  return {
    task,
    onClick: props.onTaskClick ? () => props.onTaskClick?.(task) : undefined,
    onComplete: props.onComplete ? () => props.onComplete?.(task) : undefined,
    onReopen: props.onReopen ? () => props.onReopen?.(task) : undefined,
    onDelete: props.onDelete ? () => props.onDelete?.(task) : undefined,
    canEdit: props.canEdit,
    canComplete: props.canComplete,
    canDelete: props.canDelete,
    assignees: (task.assignee_user_ids ?? []).map((id) => ({
      userId: id,
      name: props.memberNames?.get(id) ?? '?',
    })),
    projectName: task.project_id
      ? props.projectNames?.get(task.project_id)
      : undefined,
  };
}

export function TaskList(props: TaskListProps): JSX.Element {
  const { tasks, groupByStatus = false, emptyMessage, renderItem } = props;

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardList aria-hidden="true" />}
        title={emptyMessage ?? 'タスクはありません'}
        description="条件を変更するか、新しいタスクを作成してください。"
      />
    );
  }

  const render = (task: Task): JSX.Element => {
    if (renderItem) return renderItem(task);
    return <TaskCard key={task.id} {...buildCardProps(task, props)} />;
  };

  if (groupByStatus) {
    const groups = new Map<TaskStatus, Task[]>();
    STATUS_ORDER.forEach((s) => groups.set(s, []));
    tasks.forEach((t) => groups.get(t.status)?.push(t));

    return (
      <div className="space-y-6">
        {STATUS_ORDER.map((status) => {
          const items = groups.get(status) ?? [];
          if (items.length === 0) return null;
          return (
            <section key={status} aria-label={TASK_STATUS_LABELS[status]}>
              <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-2">
                {TASK_STATUS_LABELS[status]}
                <span className="ml-2 text-stone-400 dark:text-stone-500 font-normal">
                  ({items.length})
                </span>
              </h3>
              <div className="space-y-2">
                {items.map((t) => (
                  <div key={t.id}>{render(t)}</div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tasks.map((t) => (
        <div key={t.id}>{render(t)}</div>
      ))}
    </div>
  );
}
