import type { TaskStatus, TaskPriority } from '../../types';

/**
 * TaskDialog/TaskList などへ渡す Task 入力型。
 * tenantId は親 page で固定して渡す。
 */
export interface TaskInput {
  tenantId: string;
  projectId?: string | null;
  storeId?: string | null;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeUserId?: string | null;
  /** 複数担当者 (Issue2)。新規はこちらを使う */
  assigneeUserIds?: string[];
  dueDate?: string | null;
  /** 068 子タスク作成時のみ指定する親タスク id。createTask 専用 (updateTask では付け替えしない) */
  parentTaskId?: string | null;
}

/**
 * TaskFilterBar の value 型。
 * - status: 複数選択 (空配列 or undefined で全て)
 * - projectId: 単一選択 ('' で「指定なし=全て」)
 * - assigneeUserId: 単一選択 ('' で「指定なし=全て」)
 * - storeId: null=全社 / undefined=全て / 文字列=指定店舗
 */
export interface TaskFilterValue {
  status?: TaskStatus[];
  projectId?: string;
  assigneeUserId?: string;
  storeId?: string | null;
}

/** メンバー選択肢の最小型 */
export interface MemberOption {
  id: string;
  name: string;
}

/** 店舗選択肢の最小型 */
export interface StoreOption {
  id: string;
  name: string;
}
