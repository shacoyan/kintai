import { DndContext, DragOverlay, closestCorners, useDroppable } from '@dnd-kit/core';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { format, parseISO } from 'date-fns';
import { Calendar, Check, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useKanbanDnd } from '../../hooks/useKanbanDnd';
import type { Task, TaskPriority, TaskStatus } from '../../types';
import { ActionMenu, type ActionMenuItem } from '../ui';
import { statusMeta } from './taskStatusMeta';

export interface SubtaskKanbanProps {
  /** 親の子配列 (childrenByParentId.get(parent.id) ?? []) */
  children: Task[];
  /** userId → 表示名 */
  memberNames: Map<string, string>;
  /** 子の完了 (既存 handleComplete) */
  onComplete: (childId: string) => void;
  /** 子の再開 (既存 handleReopen) */
  onReopen: (childId: string) => void;
  /** 子の編集ダイアログを開く (openEdit) */
  onEditChild: (child: Task) => void;
  /** 子の削除確認を開く (setDeletingTaskId) */
  onDeleteChild: (child: Task) => void;
  /** 「+子タスクを追加」 (openCreateChild(parent)) */
  onAddChild: () => void;
  /** 子ごとの完了/操作可否 (既存 canActOnTask) */
  canAct: (t: Task) => boolean;
  canManage: boolean;
  /** 削除可否判定用 (canManage || child.created_by === currentUserId) */
  currentUserId?: string | null;
  /** 「+子タスクを追加」を出すか (親に対する権限) */
  showAddButton: boolean;
  /** ① クイック子追加（タイトルのみ・指定 status）。例外は throw して呼び出し側で入力保持。 */
  onQuickAddChild: (title: string, status: TaskStatus) => Promise<void>;
  /** ② 子 status 変更（メニュー代替）。DnD と同じパスを通す。 */
  onChangeChildStatus: (child: Task, to: TaskStatus) => void;
  /** ② 楽観 override 解除同期（= refetch）。 */
  onMutationSuccess: () => void | Promise<void>;
  /** ② DnD 権限用ロール。 */
  myRole: 'owner' | 'manager' | 'staff';
  /** ② DnD 権限用 parttime フラグ。 */
  isParttime: boolean;
  /** ② DnD 権限用 自店舗 id。 */
  myStoreIds: string[];
  /** ② エラー toast 中継。 */
  onError?: (msg: string) => void;
  /** ② 成功 toast 中継。 */
  onSuccess?: (msg: string) => void;
}

const priorityDotColor: Record<TaskPriority, string> = {
  3: 'bg-red-500',
  2: 'bg-orange-500',
  1: 'bg-stone-400',
  0: 'bg-blue-400',
};

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

/** priority DESC → due_date ASC NULLS LAST (KanbanBoard.sortTasks 流用) */
function sortTasks(a: Task, b: Task): number {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }
  const dateA = a.due_date;
  const dateB = b.due_date;
  if (dateA && dateB) return dateA < dateB ? -1 : dateA > dateB ? 1 : 0;
  if (dateA) return -1;
  if (dateB) return 1;
  return 0;
}

/** ② DnD のメニュー代替「ステータス変更」の表示順・ラベル。 */
const STATUS_MENU_ORDER: TaskStatus[] = ['todo', 'in_progress', 'done', 'cancelled'];

interface SubtaskCardProps {
  child: Task;
  /** 列振り分けに使った実効 status（楽観 override 反映後）。 */
  effStatus: TaskStatus;
  memberNames: Map<string, string>;
  onComplete: (childId: string) => void;
  onReopen: (childId: string) => void;
  onEditChild: (child: Task) => void;
  onDeleteChild: (child: Task) => void;
  onChangeChildStatus: (child: Task, to: TaskStatus) => void;
  canAct: (t: Task) => boolean;
  canManage: boolean;
  currentUserId?: string | null;
  /** ② DnD: 掴めるか。 */
  canStartDrag: boolean;
  /** ② DnD: status 遷移の権限判定（メニュー代替フィルタ用）。 */
  canMove: (task: Task, from: TaskStatus, to: TaskStatus) => boolean;
}

/**
 * 子1件 = compact カード。完了チェック + タイトル + 担当 + 期限 + 優先度ドット + 「…」メニュー。
 * カード全体は dnd-kit の sortable（ドラッグハンドル = カード全体）。
 * 完了トグル・「…」メニューは onPointerDown stopPropagation でドラッグ誤発火を防ぐ（§2-5）。
 * 権限判定は SubtaskSection と完全同一ロジック。
 */
