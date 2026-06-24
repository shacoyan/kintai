import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Calendar, Pencil } from 'lucide-react';
import type { Task, TaskPriority, TaskStatus } from '../../types';
import { TASK_PRIORITY_LABELS } from '../../types';
import type { TaskInput } from '../../hooks/useTasks';
import { getProjectColor } from '../../lib/projectColor';
import { canTransitionStatus } from '../../lib/kanbanTransition';
import { BottomSheet } from '../ui/BottomSheet';
import { statusMeta } from './taskStatusMeta';
import { SubtaskKanban } from './SubtaskKanban';

// ③ インライン編集の選択肢。
// ラベルは statusMeta（単一の真実: 未着手/進行中/完了/中止）由来に統一。
const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: statusMeta.todo.label },
  { value: 'in_progress', label: statusMeta.in_progress.label },
  { value: 'done', label: statusMeta.done.label },
  { value: 'cancelled', label: statusMeta.cancelled.label },
];
const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 0, label: TASK_PRIORITY_LABELS[0] },
  { value: 1, label: TASK_PRIORITY_LABELS[1] },
  { value: 2, label: TASK_PRIORITY_LABELS[2] },
  { value: 3, label: TASK_PRIORITY_LABELS[3] },
];

type SavingField = 'status' | 'priority' | 'due' | null;

