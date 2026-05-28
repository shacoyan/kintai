import React from 'react';
import { format, isPast, parseISO } from 'date-fns';
import { Calendar } from 'lucide-react';
import type { Task, TaskPriority, TaskStatus } from '../../types';
import { TASK_STATUS_LABELS, TASK_PRIORITY_LABELS } from '../../types';
import { Badge } from '../ui/Badge';
import type { BadgeTone } from '../ui/Badge';
import { Button } from '../ui/Button';

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
function getAvatarColor(userId: string): string {
  if (!userId) return avatarColors[0];
  return avatarColors[hashString(userId) % avatarColors.length];
}

export interface TaskCardProps {
  task: Task;
  onClick?: () => void;
  onComplete?: () => void;
  onReopen?: () => void;
  onDelete?: () => void;
  canEdit?: boolean;
  canComplete?: boolean;
  canDelete?: boolean;
  assignees?: { userId: string; name: string }[];
  projectName?: string;
}

const PRIORITY_TONE_MAP: Record<TaskPriority, BadgeTone> = {
  3: 'danger',
  2: 'warning',
  1: 'neutral',
  0: 'info',
};

const STATUS_TONE_MAP: Record<TaskStatus, BadgeTone> = {
  todo: 'neutral',
  in_progress: 'info',
  done: 'success',
  cancelled: 'danger',
};

export function TaskCard({
  task,
  onClick,
  onComplete,
  onReopen,
  onDelete,
  canEdit = false,
  canComplete = false,
  canDelete = false,
  assignees,
  projectName,
}: TaskCardProps): JSX.Element {
  const isClickable = canEdit || !!onClick;
  const isOverdue = task.due_date
    ? isPast(parseISO(task.due_date)) && task.status !== 'done' && task.status !== 'cancelled'
    : false;
  const isCompleted = task.status === 'done';

  const handleCardClick = () => {
    if (isClickable && onClick) onClick();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isClickable || !onClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  const visibleAssignees = assignees ? assignees.slice(0, 3) : [];
  const remainingAssignees = assignees ? assignees.slice(3) : [];

  return (
    <div
      className={`bg-white dark:bg-stone-800 rounded-lg border border-stone-200 dark:border-stone-700 shadow-sm motion-safe:transition-shadow ${
        isClickable ? 'cursor-pointer hover:shadow-md focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none' : ''
      }`}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={isClickable ? `タスク: ${task.title}` : undefined}
    >
      <div className="p-4">
        {/* ヘッダー: 優先度 + プロジェクト名 / ステータス */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Badge tone={PRIORITY_TONE_MAP[task.priority]} withDot>
              {TASK_PRIORITY_LABELS[task.priority]}
            </Badge>
            {projectName && (
              <span className="text-xs text-stone-500 dark:text-stone-400 truncate">
                {projectName}
              </span>
            )}
          </div>
          <Badge tone={STATUS_TONE_MAP[task.status]}>
            {TASK_STATUS_LABELS[task.status]}
          </Badge>
        </div>

        {/* タイトル */}
        <h3 className="mt-2 text-base font-semibold text-stone-900 dark:text-stone-50 leading-snug line-clamp-2">
          {task.title}
        </h3>

        {/* 説明文 */}
        {task.description && (
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300 line-clamp-2">
            {task.description}
          </p>
        )}

        {/* メタ情報: 期限 / 担当者 */}
        {(task.due_date || (assignees && assignees.length > 0)) && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-stone-500 dark:text-stone-400">
            {task.due_date && (
              <span
                className={`inline-flex items-center gap-1 ${
                  isOverdue ? 'text-red-600 dark:text-red-200 font-semibold' : ''
                }`}
              >
                <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                <time dateTime={task.due_date}>
                  {isOverdue ? '期限切れ: ' : '〜'}
                  {format(parseISO(task.due_date), 'MM/dd')}
                </time>
              </span>
            )}
            {assignees && assignees.length > 0 && (
              <div className="flex items-center -space-x-1.5">
                {visibleAssignees.map((assignee) => (
                  <div
                    key={assignee.userId}
                    title={assignee.name}
                    className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-medium border-2 border-white dark:border-stone-800 ${getAvatarColor(assignee.userId)}`}
                  >
                    {assignee.name.slice(0, 1)}
                  </div>
                ))}
                {remainingAssignees.length > 0 && (
                  <div
                    title={remainingAssignees.map((a) => a.name).join(', ')}
                    className="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-medium border-2 border-white dark:border-stone-800 bg-stone-200 text-stone-700 dark:bg-stone-600 dark:text-stone-200"
                  >
                    +{remainingAssignees.length}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* アクションボタン */}
        {(canComplete || canDelete) && (
          <div
            className="mt-3 pt-3 border-t border-stone-100 dark:border-stone-700 flex items-center justify-end gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {canComplete && !isCompleted && onComplete && (
              <Button variant="primary" size="sm" onClick={onComplete} aria-label="完了にする">
                完了
              </Button>
            )}
            {canComplete && isCompleted && onReopen && (
              <Button variant="secondary" size="sm" onClick={onReopen} aria-label="未完了に戻す">
                未完了に戻す
              </Button>
            )}
            {canDelete && onDelete && (
              <Button variant="danger" size="sm" onClick={onDelete} aria-label="削除">
                削除
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
