/**
 * @file ResponsiveKanban.tsx
 * @description 画面幅に応じてデスクトップ用 (KanbanBoard) とモバイル用 (MobileKanban) のかんばんボードを切り替えるラッパーコンポーネント。
 * 設計書 §2-2 / §3-2 準拠。
 *
 * 設計書: .company/engineering/docs/2026-05-22-kintai-task-kanban-phase2-techdesign.md
 *
 * 切替方式: JS breakpoint (`useMediaQuery('(min-width: 1024px)')`) で desktop / mobile の
 *   いずれか一方のみを mount する。`lg:` (1024px) は Tailwind の lg と一致。
 *
 * Loop 4.5 P1-3:
 *   `useKanbanDnd` を当ラッパーで 1 回だけ呼び、`DndContext` も親 1 つに集約する。
 *   子コンポーネントは `dnd` props を受け取り、内部で `DndContext` を巻かない。
 *
 * P2 (DnD 二重 id 解消):
 *   以前は MobileKanban と KanbanBoard を CSS (`lg:hidden` / `hidden lg:block`) で
 *   両方常時 mount していたため、同一 DndContext 内に同じ task (`task-${id}`) の
 *   sortable が 2 重登録され、dnd-kit の id 衝突 (WAI-ARIA / measure 不整合) を招いていた。
 *   JS breakpoint で片方のみ mount することで sortable id を一意化する。
 *   `useMediaQuery` は synchronous 初期評価のため初回 paint から正しい board が出る。
 */
import { useState } from 'react';
import { DndContext, DragOverlay, closestCorners } from '@dnd-kit/core';

import { KanbanBoard } from './KanbanBoard';
import { MobileKanban } from './MobileKanban';
import { KanbanCardPresentation } from './KanbanCard';
import { useKanbanDnd } from '../../hooks/useKanbanDnd';
import { useMediaQuery } from '../../hooks/useMediaQuery';
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
  // lg breakpoint (1024px) で desktop / mobile を排他 mount。
  // 両方を同時 mount すると同一 DndContext に同じ task の sortable が 2 重登録される。
  const isDesktop = useMediaQuery('(min-width: 1024px)');

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
        {isDesktop ? (
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
        ) : (
          <MobileKanban
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
            onTaskDelete={props.onTaskDelete}
          />
        )}
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
