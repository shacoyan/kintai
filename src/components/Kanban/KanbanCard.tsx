import React from 'react';
import { format, isPast, parseISO } from 'date-fns';
import { Calendar } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task, TaskPriority } from '../../types';
import { getProjectColor } from '../../lib/projectColor';

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

const priorityTextColor: Record<TaskPriority, string> = {
  3: 'text-red-500',
  2: 'text-orange-500',
  1: 'text-stone-500',
  0: 'text-blue-500',
};

const priorityEnglishLabel: Record<TaskPriority, string> = {
  3: 'URGENT',
  2: 'HIGH',
  1: 'NORMAL',
  0: 'LOW',
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
  };

  const isOverdue =
    !!task.due_date &&
    isPast(parseISO(task.due_date)) &&
    task.status !== 'done' &&
    task.status !== 'cancelled';

  const isClickable = !!onClick;

  // プロジェクトごとの色 (左 border + chip)。projectId なしは neutral。
  const projectColor = getProjectColor(task.project_id);

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
        flex flex-col gap-1.5
        bg-white dark:bg-stone-800
        rounded-[8px]
        border border-stone-200/70 dark:border-stone-700/60
        border-l-[3px] ${projectColor.border}
        ${isDragging ? 'opacity-[0.55] rotate-[0.6deg] scale-[0.98] shadow-[0_12px_28px_rgba(0,0,0,0.16)] cursor-grabbing' : 'shadow-[0_1px_2px_rgba(0,0,0,0.04)]'}
        p-2.5 px-3
        select-none
        motion-safe:transition-all motion-safe:duration-150 motion-safe:ease-out
        ${!isDraggable
          ? 'cursor-not-allowed opacity-90'
          : 'cursor-grab active:cursor-grabbing motion-safe:hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]'}
        ${isClickable ? 'focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus:outline-none' : ''}
      `}
    >
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${priorityDotColor[task.priority]}`}
        />
        <span className={`text-[9px] font-semibold uppercase tracking-[0.05em] ${priorityTextColor[task.priority]}`}>
          {priorityEnglishLabel[task.priority]}
        </span>
        <span className="flex-1" />
        {task.status === 'cancelled' && (
          <span className="inline-flex h-[18px] items-center rounded-full bg-red-50 px-1.5 text-[10px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
            中止
          </span>
        )}
      </div>

      <h3 className="line-clamp-2 text-[12.5px] font-medium leading-[1.4] text-stone-900 dark:text-stone-100">
        {task.title}
      </h3>

      {projectName && (
        <div className="flex min-w-0">
          <span
            className={`inline-flex h-[18px] max-w-full items-center gap-1 rounded-full px-1.5 text-[10px] font-medium ${projectColor.bg} ${projectColor.text}`}
            title={projectName}
          >
            <span aria-hidden="true" className={`h-[5px] w-[5px] rounded-full ${getProjectDotColor(projectColor.border)}`} />
            <span className="truncate">{projectName}</span>
          </span>
        </div>
      )}

      <div className="my-0.5 h-px bg-stone-200/70 dark:bg-stone-700/70" />

      {(task.due_date || assigneeName) && (
        <div className="flex items-center gap-1.5">
          {task.due_date && (
            <span
              className={`inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400 ${
                isOverdue ? 'font-bold text-red-600 dark:text-red-400' : ''
              }`}
            >
              <Calendar className="h-[11px] w-[11px]" aria-hidden="true" />
              <time dateTime={task.due_date}>
                {format(parseISO(task.due_date), 'MM/dd')}
              </time>
            </span>
          )}
          <span className="flex-1" />
          {assigneeName && (
            <span
              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${getAvatarColor(task.assignee_user_id)}`}
              title={assigneeName}
            >
              {assigneeName.slice(0, 1)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
