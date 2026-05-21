import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatSupabaseError, type FriendlyError } from '../lib/errors';
import type { Project, ProjectInsert, ProjectUpdate, ProjectStatus } from '../types';

// Project/ProjectInsert/ProjectUpdate/ProjectStatus は types/index.ts 経由 (narrow union)
// ProjectInput は hook 内部用 (UI から hook へ渡す引数の整形)

export interface ProjectInput {
  tenantId: string;
  storeId?: string | null;
  name: string;
  description?: string | null;
  status?: ProjectStatus;
}

export interface UseProjectsOptions {
  tenantId?: string;
  /**
   * storeId === null (明示的 null): 全社プロジェクト (store_id IS NULL) のみ取得
   * storeId === undefined: 全件
   * string: 該当 store_id のプロジェクトのみ
   */
  storeId?: string | null;
  status?: ProjectStatus[];
}

export interface UseProjectsResult {
  projects: Project[];
  isLoading: boolean;
  error: FriendlyError | null;
  refetch: () => Promise<void>;
}

/**
 * 0 行検知用ヘルパ。
 * supabase-js は RLS 等で 0 行除外された場合に silent success (data=null, error=null) になり得るため、
 * 重要 mutate は `.select()` で RETURNING を取り、0 件なら明示エラーへ昇格させる。
 */
function ensureRowReturned<T>(data: T | null | undefined, op: string): T {
  if (data === null || data === undefined) {
    const err = new Error(
      `${op}: 対象が見つからないか権限がありません (RLS / 既に削除済の可能性)`,
    );
    // 既存 formatSupabaseError 経由で扱えるよう code を付与しておく
    (err as Error & { code?: string }).code = '42501';
    throw err;
  }
  return data;
}

/**
 * プロジェクト一覧取得 Hook。
 * tenantId が undefined の間は何もしない (TenantContext 初期化前を想定)。
 */
export function useProjects(opts?: UseProjectsOptions): UseProjectsResult {
  const { tenantId, storeId, status } = opts ?? {};
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<FriendlyError | null>(null);

  // status 配列の参照同一性確保 (effect 依存の不要再実行回避)
  const statusKey = useMemo(() => (status ? [...status].sort().join(',') : ''), [status]);

  // storeId は undefined / null / string の 3 状態を区別するため、refetch 内で直接参照
  const optsRef = useRef<UseProjectsOptions | undefined>(opts);
  optsRef.current = opts;

  const fetchProjects = useCallback(async () => {
    const current = optsRef.current;
    const tid = current?.tenantId;
    if (!tid) {
      setProjects([]);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('projects')
        .select('*')
        .eq('tenant_id', tid);

      // storeId の 3 状態:
      //   string: 指定店舗 OR 全社プロジェクト (store_id IS NULL) を表示
      //   null:   全社プロジェクトのみ (store_id IS NULL)
      //   undefined: 全件 (フィルタなし)
      if (current && 'storeId' in current) {
        if (current.storeId === null) {
          query = query.is('store_id', null);
        } else if (typeof current.storeId === 'string') {
          query = query.or(`store_id.is.null,store_id.eq.${current.storeId}`);
        }
      }

      if (current?.status && current.status.length > 0) {
        query = query.in('status', current.status);
      }

      query = query.order('created_at', { ascending: false });

      const { data, error: e } = await query;
      if (e) throw e;
      setProjects((data as Project[]) ?? []);
    } catch (err: unknown) {
      setError(formatSupabaseError(err));
      setProjects([]);
    } finally {
      setIsLoading(false);
    }
    // statusKey/storeId/tenantId の変化で再 fetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, storeId, statusKey]);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  return {
    projects,
    isLoading,
    error,
    refetch: fetchProjects,
  };
}

export interface UseProjectMutationsResult {
  createProject: (input: ProjectInput) => Promise<Project>;
  updateProject: (
    projectId: string,
    patch: Partial<Pick<Project, 'name' | 'description' | 'status' | 'store_id'>>,
  ) => Promise<Project>;
  archiveProject: (projectId: string) => Promise<Project>;
  deleteProject: (projectId: string) => Promise<void>;
}

/**
 * プロジェクト CRUD ミューテーション Hook。
 * - エラーは throw する設計 (呼び出し側で try/catch + Toast 等で表示)。
 * - 0 行検知は ensureRowReturned で行い、silent success を防止。
 */
export function useProjectMutations(): UseProjectMutationsResult {
  const createProject = useCallback(async (input: ProjectInput): Promise<Project> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const payload: ProjectInsert = {
      tenant_id: input.tenantId,
      store_id: input.storeId ?? null,
      name: input.name,
      description: input.description ?? null,
      status: input.status ?? 'active',
      created_by: user.id,
    };

    try {
      const { data, error: e } = await supabase
        .from('projects')
        .insert(payload)
        .select()
        .single();
      if (e) throw e;
      return ensureRowReturned(data as Project | null, 'createProject') as Project;
    } catch (err: unknown) {
      const f = formatSupabaseError(err);
      throw new Error(f.message);
    }
  }, []);

  const updateProject = useCallback(async (
    projectId: string,
    patch: Partial<Pick<Project, 'name' | 'description' | 'status' | 'store_id'>>,
  ): Promise<Project> => {
    const updatePayload: ProjectUpdate = { ...patch };
    try {
      const { data, error: e } = await supabase
        .from('projects')
        .update(updatePayload)
        .eq('id', projectId)
        .select()
        .single();
      if (e) throw e;
      return ensureRowReturned(data as Project | null, 'updateProject') as Project;
    } catch (err: unknown) {
      const f = formatSupabaseError(err);
      throw new Error(f.message);
    }
  }, []);

  const archiveProject = useCallback(async (projectId: string): Promise<Project> => {
    return updateProject(projectId, { status: 'archived' });
  }, [updateProject]);

  const deleteProject = useCallback(async (projectId: string): Promise<void> => {
    try {
      // .select() で 0 行検知 (RLS で staff/parttime は不可 → 0 件 silent を防止)
      const { data, error: e } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId)
        .select();
      if (e) throw e;
      const rows = (data as Project[] | null) ?? [];
      if (rows.length === 0) {
        const err = new Error('deleteProject: 削除対象が見つからないか権限がありません');
        (err as Error & { code?: string }).code = '42501';
        throw err;
      }
    } catch (err: unknown) {
      const f = formatSupabaseError(err);
      throw new Error(f.message);
    }
  }, []);

  return {
    createProject,
    updateProject,
    archiveProject,
    deleteProject,
  };
}
