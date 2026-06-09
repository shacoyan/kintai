/**
 * Kanban status 遷移 → API 振り分けの純粋関数 (Phase 2 Loop 0)
 *
 * 設計書: .company/engineering/docs/2026-05-22-kintai-task-kanban-phase2-techdesign.md §3-3
 *
 * - `getTransitionApi(fromStatus, toStatus)` は status 遷移に対して
 *   どの API を呼ぶべきかの抽象タグを返す純粋関数。
 * - 副作用なし。`useKanbanDnd` (Loop 2) から呼ばれ、その内部で実 API
 *   (`updateTask` / `completeTask` / `reopenTask`) に dispatch される。
 *
 * 権限制御 (canMove) は本ファイルには含めない。
 * Loop 2 の `useKanbanDnd.ts` 側で role + assignee 情報と組み合わせて実装する。
 */
import type { TaskStatus } from '../types';

/**
 * 遷移時に呼ぶ API の抽象タグ。
 *
 * - `'update'`        … `updateTask({ status })` 1 回で完了する遷移
 * - `'complete'`      … `completeTask(taskId)` RPC (completed_at = now() を保証)
 * - `'reopen'`        … `reopenTask(taskId)` RPC (completed_at = NULL クリア、managerial only)
 * - `'reopen+update'` … `reopenTask(taskId)` → `updateTask({ status })` の 2 段階
 * - `'noop'`          … 同 status 同士など、何もしない (UI 側で早期 return)
 */
export type TransitionApi = 'update' | 'complete' | 'reopen' | 'reopen+update' | 'noop';

/**
 * status 遷移 → 呼ぶべき API を返す純粋関数。
 *
 * 設計書 §3-3 の遷移表を実装:
 *
 * | from \ to     | todo          | in_progress     | done          | cancelled     |
 * |---------------|---------------|-----------------|---------------|---------------|
 * | todo          | noop          | update          | complete      | update        |
 * | in_progress   | update        | noop            | complete      | update        |
 * | done          | reopen+update | reopen          | noop          | reopen+update |
 * | cancelled     | update        | update          | complete      | noop          |
 *
 * @param from 遷移元 status
 * @param to   遷移先 status
 * @returns 呼ぶべき API の抽象タグ
 */
export function getTransitionApi(from: TaskStatus, to: TaskStatus): TransitionApi {
  if (from === to) return 'noop';

  // 完了させる: cancelled / todo / in_progress → done
  if (to === 'done') return 'complete';

  // 完了から戻す: done → ...
  if (from === 'done') {
    if (to === 'in_progress') return 'reopen';
    // done → todo / done → cancelled は 2 段階
    return 'reopen+update';
  }

  // それ以外はすべて生 UPDATE
  return 'update';
}

/**
 * status 遷移の権限可否を判定する純粋関数 (single source of truth)。
 *
 * 設計書 2026-06-10 §11 の裁定により、`useKanbanDnd.canMove` 本体・②メニュー代替・
 * ③ TaskDetailDialog の status select の 3 経路がこの関数を共有する。
 *
 * **後方互換厳守**: ここに集約したロジックは `useKanbanDnd` に inline 実装されていた
 * canMove（L201-232）と入出力が 1 ミリも変わらないこと。役割×from×to の真理値表が完全一致する。
 *
 *   parttime    : 自分が assignee + (todo|in_progress) → done のみ
 *   managerial  : 全許可。ただし done → todo/cancelled を禁止（Phase 2 凍結 / Q-T4）。
 *                 Phase 3 で reopen_task RPC に p_target_status を追加して解禁予定。
 *   staff (非 parttime) : 自店舗 or 全社タスクのみ。done からの reopen は NG。
 *
 * @param task 対象タスク（assignee_user_ids / store_id を参照）
 * @param from 遷移元 status
 * @param to   遷移先 status
 * @param ctx  権限判定コンテキスト（myRole / isParttime / myStoreIds / currentUserId）
 */
export function canTransitionStatus(
  task: { assignee_user_ids?: string[] | null; store_id?: string | null },
  from: TaskStatus,
  to: TaskStatus,
  ctx: {
    myRole: 'owner' | 'manager' | 'staff';
    isParttime: boolean;
    myStoreIds: string[];
    currentUserId: string | undefined;
  },
): boolean {
  const { myRole, isParttime, myStoreIds, currentUserId } = ctx;

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
}
