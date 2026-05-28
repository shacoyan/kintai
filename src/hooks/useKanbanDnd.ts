/**
 * @file useKanbanDnd.ts
 * @description カンバンボードのドラッグ＆ドロップ操作を管理するカスタムフック。
 *
 * 設計書: .company/engineering/docs/2026-05-22-kintai-task-kanban-phase2-techdesign.md
 *         §3-3 (status 遷移ルール) / §3-4 (権限制御) / §3-8 (アクセシビリティ)
 *
 * - dnd-kit (PointerSensor / TouchSensor / KeyboardSensor) でデスクトップ・モバイル・
 *   キーボード操作の 3 経路を併用 (a11y)
 * - 楽観的更新: API 呼び出し前に `optimisticOverrides` Map に new status を入れ、
 *   呼び出し成功/失敗の双方で Map から削除 (失敗時は rollback として扱う)
 * - 権限チェック: parttime = 自分の assignee + todo/in_progress → done のみ、
 *   staff = 自店舗のみ + done からの reopen NG、managerial = 全許可
 * - API 振り分けは `getTransitionApi` (純粋関数) に委譲し本 hook では dispatch のみ
 */

import {
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Announcements,
  type ScreenReaderInstructions,
  type SensorDescriptor,
  type SensorOptions,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useState, useCallback, useMemo } from 'react';
import type { Task, TaskStatus } from '../types';
import { TASK_STATUS_LABELS } from '../types';
import { getTransitionApi } from '../lib/kanbanTransition';
import { useTaskMutations } from './useTasks';

// ---------------------------------------------------------------------------
// ヘルパー関数 (純粋関数 / hook 外)
// ---------------------------------------------------------------------------

/**
 * 文字列を TaskStatus 型に絞り込むヘルパー関数。
 * @param s 検証対象の文字列
 * @returns 有効な TaskStatus ならその値、無効なら null
 */
function narrowToTaskStatus(s: string): TaskStatus | null {
  const validStatuses: readonly TaskStatus[] = ['todo', 'in_progress', 'done', 'cancelled'];
  return (validStatuses as readonly string[]).includes(s) ? (s as TaskStatus) : null;
}

/**
 * ID 文字列からプレフィックスを除去するヘルパー。
 * @param id     プレフィックス付きの ID
 * @param prefix 除去するプレフィックス
 * @returns プレフィックスが除去された文字列、一致しなければ元の文字列
 */
function stripPrefix(id: string, prefix: string): string {
  return id.startsWith(prefix) ? id.substring(prefix.length) : id;
}

// ---------------------------------------------------------------------------
// useKanbanDnd
// ---------------------------------------------------------------------------

export interface UseKanbanDndParams {
  tasks: Task[];
  myRole: 'owner' | 'manager' | 'staff';
  isParttime: boolean;
  currentUserId: string | undefined;
  /** staff の自店舗判定用。owner / manager / parttime では参照されないため default `[]` で可。 */
  myStoreIds?: string[];
  onError?: (msg: string) => void;
  onSuccess?: (msg: string) => void;
  /**
   * API 成功後に呼ばれるコールバック。typically `useTasks().refetch`。
   * 楽観的更新 (optimisticOverrides) を解除する前にここで server 状態を同期させることで、
   * カードが「楽観列 → 元の列に一瞬戻る → 真の列に再配置」とちらつくのを防ぐ。
   */
  onMutationSuccess?: () => void | Promise<void>;
}

export interface UseKanbanDndResult {
  sensors: SensorDescriptor<SensorOptions>[];
  accessibility: {
    announcements: Announcements;
    screenReaderInstructions: ScreenReaderInstructions;
  };
  handleDragEnd: (event: DragEndEvent) => Promise<void>;
  isMutating: boolean;
  /** taskId → 楽観 status。`tasks` 配列の表示時に override する用途。 */
  optimisticOverrides: Map<string, TaskStatus>;
  canStartDrag: (task: Task) => boolean;
}

/**
 * カンバンボードのドラッグ＆ドロップ操作を管理するフック。
 *
 * @param params タスク、ユーザー権限、コールバック等のパラメータ
 * @returns sensors / accessibility / handleDragEnd / isMutating / optimisticOverrides / canStartDrag
 */
