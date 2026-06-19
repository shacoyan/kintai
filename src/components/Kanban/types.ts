/**
 * Kanban 専用型定義 (Phase 2 Loop 0)
 *
 * 設計書: .company/engineering/docs/2026-05-22-kintai-task-kanban-phase2-techdesign.md §3-2, §3-3
 *
 * - StoreTabValue: 店舗タブの選択値 (タグ付き union)
 * - KanbanColumnDef: 単一列のメタ情報 (status / label の組)
 */
import type { Task, TaskStatus } from '../../types';

/**
 * 店舗タブの選択値。
 *
 * - `{ kind: 'all' }`         … tenant 内の全タスク
 * - `{ kind: 'company' }`     … `store_id IS NULL` (全社タスク)
 * - `{ kind: 'store'; storeId }` … 特定店舗のタスク
 *
 * localStorage には JSON.stringify した値で保存される (`kintai.tasks.storeTab`)。
 */
export type StoreTabValue =
  | { kind: 'all' }
  | { kind: 'company' }
  | { kind: 'store'; storeId: string };

/**
 * 単一列のメタ情報。`KanbanBoard` が 4 列を並べる際に使用。
 *
 * - `status`: TaskStatus の値 ('todo' | 'in_progress' | 'done' | 'cancelled')
 * - `label`: 列ヘッダ表示用ラベル (例: '未着手', '進行中', '完了', '中止')
 */
export type KanbanColumnDef = {
  status: TaskStatus;
  label: string;
};

/**
 * 単一列のレンダリング時に渡される配列要素。
 * `KanbanBoard` 側で `tasks.filter(t => t.status === col.status)` を渡す。
 */
export type KanbanColumnData = KanbanColumnDef & {
  tasks: Task[];
};

/**
 * 表示モード切替 (Kanban / List)。
 * localStorage には文字列リテラルで保存 (`kintai.tasks.viewMode`)。
 */
export type ViewMode = 'kanban' | 'list';