// アバター色 helper（SubtaskKanban.tsx / list 行と同一実装をローカル複製）。
// 共通化（lib/avatarColor.ts への集約）は将来課題（設計書 §6）。
const avatarColors = [
  'bg-stone-200 text-stone-700',
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-orange-100 text-orange-700',
  'bg-purple-100 text-purple-700',
  'bg-cyan-100 text-cyan-700',
  'bg-amber-100 text-amber-700',
  'bg-indigo-100 text-indigo-700',
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getAvatarColor(userId: string | null): string {
  if (!userId) return avatarColors[0];
  return avatarColors[hashString(userId) % avatarColors.length];
}

export interface TaskDetailDialogProps {
  open: boolean;
  onClose: () => void;
  task: Task; // 親タスク（detail 対象）。open=true 時のみ有効（呼び出し側で条件レンダリング）
  children: Task[]; // childrenByParentId.get(task.id) ?? []
  memberNames: Map<string, string>;
  projectNames: Map<string, string>;
  storeNames: Map<string, string>;
  onEdit: () => void; // 「編集」ボタン → 親 dialog を edit に差し替え
  canEdit: boolean; // 「編集」ボタンの表示可否（旧 list の canOpen と同式）
  // 子操作ハンドラ（list/edit と同一の既存ハンドラを流用）
  onCompleteChild: (childId: string) => void;
  onReopenChild: (childId: string) => void;
  onEditChild: (child: Task) => void;
  onDeleteChild: (child: Task) => void;
  onAddChild: () => void;
  canAct: (t: Task) => boolean;
  canManage: boolean;
  currentUserId?: string | null;
  // ③ 親メタ即編集（status は getTransitionApi 経由＝親側ハンドラ）。
  // #3 保存中ガードのため Promise を返せる（refetch 完了で resolve）。
  onChangeStatus: (to: TaskStatus) => void | Promise<void>;
  onPatchTask: (patch: Partial<TaskInput>) => void | Promise<void>; // priority / dueDate の即保存
  // ②③ 子 status 変更 + DnD 権限。
  onChangeChildStatus: (child: Task, to: TaskStatus) => void;
  onQuickAddChild: (title: string, status: TaskStatus) => Promise<void>; // ①
  onMutationSuccess: () => void | Promise<void>; // ② 楽観解除同期（refetch）
  myRole: 'owner' | 'manager' | 'staff'; // ② DnD hook へ
  isParttime: boolean; // ② DnD hook へ
  myStoreIds: string[]; // ② DnD hook へ
  onError?: (msg: string) => void;
  onSuccess?: (msg: string) => void;
}

/**
 * TaskDetailDialog — タスク詳細ビュー（進捗確認ベース）。
 *
 * 設計書: .company/engineering/docs/2026-06-10-kintai-task-detail-subtask-kanban.md §3
 *
 * 構成: ヘッダ（タイトル + 「編集」ボタン + 閉じる）/ メタ情報（読み取り表示）/
 * 進捗バー（subtask_done/subtask_total）/ 子タスク看板（SubtaskKanban）/「+子タスクを追加」。
 * mutation は持たない（編集は onEdit で edit フォームへ切替）。
 * BottomSheet を流用し widthClassName="md:max-w-5xl"（横3〜4カラム収容）。
 */
export function TaskDetailDialog({
  open,
  onClose,
  task,
  children,
  memberNames,
  projectNames,
  storeNames,
  onEdit,
  canEdit,
  onCompleteChild,
  onReopenChild,
  onEditChild,
  onDeleteChild,
  onAddChild,
  canAct,
  canManage,
  currentUserId,
  onChangeStatus,
  onPatchTask,
  onChangeChildStatus,
  onQuickAddChild,
  onMutationSuccess,
  myRole,
  isParttime,
  myStoreIds,
  onError,
  onSuccess,
}: TaskDetailDialogProps): JSX.Element | null {
  // ③ インライン編集: どのメタ項目が編集中か（クリックで select/input に切替）。
  const [editingField, setEditingField] = useState<SavingField>(null);
  // #3 保存中ガード: 当該セルを保存完了（refetch）まで disabled にし、二重操作・stale from 再送信を防ぐ。
  const [savingField, setSavingField] = useState<SavingField>(null);
  if (!open) return null;

  const projectColor = getProjectColor(task.project_id);
  const projectName = task.project_id ? projectNames.get(task.project_id) : undefined;
  const storeName = task.store_id ? storeNames.get(task.store_id) ?? '不明な店舗' : '全社';
  const meta = statusMeta[task.status];

  // #1 §11(A): status select の選択肢を canTransitionStatus（=②canMove と同一）で絞る。
  // 現在値は常に残し、他は task.status からの遷移が許可される status のみ表示。
  // → done 親（managerial）は「完了（現在値）＋進行中」のみ。todo/cancelled は出ない（②と完全一致）。
  const allowedStatusOptions = STATUS_OPTIONS.filter(
    (o) =>
      o.value === task.status ||
      canTransitionStatus(task, task.status, o.value, {
        myRole,
        isParttime,
        myStoreIds,
        currentUserId: currentUserId ?? undefined,
      }),
  );

  // 進捗: 分母 = subtask_total（useTasks が親 id 集合に対し子を無条件取得して算出。
  //   status / store フィルタで取得スコープ外に落ちた子も含む全子数・cancelled 含む）を優先。
  //   ?? の children フォールバックはフィルタ依存で過少になり得るため、subtask_total が
  //   常に数値で来る親では発火しない（後方互換の保険のみ）。分子 = subtask_done。
  const total = task.subtask_total ?? children.length;
  const done = task.subtask_done ?? children.filter((c) => c.status === 'done').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const showAddButton = canManage || canAct(task);

  // 担当者（#7）: assignee_user_ids を memberNames で名前解決。空配列 = 未割当。
  const assignees = (task.assignee_user_ids ?? []).map((userId) => ({
    userId,
    name: memberNames.get(userId) ?? '?',
  }));

  // 説明（#6）: null / trim 後空文字ならブロックごと非表示。
  const descriptionText = task.description != null ? String(task.description).trim() : '';

  return (
    <BottomSheet isOpen={open} onClose={onClose} widthClassName="md:max-w-5xl" ariaLabel="タスク詳細">
      <div className="space-y-5">
        {/* ヘッダ: タイトル + 編集 + 閉じる */}
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 flex-1 break-words text-lg font-semibold text-stone-900 dark:text-stone-50">
            {task.title}
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            {canEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-1 rounded-md border border-stone-300 px-3 py-1.5 text-[13px] font-medium text-stone-700 transition-colors hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-stone-600 dark:text-stone-200 dark:hover:bg-stone-800"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                編集
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-stone-400 transition-colors hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
              aria-label="閉じる"
            >
              ✕
            </button>
          </div>
        </div>

        {/* メタ情報（ステータス/優先度/期限は ③ インライン編集対応） */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] sm:grid-cols-3">
          {/* ステータス（③ インライン編集） */}
          <div className="flex flex-col gap-0.5">
            <dt className="text-[11px] font-medium text-stone-400 dark:text-stone-500">ステータス</dt>
            <dd className="flex items-center gap-1.5">
              {canEdit && editingField === 'status' ? (
                <select
                  autoFocus
                  value={task.status}
                  disabled={savingField === 'status'}
                  className="w-full rounded-md border border-stone-300 bg-white px-1.5 py-1 text-[13px] text-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200"
                  onChange={(e) => {
                    // #3 保存中の多重発火・stale from 再送信を防ぐ。from は常に最新 task.status を参照。
                    if (savingField === 'status') return;
                    const to = e.target.value as TaskStatus;
                    if (to === task.status) {
                      setEditingField(null);
                      return;
                    }
                    setEditingField(null);
                    setSavingField('status');
                    void Promise.resolve(onChangeStatus(to)).finally(() => setSavingField(null));
                  }}
                  onBlur={() => {
                    if (savingField !== 'status') setEditingField(null);
                  }}
                >
                  {allowedStatusOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  disabled={!canEdit || savingField === 'status'}
                  onClick={() => canEdit && savingField !== 'status' && setEditingField('status')}
                  className={`flex items-center gap-1.5 rounded ${canEdit && savingField !== 'status' ? 'cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800' : 'cursor-default'} px-1 py-0.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60`}
                  aria-label={canEdit ? 'ステータスを変更' : undefined}
                >
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${meta.dot}`} />
                  <span className={`font-medium ${meta.text}`}>{meta.label}</span>
                </button>
              )}
            </dd>
          </div>
          {/* 優先度（③ インライン編集） */}
          <div className="flex flex-col gap-0.5">
            <dt className="text-[11px] font-medium text-stone-400 dark:text-stone-500">優先度</dt>
            <dd className="text-stone-800 dark:text-stone-200">
              {canEdit && editingField === 'priority' ? (
                <select
                  autoFocus
                  value={task.priority}
                  disabled={savingField === 'priority'}
                  className="w-full rounded-md border border-stone-300 bg-white px-1.5 py-1 text-[13px] text-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200"
                  onChange={(e) => {
                    if (savingField === 'priority') return;
                    setEditingField(null);
                    setSavingField('priority');
                    void Promise.resolve(
                      onPatchTask({ priority: Number(e.target.value) as TaskPriority }),
                    ).finally(() => setSavingField(null));
                  }}
                  onBlur={() => {
                    if (savingField !== 'priority') setEditingField(null);
                  }}
                >
                  {PRIORITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  disabled={!canEdit || savingField === 'priority'}
                  onClick={() => canEdit && savingField !== 'priority' && setEditingField('priority')}
                  className={`rounded ${canEdit && savingField !== 'priority' ? 'cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800' : 'cursor-default'} px-1 py-0.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60`}
                  aria-label={canEdit ? '優先度を変更' : undefined}
                >
                  {TASK_PRIORITY_LABELS[task.priority]}
                </button>
              )}
            </dd>
          </div>
          {/* 期限（③ インライン編集） */}
          <div className="flex flex-col gap-0.5">
            <dt className="text-[11px] font-medium text-stone-400 dark:text-stone-500">期限</dt>
            <dd className="flex items-center gap-1 text-stone-800 dark:text-stone-200">
              {canEdit && editingField === 'due' ? (
                <input
                  type="date"
                  autoFocus
                  value={task.due_date ?? ''}
                  disabled={savingField === 'due'}
                  className="w-full rounded-md border border-stone-300 bg-white px-1.5 py-1 text-[13px] text-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200"
                  onChange={(e) => {
                    if (savingField === 'due') return;
                    const v = e.target.value;
                    setEditingField(null);
                    setSavingField('due');
                    void Promise.resolve(
                      onPatchTask({ dueDate: v === '' ? null : v }),
                    ).finally(() => setSavingField(null));
                  }}
                  onBlur={() => {
                    if (savingField !== 'due') setEditingField(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  disabled={!canEdit || savingField === 'due'}
                  onClick={() => canEdit && savingField !== 'due' && setEditingField('due')}
                  className={`flex items-center gap-1 rounded ${canEdit && savingField !== 'due' ? 'cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800' : 'cursor-default'} px-1 py-0.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60`}
                  aria-label={canEdit ? '期限を変更' : undefined}
                >
                  {task.due_date ? (
                    <>
                      <Calendar className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />
                      <time dateTime={task.due_date} className="font-mono tabular-nums">
                        {format(parseISO(task.due_date), 'yyyy/MM/dd')}
                      </time>
                    </>
                  ) : (
                    <span className="text-stone-400 dark:text-stone-500">なし</span>
                  )}
                </button>
              )}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-[11px] font-medium text-stone-400 dark:text-stone-500">プロジェクト</dt>
            <dd>
              {projectName ? (
                <span
                  className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium ${projectColor.bg} ${projectColor.text}`}
                >
                  <span className="truncate">{projectName}</span>
                </span>
              ) : (
                <span className="text-stone-400 dark:text-stone-500">指定なし</span>
              )}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-[11px] font-medium text-stone-400 dark:text-stone-500">店舗</dt>
            <dd className="text-stone-800 dark:text-stone-200">{storeName}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-[11px] font-medium text-stone-400 dark:text-stone-500">担当者</dt>
            <dd>
              {assignees.length === 0 ? (
                <span className="text-stone-400 dark:text-stone-500">未割当</span>
              ) : (
                <span className="flex items-center -space-x-1.5">
                  {assignees.slice(0, 3).map((a) => (
                    <span
                      key={a.userId}
                      className={`inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold dark:border-stone-900 ${getAvatarColor(a.userId)}`}
                      title={a.name}
                    >
                      {a.name.slice(0, 1)}
                    </span>
                  ))}
                  {assignees.length > 3 && (
                    <span
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-stone-200 text-[10px] font-semibold text-stone-600 dark:border-stone-900 dark:bg-stone-700 dark:text-stone-300"
                      title={assignees.slice(3).map((a) => a.name).join(', ')}
                    >
                      +{assignees.length - 3}
                    </span>
                  )}
                </span>
              )}
            </dd>
          </div>
        </dl>

        {/* 説明（#6）: 説明があるときだけ全文表示（改行保持・折返し） */}
        {descriptionText && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-stone-400 dark:text-stone-500">説明</span>
            <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-stone-700 dark:text-stone-300">
              {descriptionText}
            </p>
          </div>
        )}

        {/* 進捗バー */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-medium text-stone-600 dark:text-stone-300">進捗</span>
            <span className="font-mono tabular-nums text-stone-500 dark:text-stone-400">
              {done}/{total}
            </span>
          </div>
          {total > 0 ? (
            <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
                style={{ width: `${pct}%` }}
                role="progressbar"
                aria-valuenow={done}
                aria-valuemin={0}
                aria-valuemax={total}
                aria-label="子タスク進捗"
              />
            </div>
          ) : (
            <p className="text-[12px] text-stone-400 dark:text-stone-500">子タスクなし</p>
          )}
        </div>

        {/* 子タスク看板 + 追加ボタン */}
        <SubtaskKanban
          children={children}
          memberNames={memberNames}
          onComplete={onCompleteChild}
          onReopen={onReopenChild}
          onEditChild={onEditChild}
          onDeleteChild={onDeleteChild}
          onAddChild={onAddChild}
          canAct={canAct}
          canManage={canManage}
          currentUserId={currentUserId}
          showAddButton={showAddButton}
          // ①② チーム A の SubtaskKanban 新 I/F（§5-3）への中継
          onQuickAddChild={onQuickAddChild}
          onChangeChildStatus={onChangeChildStatus}
          onMutationSuccess={onMutationSuccess}
          myRole={myRole}
          isParttime={isParttime}
          myStoreIds={myStoreIds}
          onError={onError}
          onSuccess={onSuccess}
        />
      </div>
    </BottomSheet>
  );
}
