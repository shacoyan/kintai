import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { Task, TaskStatus } from '../../types';

/**
 * KanbanColumn — 単一列の droppable container (Phase 2 Loop 1)
 *
 * 設計書: .company/engineering/docs/2026-05-22-kintai-task-kanban-phase2-techdesign.md §3-2
 *
 * - dnd-kit `useDroppable` でドロップ受領
 * - ステータス別ボーダー色 (左 border-l-4)
 * - 件数バッジ + 空状態
 * - children (KanbanCard 群) を優先、なければ renderCard を tasks に適用
 */
export type KanbanColumnProps = {
  status: TaskStatus;
  label: string;
  tasks: Task[];
  renderCard?: (task: Task) => React.ReactNode;
  children?: React.ReactNode;
  isDroppable?: boolean;
};

const statusBorderColor: Record<TaskStatus, string> = {
  todo: 'border-neutral-400',
  in_progress: 'border-blue-500',
  done: 'border-emerald-500',
  cancelled: 'border-neutral-300',
};

export function KanbanColumn({
  status,
  label,
  tasks,
  renderCard,
  children,
  isDroppable = true,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    disabled: !isDroppable,
  });

  const hasChildren = React.Children.count(children) > 0;

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 flex flex-col min-h-[200px]">
      {/* カラムヘッダー */}
      <div
        className={`border-l-4 ${statusBorderColor[status]} px-3 py-2 flex items-center gap-2`}
      >
        <span className="font-semibold text-sm text-neutral-700 dark:text-neutral-200">
          {label}
        </span>
        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-neutral-100 dark:bg-neutral-700 text-xs font-medium text-neutral-600 dark:text-neutral-300">
          {tasks.length}
        </span>
      </div>

      {/* カラム本体 (droppable) */}
      <div
        ref={setNodeRef}
        className={`flex-1 p-2 transition-colors ${
          isOver
            ? 'bg-neutral-50 dark:bg-neutral-800/50 ring-2 ring-inset ring-blue-400'
            : ''
        }`}
      >
        {hasChildren ? (
          <div className="flex flex-col gap-2">{children}</div>
        ) : tasks.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-400 text-sm select-none">
            タスクなし
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {renderCard
              ? tasks.map((task) => (
                  <React.Fragment key={task.id}>
                    {renderCard(task)}
                  </React.Fragment>
                ))
              : null}
          </div>
        )}
      </div>
    </div>
  );
}
