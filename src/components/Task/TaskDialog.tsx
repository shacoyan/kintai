import { useState, useEffect, useCallback } from 'react';
import { BottomSheet } from '../ui/BottomSheet';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import type { Task, Project, TaskStatus, TaskPriority } from '../../types';
import { TASK_STATUS_LABELS, TASK_PRIORITY_LABELS } from '../../types';
import type { TaskInput, MemberOption, StoreOption } from './types';
import { formatSupabaseError } from '../../lib/errors';

export interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  task?: Task;
  projects: Project[];
  /** 全件プロジェクト名解決用 (選択肢に無い既存 project_id の表示名補完に使用) */
  projectNames?: Map<string, string>;
  members: MemberOption[];
  stores: StoreOption[];
  onSave: (input: TaskInput) => Promise<void>;
  /** false なら status + description のみ編集可、他は disabled (バイト権限) */
  canEditAll?: boolean;
  tenantId: string;
  defaultStoreId?: string | null;
  defaultAssigneeUserId?: string | null;
  /** create mode の初期 status (kanban カラム + ボタンから渡す) */
  initialStatus?: TaskStatus;
  /** create mode で子タスクとして作成する場合の親 task id (edit では付け替えない) */
  parentTaskId?: string | null;
  /** create mode の初期 project (子タスクで親 project を継承させる用) */
  defaultProjectId?: string | null;
}

