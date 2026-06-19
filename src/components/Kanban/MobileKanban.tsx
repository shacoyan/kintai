/**
 * @file MobileKanban.tsx
 * @description モバイル向けかんばんボードコンポーネント。4列を縦並びのアコーディオン形式で表示します。
 * 設計書 §2-2 / §3-5 準拠。
 *
 * 設計書: .company/engineering/docs/2026-05-22-kintai-task-kanban-phase2-techdesign.md
 *
 * Loop 4.5:
 *   - DndContext / useKanbanDnd は親 (ResponsiveKanban) に lift 済。`dnd` props で
 *     `optimisticOverrides` / `canStartDrag` を受け取る (P1-3)。
 *   - 閉じているアコーディオンも DOM mount を維持しつつ `h-0 overflow-hidden
 *     pointer-events-none` + `aria-hidden` で視覚非表示 (P1-4)。`hidden` (display:none)
 *     にすると dnd-kit が droppable を measure できず drop を受領できなくなるため避ける。
 *   - `isDraggable` は `dnd.canStartDrag(task)` に統一 (P1-5)。
 */
import { useMemo, useState } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronDown } from 'lucide-react';

import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import type { UseKanbanDndResult } from '../../hooks/useKanbanDnd';
import type { Task, TaskStatus } from '../../types';
import { statusMeta } from '../Task/taskStatusMeta';

interface MobileKanbanProps {
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
  /** カードメニューからの削除 (削除確認を開く) */
  onTaskDelete?: (task: Task) => void;
}

// ラベルは statusMeta（単一の真実: 未着手/進行中/完了/中止）由来に統一。
const COLUMN_DEFINITIONS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: statusMeta.todo.label },
  { status: 'in_progress', label: statusMeta.in_progress.label },
  { status: 'done', label: statusMeta.done.label },
  { status: 'cancelled', label: statusMeta.cancelled.label },
];

// ドット色も statusMeta.dot 由来に統一（todo=stone / cancelled=red）。
const statusDotColor: Record<TaskStatus, string> = {
  todo: statusMeta.todo.dot,
  in_progress: statusMeta.in_progress.dot,
  done: statusMeta.done.dot,
  cancelled: statusMeta.cancelled.dot,
};

export function MobileKanban({
  tasks,
  onTaskClick,
  myRole,
  currentUserId,
  memberNames,
  projectNames,
  dnd,
  onTaskDelete,
}: MobileKanbanProps) {
  const canManage = myRole === 'owner' || myRole === 'manager';
  const [accordionState, setAccordionState] = useState<Record<TaskStatus, boolean>>({
    todo: true,
    in_progress: true,
    done: false,
    cancelled: false,
  });

  const toggleAccordion = (status: TaskStatus) => {
    setAccordionState((prev) => ({
      ...prev,
      [status]: !prev[status],
    }));
  };

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
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
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
    /* DndContext は親 ResponsiveKanban で巻いている。ここではアコーディオン UI のみ。 */
    <div className="flex flex-col gap-3">
      {COLUMN_DEFINITIONS.map(({ status, label }) => {
        const columnTasks = columnMap[status] || [];
        const taskIds = columnTasks.map((task) => `task-${task.id}`);
        const isOpen = accordionState[status];
        const accordionId = `accordion-content-${status}`;

        return (
          <div
            key={status}
            className="overflow-hidden rounded-[10px] border border-stone-200/70 bg-stone-100 motion-safe:transition-colors duration-150 dark:border-stone-700/60 dark:bg-stone-900"
          >
            {/* Accordion Header */}
            <button
              type="button"
              className="flex w-full items-center justify-between border-b border-stone-200/70 bg-white px-3 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-stone-700/60 dark:bg-stone-800"
              onClick={() => toggleAccordion(status)}
              aria-expanded={isOpen}
              aria-controls={accordionId}
            >
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full ${statusDotColor[status]}`} />
                <span className="text-[12px] font-semibold text-stone-700 dark:text-stone-200">
                  {label}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
                  {columnTasks.length}
                </span>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-stone-500 motion-safe:transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>

            {/*
              Accordion Body (P1-4):
              閉じている時も DOM ツリー上に保持しドロップを受領できるようにする。
              `hidden` (display:none) は dnd-kit の droppable measure を阻害するため使用しない。
              `h-0 overflow-hidden pointer-events-none` で視覚的に潰しつつ DnD は機能させる。

              a11y (P2 mobile-accordion-focusable-aria-hidden):
              `aria-hidden` だけでは内部のカード / 削除ボタンがキーボード Tab で
              到達可能なまま残り「aria-hidden な subtree に focus 可能要素がある」
              という WAI-ARIA 違反になる。`inert` 属性 (subtree を focus 不可 + クリック不可
              + AT 除外) を閉じている時に付与し、併せて子 KanbanCard の `focusable` を false に
              連動させて tabIndex を -1 化する。inert は @types/react 18.3 の基底型に未収録のため
              型安全なプレーンオブジェクト spread で付与する。
            */}
            <div
              id={accordionId}
              aria-hidden={!isOpen}
              {...(!isOpen ? ({ inert: '' } as Record<string, unknown>) : {})}
              className={
                isOpen
                  ? 'block motion-safe:transition-all duration-200'
                  : 'h-0 overflow-hidden pointer-events-none'
              }
            >
              <KanbanColumn status={status} label={label} tasks={columnTasks} hideHeader>
                <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
                  {columnTasks.map((task) => {
                    const isDraggable = canStartDrag(task);

                    const assignees = (task.assignee_user_ids ?? []).map((id) => ({
                      userId: id,
                      name: memberNames?.get(id) ?? '?',
                    }));

                    const projectName = task.project_id
                      ? projectNames?.get(task.project_id)
                      : undefined;

                    return (
                      <KanbanCard
                        key={task.id}
                        task={task}
                        isDraggable={isDraggable}
                        focusable={isOpen}
                        assignees={assignees}
                        projectName={projectName}
                        onClick={onTaskClick ? () => onTaskClick(task) : undefined}
                        canDelete={canManage || task.created_by === currentUserId}
                        onDelete={onTaskDelete ? () => onTaskDelete(task) : undefined}
                      />
                    );
                  })}
                </SortableContext>
              </KanbanColumn>
            </div>
          </div>
        );
      })}
    </div>
  );
}
