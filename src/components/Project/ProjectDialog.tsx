import { useState, useEffect, useCallback } from 'react';
import { BottomSheet } from '../ui/BottomSheet';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import type { Project, ProjectStatus } from '../../types';
import type { ProjectInput, ProjectStoreOption } from './types';
import { formatSupabaseError } from '../../lib/errors';

export interface ProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  project?: Project;
  stores: ProjectStoreOption[];
  onSave: (input: ProjectInput) => Promise<void>;
  /** true: 「全社」option を表示できる (管理者向け) */
  canCreateGlobal?: boolean;
  tenantId: string;
  /** create 時のデフォルト storeId (省略可) */
  defaultStoreId?: string | null;
}

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: 'active', label: '稼働中' },
  { value: 'archived', label: 'アーカイブ' },
];

export function ProjectDialog({
  open,
  onOpenChange,
  mode,
  project,
  stores,
  onSave,
  canCreateGlobal = false,
  tenantId,
  defaultStoreId = null,
}: ProjectDialogProps): JSX.Element | null {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [storeId, setStoreId] = useState<string | null>(null);
  const [status, setStatus] = useState<ProjectStatus>('active');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && project) {
      setName(project.name ?? '');
      setDescription(project.description ?? '');
      setStoreId(project.store_id);
      setStatus(project.status);
    } else {
      setName('');
      setDescription('');
      // create: canCreateGlobal=false なら必ず店舗指定が必要なので default を使う
      setStoreId(canCreateGlobal ? defaultStoreId : defaultStoreId ?? (stores[0]?.id ?? null));
      setStatus('active');
    }
    setError(null);
    setLoading(false);
  }, [open, mode, project, defaultStoreId, canCreateGlobal, stores]);

  const trimmedName = name.trim();
  const nameError = (() => {
    if (trimmedName.length === 0) return null;
    if (trimmedName.length > 100) return 'プロジェクト名は100文字以内で入力してください';
    return null;
  })();

  // 「全社」を選んでいるが canCreateGlobal=false の場合は無効
  const isInvalidStore = !canCreateGlobal && storeId === null;
  const canSubmit = !loading && trimmedName.length > 0 && trimmedName.length <= 100 && !isInvalidStore;

  const handleClose = useCallback(() => {
    if (loading) return;
    onOpenChange(false);
  }, [loading, onOpenChange]);

  const handleSave = useCallback(async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    const input: ProjectInput = {
      tenantId,
      name: trimmedName,
      description: description.trim() === '' ? undefined : description.trim(),
      storeId,
      status,
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
  }, [canSubmit, tenantId, trimmedName, description, storeId, status, onSave, onOpenChange]);

  if (!open) return null;

  const dialogTitle = mode === 'create' ? 'プロジェクト新規作成' : 'プロジェクト編集';

  const storeSelectValue = storeId === null ? '__global__' : storeId;

  const handleStoreChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (v === '__global__') setStoreId(null);
    else setStoreId(v);
  };

  const footer = (
    <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-neutral-200 dark:border-neutral-700">
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
          label="プロジェクト名"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 新店舗オープン準備"
          disabled={loading}
          maxLength={100}
          error={nameError ?? undefined}
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
          label="店舗"
          value={storeSelectValue}
          onChange={handleStoreChange}
          disabled={loading}
          error={isInvalidStore ? '店舗を選択してください' : undefined}
          hint={canCreateGlobal ? '「全社」は店舗を跨ぐ案件用です' : undefined}
        >
          {canCreateGlobal && <option value="__global__">全社 (店舗指定なし)</option>}
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>

        <Select
          label="ステータス"
          value={status}
          onChange={(e) => setStatus(e.target.value as ProjectStatus)}
          disabled={loading}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>
    </BottomSheet>
  );
}
