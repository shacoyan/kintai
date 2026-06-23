import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import type { Task, TaskStatus } from '../../types';
import { cn } from '../../lib/cn';
import { statusMeta } from '../Task/taskStatusMeta';

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
  onAddInStatus?: () => void;
  hideHeader?: boolean;
};

// ドット色は statusMeta.dot 由来に統一（MobileKanban と単一の真実: todo=stone / cancelled=red）。
const statusDotColor: Record<TaskStatus, string> = {
  todo: statusMeta.todo.dot,
  in_progress: statusMeta.in_progress.dot,
  done: statusMeta.done.dot,
  cancelled: statusMeta.cancelled.dot,
};

export function KanbanColumn({
  status,
  label,
  tasks,
  renderCard,
  children,
  isDroppable = true,
  onAddInStatus,
  hideHeader = false,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    disabled: !isDroppable,
  });

  const hasChildren = React.Children.count(children) > 0;

  return (
    <div
      className={cn(
        'w-[80vw] max-w-[300px] shrink-0 lg:w-auto lg:max-w-none flex min-h-[400px] flex-col overflow-hidden rounded-[10px] border border-stone-200/70 bg-stone-100 motion-safe:transition-colors duration-150 dark:border-stone-700/60 dark:bg-stone-800/60',
        hideHeader && 'min-h-0 rounded-none border-0',
      )}
    >
      {/* カラムヘッダー */}
      {!hideHeader && (
        <div className="flex items-center gap-2 border-b border-stone-200/70 bg-white px-3 py-2.5 dark:border-stone-700/60 dark:bg-stone-800">
          <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${statusDotColor[status]}`} />
          <span className="text-[12px] font-semibold text-stone-700 dark:text-stone-200">
            {label}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
            {tasks.length}
          </span>
          <button
            type="button"
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-stone-700 dark:hover:text-stone-50"
            onClick={onAddInStatus}
            aria-label={`${label}にタスクを追加`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* カラム本体 (droppable) */}
      <div
        ref={setNodeRef}
        className={`flex min-h-[120px] flex-1 flex-col gap-2 overflow-auto p-2 motion-safe:transition-colors duration-150 focus-within:ring-2 focus-within:ring-blue-500/40 ${
          isOver
            ? 'bg-blue-50 ring-2 ring-inset ring-blue-400/60 dark:bg-blue-950/30 dark:ring-blue-500/40'
            : ''
        }`}
      >
        {hasChildren ? (
          children
        ) : tasks.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-stone-300 p-8 text-center text-[11px] text-stone-400 dark:border-stone-700 dark:text-stone-500">
            ここにドラッグ
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
