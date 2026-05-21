import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Heading,
  Button,
  Select,
  Input,
  Textarea,
  EmptyState,
  BottomSheet,
  StatusPill,
} from '../components/ui';
import type { Project, ProjectStatus, Store } from '../types';
import { useProjects, useProjectMutations } from '../hooks/useProjects';
import { useStore } from '../hooks/useStore';
import { useTenant } from '../contexts/TenantContext';

// === 2026-05-22 タスク管理 Phase 1 Loop 4 ===
// プロジェクト管理画面 (一覧 + フィルタ + ダイアログ)
// 権限:
//   - isParttime: 閲覧のみ (アクション全非表示)
//   - managerial (owner / manager): 全権 (新規/編集/アーカイブ/復活/削除/全社プロジェクト可)
//   - staff: 自店舗プロジェクト編集/アーカイブ可、削除不可、全社プロジェクトは閲覧のみ
// 注: ProjectDialog / DeleteConfirmDialog は Engineer C が後で components/Project/ に差し替え可能な構造とする

const COMPANY_SCOPE_TOKEN = '__company__'; // store_id IS NULL を Select で扱うための sentinel

interface ProjectFormData {
  name: string;
  description: string;
  storeId: string | null;
  status: ProjectStatus;
}

const EMPTY_FORM: ProjectFormData = {
  name: '',
  description: '',
  storeId: null,
  status: 'active',
};

interface ProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: ProjectFormData) => Promise<void>;
  project?: Project;
  stores: Store[];
  managerial: boolean;
}

// 2026-05-22 Loop 4 P1-4: staff の新規作成は RLS で不可のため、
// defaultStoreIdForStaff / hideCompanyOption / staff 新規分岐は死にコードとして削除。
// ProjectsPage 側で managerial = true のときのみ「新規」ボタンを表示している前提。
function ProjectDialog({
  isOpen,
  onClose,
  onSave,
  project,
  stores,
  managerial,
}: ProjectDialogProps) {
  const [form, setForm] = useState<ProjectFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!project;

  useEffect(() => {
    if (!isOpen) return;
    if (project) {
      setForm({
        name: project.name,
        description: project.description ?? '',
        storeId: project.store_id,
        status: project.status,
      });
    } else {
      // 新規は managerial 専用経路 (staff は INSERT 不可)。
      // managerial の default は「全社」(storeId: null)。
      setForm({ ...EMPTY_FORM, storeId: null });
    }
    setError(null);
    setSaving(false);
  }, [isOpen, project]);

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) {
      setError('プロジェクト名は必須です');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(form);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '保存に失敗しました';
      setError(msg);
      setSaving(false);
    }
  }, [form, onSave, onClose]);

  // staff が既存プロジェクトの店舗を変更することは禁止 (新規は managerial のみ呼ばれる前提)
  const storeLocked = isEditing && !managerial;

  // 「全社」option は常に表示 (managerial 編集 / managerial 新規 / staff 編集すべてで意味を持つ)。
  // staff 編集は storeLocked=true により Select が disabled なので option 内容には影響しない。
  const storeOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: COMPANY_SCOPE_TOKEN, label: '全社' }];
    for (const s of stores) {
      opts.push({ value: s.id, label: s.name });
    }
    return opts;
  }, [stores]);

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'プロジェクトを編集' : '新規プロジェクト'}
      footer={
        <div className="flex justify-end gap-2 px-4 py-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      }
    >
      <div className="px-4 py-4 space-y-4">
        {error && (
          <div className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-900/20 dark:text-danger-300">
            {error}
          </div>
        )}
        <Input
          label="プロジェクト名"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="例: 新人研修プログラム"
          disabled={saving}
          required
        />
        <Textarea
          label="説明"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          rows={3}
          disabled={saving}
          placeholder="任意"
        />
        <Select
          label="店舗"
          options={storeOptions}
          value={form.storeId ?? COMPANY_SCOPE_TOKEN}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              storeId: e.target.value === COMPANY_SCOPE_TOKEN ? null : e.target.value,
            }))
          }
          disabled={saving || storeLocked}
          hint={storeLocked ? '店舗を変更するには管理者権限が必要です' : undefined}
        />
        <Select
          label="ステータス"
          options={[
            { value: 'active', label: '有効' },
            { value: 'archived', label: 'アーカイブ' },
          ]}
          value={form.status}
          onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ProjectStatus }))}
          disabled={saving}
        />
      </div>
    </BottomSheet>
  );
}

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  projectName: string;
}

function DeleteConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  projectName,
}: DeleteConfirmDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDeleting(false);
      setError(null);
    }
  }, [isOpen]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '削除に失敗しました';
      setError(msg);
      setDeleting(false);
    }
  }, [onConfirm, onClose]);

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="プロジェクトを削除"
      footer={
        <div className="flex justify-end gap-2 px-4 py-3">
          <Button variant="secondary" onClick={onClose} disabled={deleting}>
            キャンセル
          </Button>
          <Button variant="danger" onClick={() => void handleDelete()} disabled={deleting}>
            {deleting ? '削除中…' : '削除'}
          </Button>
        </div>
      }
    >
      <div className="px-4 py-4 space-y-3">
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          <span className="font-medium text-neutral-900 dark:text-neutral-100">
            {projectName}
          </span>{' '}
          を削除します。この操作は取り消せません。
        </p>
        {error && (
          <div className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-900/20 dark:text-danger-300">
            {error}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

export function ProjectsPage() {
  const { currentTenant, myRole, isParttime, myStoreIds } = useTenant();
  // RequireTenant ガード後の前提
  const tenantId = currentTenant!.id;
  const managerial = myRole === 'owner' || myRole === 'manager';
  const readonly = isParttime;

  // フィルタ state
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('active');
  const [storeFilter, setStoreFilter] = useState<string>('all'); // 'all' | 'company' | <storeId>

  // 店舗一覧 fetch (useStore は呼び出し側で明示 fetch が必要)
  const { stores, fetchStores } = useStore(tenantId);
  useEffect(() => {
    void fetchStores();
  }, [fetchStores]);

  const storeIdParam: string | null | undefined =
    storeFilter === 'all' ? undefined : storeFilter === 'company' ? null : storeFilter;
  const statusParam: ProjectStatus[] | undefined =
    statusFilter === 'all' ? undefined : [statusFilter];

  const { projects, isLoading, error, refetch } = useProjects({
    tenantId,
    storeId: storeIdParam,
    status: statusParam,
  });

  const { createProject, updateProject, archiveProject, deleteProject } = useProjectMutations();

  // dialog / mutation state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const storeNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stores) m.set(s.id, s.name);
    return m;
  }, [stores]);

  const getStoreLabel = useCallback(
    (storeId: string | null): string => {
      if (storeId === null) return '全社';
      return storeNameMap.get(storeId) ?? '(不明な店舗)';
    },
    [storeNameMap],
  );

  // 権限判定 ----
  // 2026-05-22 Loop 4 P0-2 fix:
  //   staff の編集権限を「自店舗 (myStoreIds に含まれる) のみ」に厳密化。
  //   以前は `project.store_id !== null` のみで判定しており、他店舗の店舗付きプロジェクトまで編集可能だった。
  const canEdit = useCallback(
    (project: Project): boolean => {
      if (readonly) return false;
      if (managerial) return true;
      // staff: 自店舗 (myStoreIds に含まれる store_id) のみ編集可。
      // 全社 (store_id === null) および他店舗は不可。
      if (myRole === 'staff') {
        return project.store_id !== null && myStoreIds.includes(project.store_id);
      }
      return false;
    },
    [readonly, managerial, myRole, myStoreIds],
  );

  const canArchiveOrRestore = useCallback(
    (project: Project): boolean => canEdit(project),
    [canEdit],
  );

  // 削除は managerial のみ。isParttime は readonly に含まれるため readonly で弾く。
  const canDelete = useCallback(
    (_project: Project): boolean => {
      if (readonly) return false;
      if (isParttime) return false;
      return managerial;
    },
    [readonly, managerial, isParttime],
  );

  // アクション ----
  const openCreate = useCallback(() => {
    setEditingProject(undefined);
    setMutationError(null);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((project: Project) => {
    setEditingProject(project);
    setMutationError(null);
    setDialogOpen(true);
  }, []);

  const handleSave = useCallback(
    async (data: ProjectFormData) => {
      setMutationBusy(true);
      setMutationError(null);
      try {
        if (editingProject) {
          await updateProject(editingProject.id, {
            name: data.name,
            description: data.description || null,
            status: data.status,
            store_id: data.storeId,
          });
        } else {
          await createProject({
            tenantId,
            storeId: data.storeId,
            name: data.name,
            description: data.description || null,
            status: data.status,
          });
        }
        await refetch();
      } catch (e) {
        const msg = e instanceof Error ? e.message : '保存に失敗しました';
        setMutationError(msg);
        throw e;
      } finally {
        setMutationBusy(false);
      }
    },
    [editingProject, tenantId, createProject, updateProject, refetch],
  );

  const handleArchiveOrRestore = useCallback(
    async (project: Project) => {
      setMutationBusy(true);
      setMutationError(null);
      try {
        if (project.status === 'active') {
          await archiveProject(project.id);
        } else {
          // 復活
          await updateProject(project.id, { status: 'active' });
        }
        await refetch();
      } catch (e) {
        const msg = e instanceof Error ? e.message : '操作に失敗しました';
        setMutationError(msg);
      } finally {
        setMutationBusy(false);
      }
    },
    [archiveProject, updateProject, refetch],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setMutationBusy(true);
    setMutationError(null);
    try {
      await deleteProject(deleteTarget.id);
      setDeleteTarget(null);
      await refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '削除に失敗しました';
      setMutationError(msg);
      throw e;
    } finally {
      setMutationBusy(false);
    }
  }, [deleteTarget, deleteProject, refetch]);

  // フィルタ options ----
  const statusFilterOptions = [
    { value: 'all', label: '全ステータス' },
    { value: 'active', label: '有効' },
    { value: 'archived', label: 'アーカイブ' },
  ];

  const storeFilterOptions = useMemo(
    () => [
      { value: 'all', label: '全店舗' },
      { value: 'company', label: '全社のみ' },
      ...stores.map((s) => ({ value: s.id, label: s.name })),
    ],
    [stores],
  );

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 md:px-6 space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <Heading level={1}>プロジェクト</Heading>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            タスクをまとめる単位。店舗別 / 全社で管理できます。
          </p>
        </div>
        {managerial && !readonly && (
          <Button variant="primary" size="md" onClick={openCreate}>
            新規作成
          </Button>
        )}
      </header>

      {/* グローバルエラー */}
      {mutationError && (
        <div
          role="alert"
          className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-900/20 dark:text-danger-300"
        >
          {mutationError}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-900/20 dark:text-danger-300"
        >
          プロジェクトの取得に失敗しました: {error.message}
        </div>
      )}

      {/* フィルタ */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Select
            label="ステータス"
            options={statusFilterOptions}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ProjectStatus | 'all')}
          />
        </div>
        <div className="w-48">
          <Select
            label="店舗"
            options={storeFilterOptions}
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
          />
        </div>
      </div>

      {/* 一覧 */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-neutral-500 dark:text-neutral-400">
          読み込み中…
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          title="プロジェクトがありません"
          description={
            managerial && !readonly
              ? '右上の「新規作成」から最初のプロジェクトを作成してください。'
              : '現在のフィルタに該当するプロジェクトはありません。'
          }
        />
      ) : (
        <div className="rounded-lg border border-neutral-200 bg-white divide-y divide-neutral-200 dark:bg-neutral-800 dark:border-neutral-700 dark:divide-neutral-700">
          {projects.map((project) => {
            const editable = canEdit(project);
            const archivable = canArchiveOrRestore(project);
            const deletable = canDelete(project);
            return (
              <div
                key={project.id}
                className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                      {project.name}
                    </span>
                    <StatusPill tone={project.status === 'active' ? 'success' : 'neutral'}>
                      {project.status === 'active' ? '有効' : 'アーカイブ'}
                    </StatusPill>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                      {getStoreLabel(project.store_id)}
                    </span>
                  </div>
                  {project.description && (
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2">
                      {project.description}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {editable && (
                    <Button
                      variant="tertiary"
                      size="sm"
                      onClick={() => openEdit(project)}
                      disabled={mutationBusy}
                    >
                      編集
                    </Button>
                  )}
                  {archivable && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleArchiveOrRestore(project)}
                      disabled={mutationBusy}
                    >
                      {project.status === 'active' ? 'アーカイブ' : '復活'}
                    </Button>
                  )}
                  {deletable && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setMutationError(null);
                        setDeleteTarget(project);
                      }}
                      disabled={mutationBusy}
                    >
                      削除
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ProjectDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        project={editingProject}
        stores={stores}
        managerial={managerial}
      />

      <DeleteConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        projectName={deleteTarget?.name ?? ''}
      />
    </div>
  );
}
