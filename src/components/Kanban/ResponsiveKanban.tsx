/**
 * @file ResponsiveKanban.tsx
 * @description かんばんボードのラッパー。常に単一の KanbanBoard を描画する。
 *
 * 設計書: .company/engineering/docs/2026-06-24-kintai-mobile-kanban-horizontal-scroll.md
 *
 * レスポンシブ方式 (単一ボード化):
 *   KanbanBoard 自身が `flex ... overflow-x-auto lg:grid lg:grid-cols-4` を持ち、
 *   <lg = 横並び + 横スクロール / >=lg (1024px) = 4 列グリッド を成立させる。
 *   旧来の MobileKanban (縦積みアコーディオン) と useMediaQuery による排他 mount は撤去。
 *
 * Loop 4.5 P1-3:
 *   `useKanbanDnd` を当ラッパーで 1 回だけ呼び、`DndContext` も親 1 つに集約する。
 *   子コンポーネントは `dnd` props を受け取り、内部で `DndContext` を巻かない。
 *
 * DnD 二重 id 解消:
 *   単一ボード化により、同一 DndContext 内に同じ task (`task-${id}`) の sortable が
 *   2 重登録される懸念が根本的に消滅する (以前は両ボード常時 mount が原因だった)。
 */
import { useState } from 'react';
import { DndContext, DragOverlay, closestCorners } from '@dnd-kit/core';

import { KanbanBoard } from './KanbanBoard';
import { KanbanCardPresentation } from './KanbanCard';
import { useKanbanDnd } from '../../hooks/useKanbanDnd';
import type { Task } from '../../types';

interface ResponsiveKanbanProps {
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
  myRole: 'owner' | 'manager' | 'staff';
  isParttime: boolean;
  currentUserId?: string;
  /** staff の自店舗判定用 (P1-1)。owner / manager / parttime でも必ず渡すこと (空配列可)。 */
  myStoreIds: string[];
  memberNames?: Map<string, string>;
  projectNames?: Map<string, string>;
  onSuccess?: (msg: string) => void;
  onError?: (msg: string) => void;
  /**
   * API 成功後に呼ばれる callback。`useTasks().refetch` を渡すことで楽観的更新解除前に
   * server 状態を同期し、カード表示のちらつきを防ぐ。
   */
  onMutationSuccess?: () => void | Promise<void>;
  /** カラム右上 + ボタン押下時 (PC kanban のみ、status 指定で新規作成 dialog 起動) */
  onAddInStatus?: (status: import('../../types').TaskStatus) => void;
  /** カードメニューからの削除 (削除確認を開く) */
  onTaskDelete?: (task: Task) => void;
}

export function ResponsiveKanban(props: ResponsiveKanbanProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const dnd = useKanbanDnd({
    tasks: props.tasks,
    myRole: props.myRole,
    isParttime: props.isParttime,
    currentUserId: props.currentUserId,
    myStoreIds: props.myStoreIds,
    onError: props.onError,
    onSuccess: props.onSuccess,
    onMutationSuccess: props.onMutationSuccess,
  });

  return (
    <DndContext
      sensors={dnd.sensors}
      accessibility={dnd.accessibility}
      collisionDetection={closestCorners}
      onDragStart={({ active }) => {
        const id = String(active.id).replace('task-', '');
        setActiveTask(props.tasks.find((t) => t.id === id) ?? null);
      }}
      onDragEnd={(e) => {
        void dnd.handleDragEnd(e);
        setActiveTask(null);
      }}
      onDragCancel={() => setActiveTask(null)}
    >
      <div>
        <KanbanBoard
          tasks={props.tasks}
          onTaskClick={props.onTaskClick}
          myRole={props.myRole}
          isParttime={props.isParttime}
          currentUserId={props.currentUserId}
          memberNames={props.memberNames}
          projectNames={props.projectNames}
          onSuccess={props.onSuccess}
          onError={props.onError}
          dnd={dnd}
          onAddInStatus={props.onAddInStatus}
          onTaskDelete={props.onTaskDelete}
        />
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2,0,0,1)' }}>
        {activeTask ? (
          <KanbanCardPresentation
            task={activeTask}
            assignees={(activeTask.assignee_user_ids ?? []).map((id) => ({
              userId: id,
              name: props.memberNames?.get(id) ?? '?',
            }))}
            projectName={activeTask.project_id ? props.projectNames?.get(activeTask.project_id) : undefined}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
