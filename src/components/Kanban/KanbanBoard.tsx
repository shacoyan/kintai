/**
 * @file KanbanBoard.tsx
 * @description かんばんボード (デスクトップ向け) の 4 列描画コンポーネント。
 * 設計書 §3-2 準拠。
 *
 * 設計書: .company/engineering/docs/2026-05-22-kintai-task-kanban-phase2-techdesign.md
 *
 * Loop 4.5:
 *   - DndContext / useKanbanDnd は親 (ResponsiveKanban) に lift 済。当コンポーネントは
 *     親から `dnd: UseKanbanDndResult` を受け取り、`optimisticOverrides` / `canStartDrag`
 *     を利用する (P1-3)。
 *   - `isDraggable` は `dnd.canStartDrag(task)` に統一 (P1-5)。
 */
import React, { useMemo } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import type { UseKanbanDndResult } from '../../hooks/useKanbanDnd';
import type { Task, TaskStatus } from '../../types';

interface KanbanBoardProps {
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
  myRole: 'owner' | 'manager' | 'staff';
  isParttime: boolean;
  currentUserId?: string;
  memberNames?: Map<string, string>;
  projectNames?: Map<string, string>;
  onSuccess?: (msg: string) => void;
  onError?: (msg: string) => void;
  /** 親 (ResponsiveKanban) で 1 回だけ呼んだ useKanbanDnd の結果。 */
  dnd: UseKanbanDndResult;
}

const COLUMN_DEFINITIONS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'ToDo' },
  { status: 'in_progress', label: '進行中' },
  { status: 'done', label: '完了' },
  { status: 'cancelled', label: 'キャンセル' },
];

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  tasks,
  onTaskClick,
  memberNames,
  projectNames,
  dnd,
}) => {
  const { optimisticOverrides, canStartDrag } = dnd;

  const columnMap = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      todo: [],
      in_progress: [],
      done: [],
      cancelled: [],
    };

    tasks.forEach((task) => {
      const taskStatus: TaskStatus = optimisticOverrides.get(task.id) ?? task.status;
      if (map[taskStatus]) {
        map[taskStatus].push(task);
      }
    });

    const sortTasks = (a: Task, b: Task) => {
      // priority DESC (降順: 大きい方が先)
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      // due_date ASC NULLS LAST
      const dateA = a.due_date;
      const dateB = b.due_date;
      if (dateA === null && dateB === null) return 0;
      if (dateA === null) return 1;
      if (dateB === null) return -1;
      return dateA.localeCompare(dateB);
    };

    (Object.keys(map) as TaskStatus[]).forEach((status) => {
      map[status].sort(sortTasks);
    });

    return map;
  }, [tasks, optimisticOverrides]);

  return (
    /* DndContext は親 ResponsiveKanban で巻いている。ここではレイアウトのみ。 */
    <div className="flex gap-3 overflow-x-auto p-0 lg:grid lg:grid-cols-4 lg:overflow-visible">
      {COLUMN_DEFINITIONS.map(({ status, label }) => {
        const columnTasks = columnMap[status] || [];
        const taskIds = columnTasks.map((task) => `task-${task.id}`);

        return (
          <KanbanColumn key={status} status={status} label={label} tasks={columnTasks}>
            <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
              {columnTasks.map((task) => {
                const isDraggable = canStartDrag(task);

                const assigneeName = task.assignee_user_id
                  ? memberNames?.get(task.assignee_user_id)
                  : undefined;

                const projectName = task.project_id
                  ? projectNames?.get(task.project_id)
                  : undefined;

                return (
                  <KanbanCard
                    key={task.id}
                    task={task}
                    isDraggable={isDraggable}
                    assigneeName={assigneeName}
                    projectName={projectName}
                    onClick={onTaskClick ? () => onTaskClick(task) : undefined}
                  />
                );
              })}
            </SortableContext>
          </KanbanColumn>
        );
      })}
    </div>
  );
};
