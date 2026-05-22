import React from 'react';
import { format, isPast, parseISO } from 'date-fns';
import { Calendar, User } from 'lucide-react';
import type { Task, TaskPriority, TaskStatus } from '../../types';
import { TASK_STATUS_LABELS, TASK_PRIORITY_LABELS } from '../../types';
import { Badge } from '../ui/Badge';
import type { BadgeTone } from '../ui/Badge';
import { Button } from '../ui/Button';

export interface TaskCardProps {
  task: Task;
  onClick?: () => void;
  onComplete?: () => void;
  onReopen?: () => void;
  onDelete?: () => void;
  canEdit?: boolean;
  canComplete?: boolean;
  canDelete?: boolean;
  assigneeName?: string;
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
  assigneeName,
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

  return (
    <div
      className={`bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-sm motion-safe:transition-shadow ${
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
              <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                {projectName}
              </span>
            )}
          </div>
          <Badge tone={STATUS_TONE_MAP[task.status]}>
            {TASK_STATUS_LABELS[task.status]}
          </Badge>
        </div>

        {/* タイトル */}
        <h3 className="mt-2 text-body font-semibold text-neutral-900 dark:text-neutral-50 leading-snug line-clamp-2">
          {task.title}
        </h3>

        {/* 説明文 */}
        {task.description && (
          <p className="mt-1 text-body-sm text-neutral-600 dark:text-neutral-300 line-clamp-2">
            {task.description}
          </p>
        )}

        {/* メタ情報: 期限 / 担当者 */}
        {(task.due_date || assigneeName) && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-body-sm text-neutral-500 dark:text-neutral-400">
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
            {assigneeName && (
              <span className="inline-flex items-center gap-1">
                <User className="w-3.5 h-3.5" aria-hidden="true" />
                {assigneeName}
              </span>
            )}
          </div>
        )}

        {/* アクションボタン */}
        {(canComplete || canDelete) && (
          <div
            className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-700 flex items-center justify-end gap-2"
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
