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
  members: MemberOption[];
  stores: StoreOption[];
  onSave: (input: TaskInput) => Promise<void>;
  /** false なら status + description のみ編集可、他は disabled (バイト権限) */
  canEditAll?: boolean;
  tenantId: string;
  defaultStoreId?: string | null;
  defaultAssigneeUserId?: string | null;
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
  members,
  stores,
  onSave,
  canEditAll = true,
  tenantId,
  defaultStoreId = null,
  defaultAssigneeUserId = null,
}: TaskDialogProps): JSX.Element | null {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [priority, setPriority] = useState<TaskPriority>(1);
  const [assigneeUserId, setAssigneeUserId] = useState<string | null>(null);
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
      setAssigneeUserId(task.assignee_user_id);
      setDueDate(task.due_date);
    } else {
      setTitle('');
      setDescription('');
      setProjectId(null);
      setStoreId(defaultStoreId);
      setStatus('todo');
      setPriority(1);
      setAssigneeUserId(defaultAssigneeUserId);
      setDueDate(null);
    }
    setError(null);
    setLoading(false);
  }, [open, mode, task, defaultStoreId, defaultAssigneeUserId]);

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

    const input: TaskInput = {
      tenantId,
      title: trimmedTitle,
      description: description.trim() === '' ? undefined : description.trim(),
      projectId,
      storeId,
      status,
      priority,
      assigneeUserId,
      dueDate: dueDate && dueDate.length > 0 ? dueDate : null,
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
    tenantId,
    trimmedTitle,
    description,
    projectId,
    storeId,
    status,
    priority,
    assigneeUserId,
    dueDate,
    onSave,
    onOpenChange,
  ]);

  if (!open) return null;

  const dialogTitle = mode === 'create' ? 'タスク新規作成' : 'タスク編集';

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

        <Select
          label="担当者"
          value={assigneeUserId ?? ''}
          onChange={(e) => setAssigneeUserId(e.target.value || null)}
          disabled={isReadonly || loading}
        >
          <option value="">未割当</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>

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