/** 担当者集合が等しいか（順序非依存） */
function sameAssignees(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

const STATUS_OPTIONS = (Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((s) => ({
  value: s,
  label: TASK_STATUS_LABELS[s],
}));

const PRIORITY_OPTIONS = ([0, 1, 2, 3] as TaskPriority[]).map((p) => ({
  value: String(p),
  label: TASK_PRIORITY_LABELS[p],
}));

export function TaskDialog({
  open,
  onOpenChange,
  mode,
  task,
  projects,
  projectNames,
  members,
  stores,
  onSave,
  canEditAll = true,
  tenantId,
  defaultStoreId = null,
  defaultAssigneeUserId = null,
  initialStatus,
  parentTaskId = null,
  defaultProjectId = null,
}: TaskDialogProps): JSX.Element | null {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [priority, setPriority] = useState<TaskPriority>(1);
  const [assigneeUserIds, setAssigneeUserIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // open=true 時に task からフォームを初期化
  useEffect(() => {
    if (!open) return;

    if (mode === 'edit' && task) {
      setTitle(task.title ?? '');
      setDescription(task.description ?? '');
      setProjectId(task.project_id);
      setStoreId(task.store_id);
      setStatus(task.status);
      setPriority(task.priority);
      setAssigneeUserIds(task.assignee_user_ids ?? []);
      setDueDate(task.due_date);
    } else {
      setTitle('');
      setDescription('');
      setProjectId(defaultProjectId);
      setStoreId(defaultStoreId);
      setStatus(initialStatus ?? 'todo');
      setPriority(1);
      setAssigneeUserIds(defaultAssigneeUserId ? [defaultAssigneeUserId] : []);
      setDueDate(null);
    }
    setError(null);
    setLoading(false);
  }, [open, mode, task, defaultStoreId, defaultAssigneeUserId, initialStatus, defaultProjectId]);

  const trimmedTitle = title.trim();
  const titleError = (() => {
    if (trimmedTitle.length === 0) return null; // 空はボタン disabled で表現、文言は出さない
    if (trimmedTitle.length > 200) return 'タイトルは200文字以内で入力してください';
    return null;
  })();

  const canSubmit = !loading && trimmedTitle.length > 0 && trimmedTitle.length <= 200;
  const isReadonly = !canEditAll;

  const handleClose = useCallback(() => {
    if (loading) return;
    onOpenChange(false);
  }, [loading, onOpenChange]);

  const handleSave = useCallback(async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    // create: 常に担当者を replace（作成権限者しか作れない）。
    // edit: 担当者集合が編集前から変わった時だけ含める（未変更なら undefined にして
    //       updateTask の set_task_assignees RPC をスキップ → 担当者本人の
    //       parttime/他店舗 staff でもステータス/説明のみ編集で保存できる）。
    const assigneesChanged =
      mode === 'create' || !sameAssignees(assigneeUserIds, task?.assignee_user_ids ?? []);

    const input: TaskInput = {
      tenantId,
      title: trimmedTitle,
      description: description.trim() === '' ? undefined : description.trim(),
      projectId,
      storeId,
      status,
      priority,
      assigneeUserIds: assigneesChanged ? assigneeUserIds : undefined,
      dueDate: dueDate && dueDate.length > 0 ? dueDate : null,
      // create で子タスクとして作成する場合のみ親 id を載せる。edit では付け替えない。
      parentTaskId: mode === 'create' ? (parentTaskId ?? null) : undefined,
    };

    try {
      await onSave(input);
      onOpenChange(false);
    } catch (err: unknown) {
      const friendly = formatSupabaseError(err);
      setError(friendly.message);
    } finally {
      setLoading(false);
    }
  }, [
    canSubmit,
    mode,
    task,
    tenantId,
    trimmedTitle,
    description,
    projectId,
    storeId,
    status,
    priority,
    assigneeUserIds,
    dueDate,
    parentTaskId,
    onSave,
    onOpenChange,
  ]);

  if (!open) return null;

  const dialogTitle =
    mode === 'create'
      ? (parentTaskId ? '子タスク作成' : 'タスク新規作成')
      : 'タスク編集';

  const footer = (
    <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-stone-200 dark:border-stone-700">
      <Button variant="secondary" onClick={handleClose} disabled={loading}>
        キャンセル
      </Button>
      <Button variant="primary" onClick={handleSave} disabled={!canSubmit} loading={loading}>
        保存する
      </Button>
    </div>
  );

  return (
    <BottomSheet isOpen={open} onClose={handleClose} title={dialogTitle} footer={footer}>
      <div className="px-4 py-4 space-y-4">
        {error && <ErrorBanner message={error} />}

        <Input
          label="タイトル"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="タスクのタイトルを入力"
          disabled={isReadonly || loading}
          maxLength={200}
          error={titleError ?? undefined}
        />

        <Textarea
          label="説明"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="任意"
          disabled={loading}
          rows={4}
        />

        <Select
          label="プロジェクト"
          value={projectId ?? ''}
          onChange={(e) => setProjectId(e.target.value || null)}
          disabled={isReadonly || loading}
        >
          <option value="">指定なし</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {/* 編集中タスクの project_id が選択肢 (現在店舗+全社/active) に無い場合
              (他店舗/archived プロジェクトに紐付く既存タスク) は、その 1 件だけ
              末尾に補完表示する。これにより値が空表示にならず、保存時の意図しない
              null 化を防ぐ。 */}
          {projectId && !projects.some((p) => p.id === projectId) && (
            <option key={projectId} value={projectId}>
              {projectNames?.get(projectId) ?? '(対象外プロジェクト)'}
            </option>
          )}
        </Select>

        <Select
          label="店舗"
          value={storeId ?? ''}
          onChange={(e) => setStoreId(e.target.value || null)}
          disabled={isReadonly || loading}
        >
          <option value="">全社</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>

        <Select
          label="ステータス"
          value={status}
          onChange={(e) => setStatus(e.target.value as TaskStatus)}
          disabled={loading}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>

        <Select
          label="優先度"
          value={String(priority)}
          onChange={(e) => setPriority(Number(e.target.value) as TaskPriority)}
          disabled={isReadonly || loading}
        >
          {PRIORITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>

        <fieldset
          className="rounded-md border border-stone-300 p-3 dark:border-stone-600"
          disabled={isReadonly || loading}
        >
          <legend className="px-1 text-sm font-medium text-stone-700 dark:text-stone-200">
            担当者
          </legend>
          {members.length === 0 ? (
            <p className="pt-1 text-sm text-stone-400 dark:text-stone-500">
              選択できるメンバーがいません
            </p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
              {members.map((m) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-center gap-1.5 text-stone-600 dark:text-stone-300"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-stone-300 text-stone-800 focus:ring-stone-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-600"
                    checked={assigneeUserIds.includes(m.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setAssigneeUserIds((prev) => [...prev, m.id]);
                      } else {
                        setAssigneeUserIds((prev) => prev.filter((id) => id !== m.id));
                      }
                    }}
                  />
                  <span className="text-sm">{m.name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <Input
          label="期限日"
          type="date"
          value={dueDate ?? ''}
          onChange={(e) => setDueDate(e.target.value || null)}
          disabled={isReadonly || loading}
        />
      </div>
    </BottomSheet>
  );
}
