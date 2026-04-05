// FILE: hooks/useTenant.ts
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Tenant, TenantMember, TenantWithRole, UserRole } from '../types';

export function useTenant() {
  const [tenants, setTenants] = useState<TenantWithRole[]>([]);
  const [currentTenant, setCurrentTenantState] = useState<Tenant | null>(null);
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const myRole = currentTenant
    ? tenants.find(t => t.id === currentTenant.id)?.role ?? null
    : null;

  const setCurrentTenant = useCallback((tenant: Tenant | null) => {
    if (tenant) {
      localStorage.setItem('kintai_current_tenant_id', tenant.id);
    } else {
      localStorage.removeItem('kintai_current_tenant_id');
    }
    setCurrentTenantState(tenant);
  }, []);

  const fetchMembers = useCallback(async (tenantId: string) => {
    try {
      const { data, error: fetchError } = await supabase
        .from('tenant_members')
        .select('*')
        .eq('tenant_id', tenantId);

      if (fetchError) throw fetchError;
      setMembers(data || []);
    } catch (err: any) {
      console.error('Failed to fetch members:', err.message);
    }
  }, []);

  const fetchTenants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('認証情報の取得に失敗しました');

      const { data, error: fetchError } = await supabase
        .from('tenant_members')
        .select('*, tenants(*)')
        .eq('user_id', user.id);

      if (fetchError) throw fetchError;

      interface TenantMemberWithJoin {
        role: string;
        display_name: string;
        tenants: Tenant | null;
      }

      const mappedTenants: TenantWithRole[] = ((data || []) as TenantMemberWithJoin[])
        .filter((item) => item.tenants !== null)
        .map((item) => ({
          id: item.tenants!.id,
          name: item.tenants!.name,
          invite_code: item.tenants!.invite_code,
          created_at: item.tenants!.created_at,
          owner_id: item.tenants!.owner_id,
          role: item.role as UserRole,
          display_name: item.display_name,
        }));

      setTenants(mappedTenants);
      return mappedTenants;
    } catch (err: any) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const createTenant = useCallback(async (name: string, displayName: string): Promise<Tenant> => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('認証情報の取得に失敗しました');

      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

      const { data: tenantData, error: tenantError } = await supabase
        .from('tenants')
        .insert({ name, invite_code: inviteCode, owner_id: user.id })
        .select()
        .single();

      if (tenantError) throw tenantError;

      const { error: memberError } = await supabase
        .from('tenant_members')
        .insert({
          tenant_id: tenantData.id,
          user_id: user.id,
          display_name: displayName,
          role: 'owner',
        });

      if (memberError) throw memberError;

      return tenantData;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const joinTenant = useCallback(async (inviteCode: string, displayName: string): Promise<Tenant> => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('認証情報の取得に失敗しました');

      const { data: tenantData, error: tenantError } = await supabase
        .from('tenants')
        .select('*')
        .eq('invite_code', inviteCode)
        .single();

      if (tenantError || !tenantData) throw new Error('無効な招待コードです');

      const { error: memberError } = await supabase
        .from('tenant_members')
        .insert({
          tenant_id: tenantData.id,
          user_id: user.id,
          display_name: displayName,
          role: 'staff',
        });

      if (memberError) throw memberError;

      return tenantData;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTenants().then(fetchedTenants => {
      const savedTenantId = localStorage.getItem('kintai_current_tenant_id');
      if (savedTenantId) {
        const found = fetchedTenants.find(t => t.id === savedTenantId);
        if (found) {
          setCurrentTenantState(found);
          fetchMembers(found.id);
        }
      }
    });
  }, [fetchTenants, fetchMembers, setCurrentTenantState]);

  useEffect(() => {
    if (currentTenant) {
      fetchMembers(currentTenant.id);
    } else {
      setMembers([]);
    }
  }, [currentTenant, fetchMembers]);

  return {
    tenants,
    currentTenant,
    setCurrentTenant,
    myRole,
    members,
    fetchTenants,
    createTenant,
    joinTenant,
    loading,
    error,
  };
}
