import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { Task, TaskStatus } from '../../types';

/**
 * KanbanColumn — 単一列の droppable container (Phase 2 Loop 1)
 *
 * 設計書: .company/engineering/docs/2026-05-22-kintai-task-kanban-phase2-techdesign.md §3-2
 *
 * - dnd-kit `useDroppable` でドロップ受領
 * - ステータス別ドット
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

const statusDotColor: Record<TaskStatus, string> = {
  todo: 'bg-slate-400',
  in_progress: 'bg-blue-500',
  done: 'bg-emerald-500',
  cancelled: 'bg-stone-400',
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
    <div className="rounded-xl border border-stone-200/60 dark:border-stone-700/60 bg-white dark:bg-stone-800 flex flex-col min-h-[400px] motion-safe:transition-colors duration-150">
      {/* カラムヘッダー */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full ${statusDotColor[status]}`} />
        <span className="font-semibold text-[13px] tracking-tight text-stone-700 dark:text-stone-200">
          {label}
        </span>
        <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-2 rounded-full bg-stone-100 dark:bg-stone-700 text-[11px] font-medium tabular-nums text-stone-600 dark:text-stone-300">
          {tasks.length}
        </span>
      </div>

      {/* カラム本体 (droppable) */}
      <div
        ref={setNodeRef}
        className={`flex-1 px-2 pb-2 motion-safe:transition-all duration-150 focus-within:ring-2 focus-within:ring-blue-500/40 ${
          isOver
            ? 'ring-2 ring-inset ring-blue-500/30 bg-blue-50/40 dark:bg-blue-950/20'
            : ''
        }`}
      >
        {hasChildren ? (
          <div className="flex flex-col gap-2">{children}</div>
        ) : tasks.length === 0 ? (
          <div className="flex items-center justify-center h-full text-stone-400 dark:text-stone-500 text-xs select-none">
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
