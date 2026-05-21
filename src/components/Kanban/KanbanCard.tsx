import React from 'react';
import { format, isPast, parseISO } from 'date-fns';
import { Calendar, User } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task, TaskPriority } from '../../types';
import { TASK_PRIORITY_LABELS } from '../../types';
import { Badge } from '../ui/Badge';
import type { BadgeTone } from '../ui/Badge';

export interface KanbanCardProps {
  task: Task;
  onClick?: () => void;
  /** false の場合はドラッグ不可 (権限不足等)。default true */
  isDraggable?: boolean;
  assigneeName?: string;
  projectName?: string;
}

const PRIORITY_TONE_MAP: Record<TaskPriority, BadgeTone> = {
  3: 'danger',
  2: 'warning',
  1: 'neutral',
  0: 'info',
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

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
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
        bg-white dark:bg-neutral-800
        rounded-lg border border-neutral-200 dark:border-neutral-700
        shadow-sm
        p-3
        select-none
        motion-safe:transition-shadow
        ${!isDraggable ? 'cursor-not-allowed opacity-90' : 'cursor-grab active:cursor-grabbing hover:shadow-md'}
        ${isClickable ? 'focus-visible:ring-2 focus-visible:ring-primary-500 focus:outline-none' : ''}
      `}
    >
      {/* ヘッダー: タイトル + 優先度バッジ */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-body-sm font-semibold text-neutral-900 dark:text-neutral-50 leading-snug line-clamp-2 min-w-0">
          {task.title}
        </h3>
        <Badge tone={PRIORITY_TONE_MAP[task.priority]} withDot>
          {TASK_PRIORITY_LABELS[task.priority]}
        </Badge>
      </div>

      {/* プロジェクト名 (任意) */}
      {projectName && (
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 truncate">
          {projectName}
        </p>
      )}

      {/* メタ情報: 期限 / 担当者 */}
      {(task.due_date || assigneeName) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
          {task.due_date && (
            <span
              className={`inline-flex items-center gap-1 ${
                isOverdue ? 'text-danger-600 dark:text-danger-300 font-semibold' : ''
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
