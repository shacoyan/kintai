import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { Tenant, TenantMember, TenantWithRole, UserRole } from '../types';

interface TenantContextType {
  tenants: TenantWithRole[];
  currentTenant: Tenant | null;
  setCurrentTenant: (tenant: Tenant | null) => void;
  myRole: UserRole | null;
  members: TenantMember[];
  fetchTenants: () => Promise<TenantWithRole[]>;
  createTenant: (name: string, displayName: string) => Promise<Tenant>;
  joinTenant: (inviteCode: string, displayName: string) => Promise<Tenant>;
  loading: boolean;
  error: string | null;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();

  const [tenants, setTenants] = useState<TenantWithRole[]>([]);
  const [currentTenant, setCurrentTenantState] = useState<Tenant | null>(() => {
    try {
      const saved = localStorage.getItem('kintai_current_tenant');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const myRole = currentTenant
    ? tenants.find(t => t.id === currentTenant.id)?.role ?? null
    : null;

  const setCurrentTenant = useCallback((tenant: Tenant | null) => {
    if (tenant) {
      localStorage.setItem('kintai_current_tenant', JSON.stringify(tenant));
    } else {
      localStorage.removeItem('kintai_current_tenant');
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
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if (authError || !authUser) throw new Error('認証情報の取得に失敗しました');

      const { data, error: fetchError } = await supabase
        .from('tenant_members')
        .select('*, tenants(*)')
        .eq('user_id', authUser.id);

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
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if (authError || !authUser) throw new Error('認証情報の取得に失敗しました');

      const inviteCode = crypto.randomUUID().substring(0, 6).toUpperCase();

      const { data: tenantData, error: tenantError } = await supabase
        .from('tenants')
        .insert({ name, invite_code: inviteCode, owner_id: authUser.id })
        .select()
        .single();

      if (tenantError) throw tenantError;

      const { error: memberError } = await supabase
        .from('tenant_members')
        .insert({
          tenant_id: tenantData.id,
          user_id: authUser.id,
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
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if (authError || !authUser) throw new Error('認証情報の取得に失敗しました');

      const { data: tenantData, error: tenantError } = await supabase
        .from('tenants')
        .select('*')
        .eq('invite_code', inviteCode)
        .single();

      if (tenantError || !tenantData) throw new Error('無効な招待コードです');

      // 既存メンバーシップの重複チェック
      const { data: existingMember } = await supabase
        .from('tenant_members')
        .select('id')
        .eq('tenant_id', tenantData.id)
        .eq('user_id', authUser.id)
        .maybeSingle();

      if (existingMember) throw new Error('すでにこのテナントに参加しています');

      const { error: memberError } = await supabase
        .from('tenant_members')
        .insert({
          tenant_id: tenantData.id,
          user_id: authUser.id,
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

  // ログイン時にテナント一覧を取得
  useEffect(() => {
    if (!user) {
      setTenants([]);
      setCurrentTenantState(null);
      setMembers([]);
      localStorage.removeItem('kintai_current_tenant');
      setLoading(false);
      return;
    }

    fetchTenants().then(fetchedTenants => {
      const saved = localStorage.getItem('kintai_current_tenant');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          const found = fetchedTenants.find(t => t.id === parsed.id);
          if (found) {
            setCurrentTenantState(found);
            fetchMembers(found.id);
          } else {
            // 保存されたテナントが見つからない場合はクリア
            localStorage.removeItem('kintai_current_tenant');
            setCurrentTenantState(null);
          }
        } catch {
          localStorage.removeItem('kintai_current_tenant');
          setCurrentTenantState(null);
        }
      }
    });
  }, [user, fetchTenants, fetchMembers]);

  // テナント切替時にメンバーを再取得
  useEffect(() => {
    if (currentTenant) {
      fetchMembers(currentTenant.id);
    } else {
      setMembers([]);
    }
  }, [currentTenant, fetchMembers]);

  return (
    <TenantContext.Provider value={{
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
    }}>
      {children}
    </TenantContext.Provider>
  );
};

export function useTenant(): TenantContextType {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
}
