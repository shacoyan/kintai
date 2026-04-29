import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { formatSupabaseError, type FriendlyError } from '../lib/errors';
import type { TenantRole } from '../types';

export function useTenantRoles(tenantId: string) {
  const [roles, setRoles] = useState<TenantRole[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [friendlyError, setFriendlyError] = useState<FriendlyError | null>(null);
  const clearError = useCallback(() => {
    setError(null);
    setFriendlyError(null);
  }, []);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('tenant_roles')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('sort_order', { ascending: true });

      if (fetchError) {
        throw new Error('役職の取得に失敗しました: ' + fetchError.message);
      }
      setRoles((data ?? []) as TenantRole[]);
    } catch (err: unknown) {
      const f = formatSupabaseError(err);
      setError(f.message);
      setFriendlyError(f);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  const createRole = useCallback(async (input: {
    name: string;
    default_hourly_rate?: number | null;
    default_monthly_salary?: number | null;
    color?: string | null;
    sort_order?: number;
  }): Promise<TenantRole> => {
    setError(null);
    try {
      const { data, error: insertError } = await supabase
        .from('tenant_roles')
        .insert({
          ...input,
          tenant_id: tenantId,
        })
        .select()
        .single();

      if (insertError) {
        throw new Error('役職の作成に失敗しました: ' + insertError.message);
      }
      if (!data) {
        throw new Error('役職の作成に失敗しました（権限がない可能性があります）');
      }

      await fetchRoles();
      return data as TenantRole;
    } catch (err: unknown) {
      const f = formatSupabaseError(err);
      setError(f.message);
      setFriendlyError(f);
      throw err;
    }
  }, [tenantId, fetchRoles]);

  const updateRole = useCallback(async (id: string, patch: Partial<{
    name: string;
    default_hourly_rate: number | null;
    default_monthly_salary: number | null;
    color: string | null;
    sort_order: number;
  }>): Promise<void> => {
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from('tenant_roles')
        .update(patch)
        .eq('id', id)
        .eq('tenant_id', tenantId);

      if (updateError) {
        throw new Error('役職の更新に失敗しました: ' + updateError.message);
      }

      await fetchRoles();
    } catch (err: unknown) {
      const f = formatSupabaseError(err);
      setError(f.message);
      setFriendlyError(f);
      throw err;
    }
  }, [tenantId, fetchRoles]);

  const deleteRole = useCallback(async (id: string): Promise<void> => {
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from('tenant_roles')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tenantId);

      if (deleteError) {
        throw new Error('役職の削除に失敗しました: ' + deleteError.message);
      }

      await fetchRoles();
    } catch (err: unknown) {
      const f = formatSupabaseError(err);
      setError(f.message);
      setFriendlyError(f);
      throw err;
    }
  }, [tenantId, fetchRoles]);

  return {
    roles,
    loading,
    error,
    friendlyError,
    clearError,
    fetchRoles,
    createRole,
    updateRole,
    deleteRole,
  };
}
