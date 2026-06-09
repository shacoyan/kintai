import type { TaskStatus } from '../../types';

/**
 * statusMeta — タスクの status → 表示メタ（ラベル / テキスト色 / ドット色）の単一の真実。
 *
 * 設計書: .company/engineering/docs/2026-06-10-kintai-task-detail-subtask-kanban.md §3-5
 *
 * 経緯: 従来 `TasksPage.tsx` の `statusMeta` と Kanban 側 `statusDotColor` が別定義され、
 * `todo` の色が stone / slate でズレていた。本モジュールを TasksPage と SubtaskKanban の
 * 双方が import して重複を解消する（TasksPage 側の従来定義 = stone 系を正とする）。
 *
 * 注意: ラベルは `TASK_STATUS_LABELS`（types）と一部異なる（cancelled: 'キャンセル' vs '中止'）。
 * 既存 list/kanban の見た目を変えないため、表示は本 `statusMeta`（'中止'）を正とする。
 */
export const statusMeta: Record<TaskStatus, { label: string; text: string; dot: string }> = {
  todo: { label: '未着手', text: 'text-stone-500', dot: 'bg-stone-400' },
  in_progress: { label: '進行中', text: 'text-blue-600', dot: 'bg-blue-500' },
  done: { label: '完了', text: 'text-emerald-600', dot: 'bg-emerald-500' },
  cancelled: { label: '中止', text: 'text-red-600', dot: 'bg-red-500' },
};
