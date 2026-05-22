import React from 'react';
import { format, isPast, parseISO } from 'date-fns';
import { Calendar, User } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task, TaskPriority } from '../../types';
import { TASK_PRIORITY_LABELS } from '../../types';

export interface KanbanCardProps {
  task: Task;
  onClick?: () => void;
  /** false の場合はドラッグ不可 (権限不足等)。default true */
  isDraggable?: boolean;
  assigneeName?: string;
  projectName?: string;
}

const priorityDotColor: Record<TaskPriority, string> = {
  3: 'bg-red-500',
  2: 'bg-orange-500',
  1: 'bg-stone-400',
  0: 'bg-blue-400',
};

/**
 * Kanban カラム内に表示する compact カード。
 * description / アクションボタンは出さず、タイトル + 優先度 + 期限 + 担当者のみ。
 * dnd-kit `useSortable` で draggable + sortable。
 */
export function KanbanCard({
  task,
  onClick,
  isDraggable = true,
  assigneeName,
  projectName,
}: KanbanCardProps): JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `task-${task.id}`,
    disabled: !isDraggable,
  });

  // transform に rotate(0.5deg) scale(0.98) を追加。dnd-kit の transform と合成。
  const dragTransform = isDragging
    ? `${CSS.Transform.toString(transform) ?? ''} rotate(0.5deg) scale(0.98)`.trim()
    : CSS.Transform.toString(transform);

  const style: React.CSSProperties = {
    transform: dragTransform,
    transition,
    opacity: isDragging ? 0.8 : undefined,
  };

  const isOverdue =
    !!task.due_date &&
    isPast(parseISO(task.due_date)) &&
    task.status !== 'done' &&
    task.status !== 'cancelled';

  const isClickable = !!onClick;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // ドラッグ後のクリック誤発火を避ける
    if (isDragging) return;
    if (onClick) onClick();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    void e;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isClickable || !onClick) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={isClickable ? handleClick : undefined}
      onKeyDown={isClickable ? handleKeyDown : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-disabled={!isDraggable || undefined}
      aria-label={isClickable ? `タスク: ${task.title}` : undefined}
      className={`
        bg-white dark:bg-stone-800
        rounded-[10px]
        border ${isDragging ? 'border-stone-300/80 dark:border-stone-600' : 'border-stone-300/80 dark:border-stone-700/60'}
        ${isDragging ? 'shadow-[0_12px_28px_rgba(0,0,0,0.16)]' : 'shadow-[0_1px_2px_rgba(0,0,0,0.04)]'}
        p-3
        select-none
        motion-safe:transition-all motion-safe:duration-150 motion-safe:ease-out
        ${!isDraggable
          ? 'cursor-not-allowed opacity-90'
          : 'cursor-grab active:cursor-grabbing motion-safe:hover:-translate-y-px hover:border-stone-300 dark:hover:border-stone-600 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]'}
        ${isClickable ? 'focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus:outline-none' : ''}
      `}
    >
      {/* ヘッダー: 優先度ドット + タイトル */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <span
            aria-hidden="true"
            className={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${priorityDotColor[task.priority]}`}
            title={TASK_PRIORITY_LABELS[task.priority]}
          />
          <h3 className="text-[13px] font-medium text-stone-900 dark:text-stone-100 leading-snug line-clamp-2 min-w-0">
            {task.title}
          </h3>
        </div>
      </div>

      {/* プロジェクト名 (任意) */}
      {projectName && (
        <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate mt-1.5">
          {projectName}
        </p>
      )}

      {/* メタ情報: 期限 / 担当者 */}
      {(task.due_date || assigneeName) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500 dark:text-stone-400 tabular-nums">
          {task.due_date && (
            <span
              className={`inline-flex items-center gap-1 ${
                isOverdue ? 'text-red-600 dark:text-red-400 font-semibold' : ''
              }`}
            >
              <Calendar className="w-3 h-3" aria-hidden="true" />
              <time dateTime={task.due_date}>
                {isOverdue ? '期限切れ ' : ''}
                {format(parseISO(task.due_date), 'MM/dd')}
              </time>
            </span>
          )}
          {assigneeName && (
            <span className="inline-flex items-center gap-1 min-w-0">
              <User className="w-3 h-3" aria-hidden="true" />
              <span className="truncate">{assigneeName}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
