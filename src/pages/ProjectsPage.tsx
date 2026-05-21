import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Heading,
  Button,
  Select,
  EmptyState,
  BottomSheet,
  StatusPill,
} from '../components/ui';
import type { Project, ProjectStatus } from '../types';
import { ProjectDialog } from '../components/Project';
import type { ProjectInput, ProjectStoreOption } from '../components/Project';
import { useProjects, useProjectMutations } from '../hooks/useProjects';
import { useStore } from '../hooks/useStore';
import { useTenant } from '../contexts/TenantContext';

// === 2026-05-22 タスク管理 Phase 1 Loop 6 ===
// プロジェクト管理画面 (一覧 + フィルタ + ダイアログ)
// 権限:
//   - isParttime: 閲覧のみ (アクション全非表示)
//   - managerial (owner / manager): 全権 (新規/編集/アーカイブ/復活/削除/全社プロジェクト可)
//   - staff: 自店舗プロジェクト編集/アーカイブ可、削除不可、全社プロジェクトは閲覧のみ

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

  // C 部品の ProjectStoreOption 形式に adapter
  const storeOptionsForDialog: ProjectStoreOption[] = useMemo(
    () => stores.map((s) => ({ id: s.id, name: s.name })),
    [stores],
  );

  const handleSave = useCallback(
    async (input: ProjectInput) => {
      setMutationBusy(true);
      setMutationError(null);
      try {
        if (editingProject) {
          await updateProject(editingProject.id, {
            name: input.name,
            description: input.description ?? null,
            status: input.status ?? 'active',
            store_id: input.storeId ?? null,
          });
        } else {
          await createProject({
            tenantId,
            storeId: input.storeId ?? null,
            name: input.name,
            description: input.description ?? null,
            status: input.status ?? 'active',
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
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={editingProject ? 'edit' : 'create'}
        project={editingProject}
        stores={storeOptionsForDialog}
        tenantId={tenantId}
        canCreateGlobal={managerial}
        onSave={handleSave}
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