function SubtaskCard({
  child,
  effStatus,
  memberNames,
  onComplete,
  onReopen,
  onEditChild,
  onDeleteChild,
  onChangeChildStatus,
  canAct,
  canManage,
  currentUserId,
  canStartDrag,
  canMove,
}: SubtaskCardProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `subtask-${child.id}`,
    disabled: !canStartDrag,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isDone = child.status === 'done';
  const isCancelled = child.status === 'cancelled';
  const childCanAct = canAct(child);
  const canEdit = isDone || isCancelled ? canManage : childCanAct;
  const canDelete = canManage || child.created_by === currentUserId;
  const assignees = (child.assignee_user_ids ?? []).map((id) => ({
    userId: id,
    name: memberNames.get(id) ?? '?',
  }));

  // ② メニュー代替「ステータス変更」: canMove で許可された遷移先のみ。done からは reopen で
  //    in_progress のみ、parttime/staff 制約も canMove に集約済。
  const statusMenuItems: ActionMenuItem[] = STATUS_MENU_ORDER.filter(
    (to) => to !== child.status && canMove(child, child.status, to),
  ).map((to) => ({
    key: `status-${to}`,
    label: `→ ${statusMeta[to].label}`,
    onSelect: () => onChangeChildStatus(child, to),
  }));

  const menuItems: ActionMenuItem[] = [...statusMenuItems];
  if (canEdit) menuItems.push({ key: 'edit', label: '編集', onSelect: () => onEditChild(child) });
  if (canDelete) menuItems.push({ key: 'delete', label: '削除', tone: 'danger', onSelect: () => onDeleteChild(child) });

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      aria-disabled={!canStartDrag || undefined}
      className={`flex select-none items-start gap-2 rounded-[8px] border bg-white px-2 py-2 motion-safe:transition-[box-shadow,background-color,opacity] motion-safe:duration-150 motion-safe:ease-out dark:bg-stone-800 ${
        isDragging
          ? 'border-dashed border-stone-300 opacity-40 dark:border-stone-600'
          : 'border-stone-200/70 dark:border-stone-700/60'
      } ${canStartDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
    >
      <span
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onClick={(e) => {
            e.stopPropagation();
            if (isDone) {
              if (canManage) onReopen(child.id);
            } else if (childCanAct) {
              onComplete(child.id);
            }
          }}
          // #4 KeyboardSensor 干渉防止: Enter/Space は DnD ではなくトグルに使う。
          //    Escape は止めない（DnD キャンセル・モーダル閉じを維持）。「…」メニューと同パターン。
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
          }}
          disabled={isDone ? !canManage : !childCanAct}
          aria-label={isDone ? '子タスクを再開' : '子タスクを完了'}
        >
          {isDone ? (
            <span className="flex h-4 w-4 items-center justify-center rounded-[4px] border border-emerald-600 bg-emerald-600">
              <Check className="h-[11px] w-[11px] text-white" aria-hidden="true" />
            </span>
          ) : (
            <span className="h-4 w-4 rounded-[4px] border-[1.5px] border-stone-300 bg-transparent dark:border-stone-600" />
          )}
        </button>
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={`break-words text-[12.5px] leading-snug ${
            effStatus === 'done' || effStatus === 'cancelled'
              ? 'text-stone-400 line-through'
              : 'text-stone-800 dark:text-stone-200'
          }`}
          title={child.title}
        >
          {child.title}
        </span>
        <div className="flex items-center gap-2">
          {assignees.length > 0 && (
            <span className="flex items-center -space-x-1.5">
              {assignees.slice(0, 2).map((a) => (
                <span
                  key={a.userId}
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold dark:border-stone-900 ${getAvatarColor(a.userId)}`}
                  title={a.name}
                >
                  {a.name.slice(0, 1)}
                </span>
              ))}
              {assignees.length > 2 && (
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-stone-200 text-[10px] font-semibold text-stone-600 dark:border-stone-900 dark:bg-stone-700 dark:text-stone-300"
                  title={assignees.slice(2).map((a) => a.name).join(', ')}
                >
                  +{assignees.length - 2}
                </span>
              )}
            </span>
          )}
          {child.due_date && (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
              <Calendar className="h-[11px] w-[11px]" aria-hidden="true" />
              <time dateTime={child.due_date}>{format(parseISO(child.due_date), 'MM/dd')}</time>
            </span>
          )}
          <span className="inline-flex items-center" title={`優先度 ${child.priority}`}>
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${priorityDotColor[child.priority]}`} />
          </span>
        </div>
      </div>

      {menuItems.length > 0 && (
        <span
          className="flex shrink-0 items-center"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
        >
          <ActionMenu
            items={menuItems}
            triggerSize="sm"
            align="end"
            triggerLabel="子タスク操作"
            bottomSheetTitle="子タスク操作"
          />
        </span>
      )}
    </div>
  );
}

interface QuickAddInputProps {
  status: TaskStatus;
  onQuickAddChild: (title: string, status: TaskStatus) => Promise<void>;
  /** #5 失敗時 toast 用。catch で呼ぶ。 */
  onError?: (msg: string) => void;
}

/**
 * ① クイック子追加（インライン入力）。todo / in_progress 列のみ表示。
 * - 既定: 「+ 追加」淡色トリガ → クリックで input にトグル＋オートフォーカス。
 * - Enter で当該 status の子作成・成功後フォーカス維持で連続追加・空無視・二重送信防止。
 * - IME ガード（isComposing）。Escape / 空 blur でキャンセル。
 */
function QuickAddInput({ status, onQuickAddChild, onError }: QuickAddInputProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const trimmed = title.trim();
    if (trimmed === '' || submitting) return;
    setSubmitting(true);
    try {
      await onQuickAddChild(trimmed, status);
      // 成功: 入力をクリア。
      setTitle('');
    } catch (err) {
      // #5 失敗: 入力を保持し、toast を呼び出し側へ通知。
      onError?.(err instanceof Error ? err.message : 'タスクの追加に失敗しました');
    } finally {
      // #2 disabled 中は focus が当たらないため、submitting=false に戻した「後」
      //    次フレームで input にフォーカスを戻す（連続追加でフォーカスが外れない）。
      setSubmitting(false);
      // setTimeout(0) で React の再描画（disabled 解除）後に focus を確実に当てる。
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
          // 次フレームでフォーカス（input マウント後）。
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="flex w-full items-center gap-1 rounded-[8px] border border-dashed border-blue-300 px-2 py-1.5 text-left text-[12px] font-medium text-blue-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-blue-500/40 dark:text-blue-400 dark:hover:bg-blue-950/30 dark:hover:text-blue-300"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        追加
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={title}
      disabled={submitting}
      placeholder="タイトルを入力して Enter"
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          if (e.nativeEvent.isComposing) return;
          e.preventDefault();
          void submit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setTitle('');
          setEditing(false);
        }
      }}
      onBlur={() => {
        // 空のときのみキャンセル（入力途中は保持）。
        if (title.trim() === '' && !submitting) {
          setEditing(false);
        }
      }}
      className="w-full rounded-[8px] border border-stone-300 bg-white px-2 py-1.5 text-[12.5px] text-stone-800 placeholder:text-stone-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-60 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200"
    />
  );
}

interface SubtaskColumnProps {
  status: TaskStatus;
  colTasks: Task[];
  memberNames: Map<string, string>;
  onComplete: (childId: string) => void;
  onReopen: (childId: string) => void;
  onEditChild: (child: Task) => void;
  onDeleteChild: (child: Task) => void;
  onChangeChildStatus: (child: Task, to: TaskStatus) => void;
  canAct: (t: Task) => boolean;
  canManage: boolean;
  currentUserId?: string | null;
  /** ① クイック追加入力を出すか（親に対する権限）。 */
  showQuickAdd: boolean;
  onQuickAddChild: (title: string, status: TaskStatus) => Promise<void>;
  onError?: (msg: string) => void;
  optimisticOverrides: Map<string, TaskStatus>;
  canStartDrag: (task: Task) => boolean;
  canMove: (task: Task, from: TaskStatus, to: TaskStatus) => boolean;
}

/**
 * 子看板の 1 カラム。droppable 本体 + ヘッダ + SortableContext + 子カード map + ①クイック追加。
 * useDroppable は hook なので map 内で直接呼べず内部コンポーネントに切り出す（§2-4）。
 */
function SubtaskColumn({
  status,
  colTasks,
  memberNames,
  onComplete,
  onReopen,
  onEditChild,
  onDeleteChild,
  onChangeChildStatus,
  canAct,
  canManage,
  currentUserId,
  showQuickAdd,
  onQuickAddChild,
  onError,
  optimisticOverrides,
  canStartDrag,
  canMove,
}: SubtaskColumnProps): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: `subcol-${status}` });
  const meta = statusMeta[status];
  // ① クイック追加は todo / in_progress 列のみ（done/cancelled は completed_at trigger 非発火のため）。
  const allowQuickAdd = showQuickAdd && (status === 'todo' || status === 'in_progress');
  const sortableIds = colTasks.map((c) => `subtask-${c.id}`);

  return (
    <div className="flex flex-col overflow-hidden rounded-[10px] border border-stone-200/70 bg-stone-100 dark:border-stone-700/60 dark:bg-stone-800/60">
      {/* カラムヘッダー */}
      <div className="flex items-center gap-2 border-b border-stone-200/70 bg-white px-3 py-2.5 dark:border-stone-700/60 dark:bg-stone-800">
        <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${meta.dot}`} />
        <span className="text-[12px] font-semibold text-stone-700 dark:text-stone-200">{meta.label}</span>
        <span className="font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
          {colTasks.length}
        </span>
      </div>

      {/* カラム本体 (droppable) */}
      <div
        ref={setNodeRef}
        className={`flex min-h-[96px] flex-1 flex-col gap-2 p-2 transition-colors ${
          isOver
            ? 'bg-blue-50 ring-2 ring-inset ring-blue-400/60 dark:bg-blue-950/30 dark:ring-blue-500/40'
            : ''
        }`}
      >
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          {colTasks.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-stone-300 p-6 text-center text-[11px] text-stone-400 dark:border-stone-700 dark:text-stone-500">
              なし
            </div>
          ) : (
            colTasks.map((child) => (
              <SubtaskCard
                key={child.id}
                child={child}
                effStatus={optimisticOverrides.get(child.id) ?? child.status}
                memberNames={memberNames}
                onComplete={onComplete}
                onReopen={onReopen}
                onEditChild={onEditChild}
                onDeleteChild={onDeleteChild}
                onChangeChildStatus={onChangeChildStatus}
                canAct={canAct}
                canManage={canManage}
                currentUserId={currentUserId}
                canStartDrag={canStartDrag(child)}
                canMove={canMove}
              />
            ))
          )}
        </SortableContext>

        {allowQuickAdd && (
          <QuickAddInput status={status} onQuickAddChild={onQuickAddChild} onError={onError} />
        )}
      </div>
    </div>
  );
}

