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