export function useKanbanDnd(params: UseKanbanDndParams): UseKanbanDndResult {
  const {
    tasks,
    myRole,
    isParttime,
    currentUserId,
    myStoreIds = [],
    onError,
    onSuccess,
    onMutationSuccess,
  } = params;

  const { updateTask, completeTask, reopenTask } = useTaskMutations();

  const [isMutating, setIsMutating] = useState<boolean>(false);
  const [optimisticOverrides, setOptimisticOverrides] = useState<Map<string, TaskStatus>>(
    () => new Map<string, TaskStatus>(),
  );

  // -------------------------------------------------------------------------
  // sensors (Pointer / Touch / Keyboard 併用、a11y 対応)
  // -------------------------------------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      // モバイル誤発火防止: 250ms 長押し + 5px tolerance
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // -------------------------------------------------------------------------
  // accessibility (日本語アナウンス / screenReaderInstructions)
  // -------------------------------------------------------------------------
  const findTaskById = useCallback(
    (taskId: string): Task | undefined => tasks.find((t) => t.id === taskId),
    [tasks],
  );

  const getColumnLabel = useCallback((rawOverId: string): string => {
    const status = narrowToTaskStatus(stripPrefix(rawOverId, 'column-'));
    return status ? TASK_STATUS_LABELS[status] : rawOverId;
  }, []);

  const accessibility = useMemo<{
    announcements: Announcements;
    screenReaderInstructions: ScreenReaderInstructions;
  }>(() => {
    const announcements: Announcements = {
      onDragStart: ({ active }) => {
        const taskId = stripPrefix(String(active.id), 'task-');
        const task = findTaskById(taskId);
        return task ? `タスク「${task.title}」を移動します。` : 'タスクを移動します。';
      },
      onDragOver: ({ over }) => {
        if (!over) return undefined;
        const columnLabel = getColumnLabel(String(over.id));
        return `${columnLabel} の上に移動`;
      },
      onDragEnd: ({ over }) => {
        if (!over) return 'キャンセルしました';
        const columnLabel = getColumnLabel(String(over.id));
        return `${columnLabel} に移動しました`;
      },
      onDragCancel: () => 'キャンセルしました',
    };

    const screenReaderInstructions: ScreenReaderInstructions = {
      draggable:
        'タスクカードを移動するには Space または Enter で掴み、矢印キーで列を切り替え、もう一度 Space または Enter で離してください。Escape でキャンセルできます。',
    };

    return { announcements, screenReaderInstructions };
  }, [findTaskById, getColumnLabel]);

  // -------------------------------------------------------------------------
  // 権限チェック (§3-4 canMove 相当を inline 実装)
  //
  //   parttime    : 自分が assignee + (todo|in_progress) → done のみ
  //   staff       : 自店舗 or 全社タスクのみ、done からの reopen は NG
  //   managerial  : 全許可 (ただし done → todo/cancelled は Phase 2 で禁止、Q-T4)
  // -------------------------------------------------------------------------
  const canMove = useCallback(
    (task: Task, from: TaskStatus, to: TaskStatus): boolean => {
      // parttime は最優先で判定 (myRole が staff でも parttime フラグが立つことがある)
      if (isParttime) {
        const isAssignee =
          currentUserId !== undefined &&
          (task.assignee_user_ids ?? []).includes(currentUserId);
        const isValidFrom = from === 'todo' || from === 'in_progress';
        const isValidTo = to === 'done';
        return isAssignee && isValidFrom && isValidTo;
      }

      // managerial (owner / manager) は基本全許可、ただし Phase 2 では done → todo/cancelled を禁止 (Q-T4)
      // Phase 3 で reopen_task RPC に p_target_status 引数を追加して解禁予定
      if (myRole === 'owner' || myRole === 'manager') {
        if (from === 'done' && (to === 'todo' || to === 'cancelled')) return false;
        return true;
      }

      // staff (非 parttime): 自店舗 + done からの reopen NG
      if (myRole === 'staff') {
        const isMyStore =
          task.store_id === null ||
          (typeof task.store_id === 'string' && myStoreIds.includes(task.store_id));
        const isReopenAttempt = from === 'done';
        return isMyStore && !isReopenAttempt;
      }

      return false;
    },
    [isParttime, myRole, currentUserId, myStoreIds],
  );

  // -------------------------------------------------------------------------
  // canStartDrag (§3-4-α / P1-5)
  //
  //   4 status のうち task.status 以外の 3 つで canMove(task, task.status, X) が
  //   true になるものが 1 つでもあれば true。
  //   parttime かつ task.status が done/cancelled の場合は問答無用で false。
  //
  //   isDraggable と canMove の不整合 (掴めるが drop 時にエラー) を hook 内 1 箇所に
  //   集約することで根治する (Reviewer P1-5)。
  // -------------------------------------------------------------------------
  const canStartDrag = useCallback(
    (task: Task): boolean => {
      if (isParttime && (task.status === 'done' || task.status === 'cancelled')) {
        return false;
      }
      const validStatuses: readonly TaskStatus[] = ['todo', 'in_progress', 'done', 'cancelled'];
      return validStatuses.some((status) => {
        if (status === task.status) return false;
        return canMove(task, task.status, status);
      });
    },
    [isParttime, canMove],
  );

  // -------------------------------------------------------------------------
  // 楽観的更新 helpers
  // -------------------------------------------------------------------------
  const removeOptimisticOverride = useCallback((taskId: string) => {
    setOptimisticOverrides((prev) => {
      if (!prev.has(taskId)) return prev;
      const next = new Map(prev);
      next.delete(taskId);
      return next;
    });
  }, []);

  // -------------------------------------------------------------------------
  // handleDragEnd: ドラッグ終了 → 権限チェック → API dispatch → 楽観更新 / rollback
  // -------------------------------------------------------------------------
  const handleDragEnd = useCallback(
    async (event: DragEndEvent): Promise<void> => {
      // 1. active.id から taskId 抽出
      const taskId = stripPrefix(String(event.active.id), 'task-');

      // 2. ドロップ先が無ければ早期 return
      if (!event.over) return;

      // 3. over.id から newStatus を narrow
      const rawStatus = stripPrefix(String(event.over.id), 'column-');
      const newStatus = narrowToTaskStatus(rawStatus);
      if (!newStatus) {
        onError?.('無効な移動先です');
        return;
      }

      // 4. 対象タスク検索
      const task = findTaskById(taskId);
      if (!task) {
        onError?.('タスクが見つかりません');
        return;
      }

      // 5. 同 status は no-op
      if (task.status === newStatus) return;

      // 6. 権限チェック
      if (!canMove(task, task.status, newStatus)) {
        if (task.status === 'done' && (newStatus === 'todo' || newStatus === 'cancelled')) {
          onError?.('done から戻すには「進行中」に移動してください');
        } else {
          onError?.('権限がありません');
        }
        return;
      }

      // 7. API 振り分け + 楽観更新 + try/finally で isMutating 管理
      setIsMutating(true);

      // 楽観更新を即セット (UI に反映)
      setOptimisticOverrides((prev) => {
        const next = new Map(prev);
        next.set(taskId, newStatus);
        return next;
      });

      try {
        const transitionApi = getTransitionApi(task.status, newStatus);

        switch (transitionApi) {
          case 'noop':
            // 5. で同 status は除外済だが念のため
            return;
          case 'complete':
            await completeTask(taskId);
            break;
          case 'reopen':
            await reopenTask(taskId);
            break;
          case 'reopen+update':
            // Phase 2: canMove で done → todo/cancelled を拒否しているため到達しない。
            // Phase 3 で reopen_task RPC に p_target_status 引数を追加した際に活用予定。
            await reopenTask(taskId);
            await updateTask(taskId, { status: newStatus });
            break;
          case 'update':
            await updateTask(taskId, { status: newStatus });
            break;
        }

        // 成功通知 (server refetch で確定するため override は消す)
        const columnLabel = TASK_STATUS_LABELS[newStatus];
        onSuccess?.(`「${task.title}」を ${columnLabel} に移動しました`);

        // server 状態を同期してから override を解除 (順序が重要):
        //   await onMutationSuccess (= useTasks.refetch) → tasks 配列に新 status が反映
        //   → removeOptimisticOverride で楽観 Map から削除
        // 逆順だとカードが「楽観列 → 元の列に一瞬戻る → 真の列に再配置」とちらつく。
        // onMutationSuccess が失敗しても finally で isMutating は解除し、override は残しておく
        // (次回ドラッグ時に上書きされる / 表示は依然新 status のまま)。
        try {
          await onMutationSuccess?.();
        } catch {
          // refetch 失敗は致命的ではない (override が残るので UI 表示は維持される)
        }
        removeOptimisticOverride(taskId);
      } catch (err) {
        // rollback: 楽観更新を取り消し
        removeOptimisticOverride(taskId);
        const errorMessage =
          err instanceof Error ? err.message : '不明なエラーが発生しました';
        onError?.(errorMessage);
      } finally {
        setIsMutating(false);
      }
    },
    [
      findTaskById,
      canMove,
      completeTask,
      reopenTask,
      updateTask,
      onError,
      onSuccess,
      onMutationSuccess,
      removeOptimisticOverride,
    ],
  );

  return {
    sensors,
    accessibility,
    handleDragEnd,
    isMutating,
    optimisticOverrides,
    canStartDrag,
  };
}