/**
 * P0-A: DragOverlay 用の軽量プレゼンテーションカード（案 ii）。
 * useSortable を持たない純表示（id 衝突なし・操作 UI 無し）。掴んでいる札の縮約表示。
 * ドラッグ中ビジュアルは document.body 直下の portal に描かれるため、BottomSheet の
 * overflow 境界で clip されず滑らかに追従する。
 */
function SubtaskOverlayCard({
  child,
  memberNames,
}: {
  child: Task;
  memberNames: Map<string, string>;
}): JSX.Element {
  const assignees = (child.assignee_user_ids ?? []).map((id) => ({
    userId: id,
    name: memberNames.get(id) ?? '?',
  }));
  const isDoneOrCancelled = child.status === 'done' || child.status === 'cancelled';

  return (
    <div className="flex cursor-grabbing select-none items-start gap-2 rounded-[8px] border border-stone-200/70 bg-white px-2 py-2 shadow-[0_12px_28px_rgba(0,0,0,0.18)] dark:border-stone-700/60 dark:bg-stone-800">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={`break-words text-[12.5px] leading-snug ${
            isDoneOrCancelled ? 'text-stone-400 line-through' : 'text-stone-800 dark:text-stone-200'
          }`}
          title={child.title}
        >
          {child.title}
        </span>
        <div className="flex items-center gap-2">
          {assignees.length > 0 && (
            <span className="flex items-center -space-x-1.5">
              {assignees.slice(0, 2).map((a) => (
                <span
                  key={a.userId}
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold dark:border-stone-900 ${getAvatarColor(a.userId)}`}
                  title={a.name}
                >
                  {a.name.slice(0, 1)}
                </span>
              ))}
              {assignees.length > 2 && (
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-stone-200 text-[10px] font-semibold text-stone-600 dark:border-stone-900 dark:bg-stone-700 dark:text-stone-300"
                  title={assignees.slice(2).map((a) => a.name).join(', ')}
                >
                  +{assignees.length - 2}
                </span>
              )}
            </span>
          )}
          {child.due_date && (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
              <Calendar className="h-[11px] w-[11px]" aria-hidden="true" />
              <time dateTime={child.due_date}>{format(parseISO(child.due_date), 'MM/dd')}</time>
            </span>
          )}
          <span className="inline-flex items-center" title={`優先度 ${child.priority}`}>
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${priorityDotColor[child.priority]}`} />
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * SubtaskKanban — 子タスク専用の軽量看板（DnD 対応 / Phase 2）。
 *
 * 設計書: .company/engineering/docs/2026-06-10-kintai-task-detail-ux-quickactions.md §2-3
 *
 * - 子を status 別カラム（未着手 / 進行中 / 完了）に振り分け表示。
 * - cancelled は子が 1 件以上あるときだけ動的に 4 列目を出す。
 * - ② カードをカラム間 D&D で status 変更（useKanbanDnd を idPrefix で汎用化して再利用）。
 *   done への移動 = complete / done からの移動 = reopen は getTransitionApi dispatch が自動整合。
 * - ② SP/キーボード代替: 「…」メニューに canMove で絞った「ステータス変更」項目。
 * - ① todo/in_progress 列末尾にクイック追加入力（タイトル＋Enter で連続追加）。
 * - PC（md+）= 横並び grid、SP（< md）= 縦積み。横スクロールなし。
 */
export function SubtaskKanban({
  children,
  memberNames,
  onComplete,
  onReopen,
  onEditChild,
  onDeleteChild,
  onAddChild,
  canAct,
  canManage,
  currentUserId,
  showAddButton,
  onQuickAddChild,
  onChangeChildStatus,
  onMutationSuccess,
  myRole,
  isParttime,
  myStoreIds,
  onError,
  onSuccess,
}: SubtaskKanbanProps): JSX.Element {
  const dnd = useKanbanDnd({
    tasks: children,
    myRole,
    isParttime,
    currentUserId: currentUserId ?? undefined,
    myStoreIds,
    onError,
    onSuccess,
    onMutationSuccess,
    idPrefix: { card: 'subtask-', column: 'subcol-' },
  });

  // P0-A: DragOverlay 用。ドラッグ中の子を保持し、portal レイヤに縮約札を描く。
  const [activeChild, setActiveChild] = useState<Task | null>(null);

  const showCancelled = children.some((c) => c.status === 'cancelled');

  const baseStatuses: TaskStatus[] = ['todo', 'in_progress', 'done'];
  const columnStatuses: TaskStatus[] = showCancelled ? [...baseStatuses, 'cancelled'] : baseStatuses;

  // 列振り分けは楽観 override を反映（親 KanbanBoard と同型）。
  const columnMap: Record<TaskStatus, Task[]> = {
    todo: [],
    in_progress: [],
    done: [],
    cancelled: [],
  };
  for (const child of children) {
    const effStatus = dnd.optimisticOverrides.get(child.id) ?? child.status;
    columnMap[effStatus].push(child);
  }
  for (const status of columnStatuses) {
    columnMap[status].sort(sortTasks);
  }

  const gridCols = showCancelled ? 'md:grid-cols-4' : 'md:grid-cols-3';

  return (
    <DndContext
      sensors={dnd.sensors}
      accessibility={dnd.accessibility}
      collisionDetection={closestCorners}
      autoScroll={{ threshold: { x: 0, y: 0.2 }, acceleration: 8 }}
      onDragStart={({ active }) => {
        const id = String(active.id).replace('subtask-', '');
        setActiveChild(children.find((c) => c.id === id) ?? null);
      }}
      onDragEnd={(e) => {
        void dnd.handleDragEnd(e);
        setActiveChild(null);
      }}
      onDragCancel={() => setActiveChild(null)}
    >
      <div className="space-y-3">
        <div className={`grid grid-cols-1 gap-3 ${gridCols}`}>
          {columnStatuses.map((status) => (
            <SubtaskColumn
              key={status}
              status={status}
              colTasks={columnMap[status]}
              memberNames={memberNames}
              onComplete={onComplete}
              onReopen={onReopen}
              onEditChild={onEditChild}
              onDeleteChild={onDeleteChild}
              onChangeChildStatus={onChangeChildStatus}
              canAct={canAct}
              canManage={canManage}
              currentUserId={currentUserId}
              showQuickAdd={showAddButton}
              onQuickAddChild={onQuickAddChild}
              onError={onError}
              optimisticOverrides={dnd.optimisticOverrides}
              canStartDrag={dnd.canStartDrag}
              canMove={dnd.canMove}
            />
          ))}
        </div>

        {showAddButton && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddChild();
            }}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400 dark:hover:bg-blue-950/30 dark:hover:text-blue-300"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            子タスクを追加
          </button>
        )}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2,0,0,1)' }}>
        {activeChild ? <SubtaskOverlayCard child={activeChild} memberNames={memberNames} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
