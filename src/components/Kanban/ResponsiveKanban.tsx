/**
 * @file ResponsiveKanban.tsx
 * @description 画面幅に応じてデスクトップ用 (KanbanBoard) とモバイル用 (MobileKanban) のかんばんボードを切り替えるラッパーコンポーネント。
 * 設計書 §2-2 / §3-2 準拠。
 *
 * 設計書: .company/engineering/docs/2026-05-22-kintai-task-kanban-phase2-techdesign.md
 *
 * 切替方式: 案 A — 両方を常時 mount し、Tailwind の `md:` (768px) breakpoint で
 *   `md:hidden` / `hidden md:block` により表示・非表示を切り替える。
 *
 * Loop 4.5 P1-3:
 *   `useKanbanDnd` を当ラッパーで 1 回だけ呼び、`DndContext` も親 1 つに集約する。
 *   これにより MobileKanban / KanbanBoard が同時 mount されても hook 多重実行・
 *   楽観的更新の分断が発生しない。子コンポーネントは `dnd` props を受け取り、
 *   内部で `DndContext` を巻かない。
 */
import { DndContext } from '@dnd-kit/core';

import { KanbanBoard } from './KanbanBoard';
import { MobileKanban } from './MobileKanban';
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
}

export function ResponsiveKanban(props: ResponsiveKanbanProps) {
  const dnd = useKanbanDnd({
    tasks: props.tasks,
    myRole: props.myRole,
    isParttime: props.isParttime,
    currentUserId: props.currentUserId,
    myStoreIds: props.myStoreIds,
    onError: props.onError,
    onSuccess: props.onSuccess,
  });

  return (
    <DndContext sensors={dnd.sensors} {...dnd.accessibility} onDragEnd={dnd.handleDragEnd}>
      <div className="md:hidden">
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
        />
      </div>
      <div className="hidden md:block">
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
        />
      </div>
    </DndContext>
  );
}
