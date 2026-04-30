import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { formatSupabaseError } from '../lib/errors';
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
  regenerateInviteCode: (
    tenantId?: string,
    opts?: {
      expiresInDays?: 1 | 7 | 30 | null;
      maxUses?: 1 | 3 | 10 | null;
    }
  ) => Promise<string>;
  updateTenantName: (tenantId: string, newName: string) => Promise<void>;
  leaveTenant: () => Promise<void>;
  deleteTenant: () => Promise<void>;
  transferOwnership: (newOwnerUserId: string) => Promise<void>;
  loading: boolean;
  error: string | null;
  isOwner: boolean;
  isManager: boolean;
  isStaff: boolean;
  myMemberId: string | null;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading: authLoading } = useAuth();

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

  const myMemberId = currentTenant
    ? tenants.find(t => t.id === currentTenant.id)?.member_id ?? null
    : null;

  const isOwner = myRole === 'owner';
  const isManager = myRole === 'manager';
  const isStaff = myRole === 'staff';

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
    } catch (err: unknown) {
      logger.error('Failed to fetch members:', formatSupabaseError(err));
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
        id: string;
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
          deleted_at: item.tenants!.deleted_at ?? null,
          role: item.role as UserRole,
          display_name: item.display_name,
          member_id: item.id,
        }));

      setTenants(mappedTenants);
      return mappedTenants;
    } catch (err: unknown) {
      setError(formatSupabaseError(err).message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const generateUniqueInviteCode = useCallback(async (): Promise<string> => {
    let inviteCode: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = crypto.randomUUID().substring(0, 6).toUpperCase();
      const { data: existing } = await supabase
        .from('tenants')
        .select('id')
        .eq('invite_code', candidate)
        .maybeSingle();
      if (!existing) {
        inviteCode = candidate;
        break;
      }
    }
    if (!inviteCode) throw new Error('招待コードの生成に失敗しました。再度お試しください。');
    return inviteCode;
  }, []);

  const createTenant = useCallback(async (name: string, displayName: string): Promise<Tenant> => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if (authError || !authUser) throw new Error('認証情報の取得に失敗しました');

      const inviteCode = await generateUniqueInviteCode();

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
    } catch (err: unknown) {
      setError(formatSupabaseError(err).message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [generateUniqueInviteCode]);

  const joinTenant = useCallback(async (inviteCode: string, displayName: string): Promise<Tenant> => {
    setLoading(true);
    setError(null);
    try {
      // L12 Phase 2 (Reviewer M3): atomic な join — SELECT FOR UPDATE → 検証 → INSERT → +1 を
      // 1 トランザクションで完結する RPC に集約。フロント側で SELECT/INSERT を分けると
      // 上限 1 のコードに同時 join した際、両者が tenant_members INSERT に成功してしまう。
      const { data: joinedTenantId, error: rpcError } = await supabase.rpc('join_tenant_with_invite', {
        p_invite_code: inviteCode,
        p_display_name: displayName,
      });

      if (rpcError) {
        const msg = (rpcError.message || '').toLowerCase();
        if (msg.includes('not authenticated')) throw new Error('認証情報の取得に失敗しました');
        if (msg.includes('display name required')) throw new Error('表示名を入力してください');
        if (msg.includes('not found')) throw new Error('無効な招待コードです');
        if (msg.includes('expired')) throw new Error('招待コードの有効期限が切れています');
        if (msg.includes('max uses')) throw new Error('招待コードの使用回数上限に達しています');
        if (msg.includes('already a member')) throw new Error('すでにこのテナントに参加しています');
        throw new Error(formatSupabaseError(rpcError).message);
      }

      if (!joinedTenantId) throw new Error('参加処理に失敗しました');

      // 戻り値の互換維持: 参加した tenants 行を取得して返す
      const { data: tenantData, error: fetchError } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', joinedTenantId)
        .single();

      if (fetchError || !tenantData) throw new Error('参加先テナントの取得に失敗しました');

      return tenantData as Tenant;
    } catch (err: unknown) {
      setError(formatSupabaseError(err).message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const regenerateInviteCode = useCallback(async (
    tenantId?: string,
    opts?: {
      expiresInDays?: 1 | 7 | 30 | null;
      maxUses?: 1 | 3 | 10 | null;
    }
  ): Promise<string> => {
    if (!currentTenant) throw new Error('テナントが選択されていません');
    if (myRole !== 'owner') throw new Error('オーナーのみ実行可能です');

    const targetId = tenantId ?? currentTenant.id;
    if (targetId !== currentTenant.id) {
      throw new Error('現在選択中のテナントのみ再発行できます');
    }

    setLoading(true);
    setError(null);
    try {
      const newCode = await generateUniqueInviteCode();

      const expiresAt =
        opts?.expiresInDays != null && opts.expiresInDays > 0
          ? new Date(Date.now() + opts.expiresInDays * 86400000).toISOString()
          : null;
      const maxUses = opts?.maxUses ?? null;

      const updatePayload: {
        invite_code: string;
        invite_code_expires_at: string | null;
        invite_code_max_uses: number | null;
        invite_code_used_count: number;
      } = {
        invite_code: newCode,
        invite_code_expires_at: expiresAt,
        invite_code_max_uses: maxUses,
        invite_code_used_count: 0,
      };

      const { error: updateError } = await supabase
        .from('tenants')
        .update(updatePayload)
        .eq('id', targetId)
        .select()
        .single();

      if (updateError) throw updateError;

      setCurrentTenant({
        ...currentTenant,
        invite_code: newCode,
        invite_code_expires_at: expiresAt,
        invite_code_max_uses: maxUses,
        invite_code_used_count: 0,
      });
      await fetchTenants();

      return newCode;
    } catch (err: unknown) {
      setError(formatSupabaseError(err).message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentTenant, myRole, generateUniqueInviteCode, setCurrentTenant, fetchTenants]);

  const updateTenantName = useCallback(async (tenantId: string, newName: string): Promise<void> => {
    if (myRole !== 'owner') throw new Error('オーナーのみ実行可能です');
    if (!currentTenant) throw new Error('テナントが選択されていません');
    if (currentTenant.id !== tenantId) throw new Error('現在選択中のテナントのみ更新できます');
    setLoading(true);
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from('tenants')
        .update({ name: newName })
        .eq('id', tenantId)
        .select()
        .single();

      if (updateError) throw updateError;

      setCurrentTenant({ ...currentTenant, name: newName });
      await fetchTenants();
    } catch (err: unknown) {
      setError(formatSupabaseError(err).message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentTenant, myRole, setCurrentTenant, fetchTenants]);

  const leaveTenant = useCallback(async (): Promise<void> => {
    if (!currentTenant) throw new Error('テナントが選択されていません');
    if (isOwner) throw new Error('オーナーは脱退できません。先に他のメンバーにオーナー権を移譲してください');
    if (!myMemberId) throw new Error('メンバー情報の取得に失敗しました');

    setLoading(true);
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from('tenant_members')
        .delete()
        .eq('id', myMemberId);

      if (deleteError) throw deleteError;

      setCurrentTenant(null);
      await fetchTenants();
    } catch (err: unknown) {
      setError(formatSupabaseError(err).message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentTenant, isOwner, myMemberId, setCurrentTenant, fetchTenants]);

  const transferOwnership = useCallback(async (newOwnerUserId: string): Promise<void> => {
    if (!currentTenant) throw new Error('テナントが選択されていません');
    if (!isOwner) throw new Error('オーナーのみ実行可能です');
    setLoading(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('transfer_tenant_ownership', {
        p_tenant_id: currentTenant.id,
        p_new_owner_user_id: newOwnerUserId,
      });
      if (rpcError) throw rpcError;
      await fetchTenants();
    } catch (err: unknown) {
      setError(formatSupabaseError(err).message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentTenant, isOwner, fetchTenants]);

  const deleteTenant = useCallback(async (): Promise<void> => {
    if (!currentTenant) throw new Error('テナントが選択されていません');
    if (!isOwner) throw new Error('オーナーのみ実行可能です');
    setLoading(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('soft_delete_tenant', {
        p_tenant_id: currentTenant.id,
      });
      if (rpcError) throw rpcError;
      setCurrentTenant(null);
      await fetchTenants();
    } catch (err: unknown) {
      setError(formatSupabaseError(err).message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentTenant, isOwner, setCurrentTenant, fetchTenants]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setTenants([]);
      setCurrentTenantState(null);
      setMembers([]);
      localStorage.removeItem('kintai_current_tenant');
      setLoading(false);
      return;
    }

    fetchTenants()
      .then(fetchedTenants => {
        const saved = localStorage.getItem('kintai_current_tenant');
        if (!saved) return;
        let parsed: Tenant;
        try {
          parsed = JSON.parse(saved);
        } catch {
          // JSON 破損のみ削除（真に復元不能）
          localStorage.removeItem('kintai_current_tenant');
          setCurrentTenantState(null);
          return;
        }
        // fetch 結果が空 → RLS 反映遅延 / 一時的エラーの可能性が高いので保持
        // （Loop 39 真因対応: 起動時の誤った redirect を防ぐ）
        if (!fetchedTenants || fetchedTenants.length === 0) {
          setCurrentTenantState(parsed);
          fetchMembers(parsed.id);
          return;
        }
        const found = fetchedTenants.find(t => t.id === parsed.id);
        if (found) {
          setCurrentTenantState(found);
          fetchMembers(found.id);
        } else {
          // 他 tenant はあるが saved は含まれない = 真に削除されたテナント
          localStorage.removeItem('kintai_current_tenant');
          setCurrentTenantState(null);
        }
      })
      .catch(err => {
        // fetch 自体が失敗した場合は saved を保持（次回起動時に再試行）
        console.warn('[TenantContext] fetchTenants failed, keeping saved tenant:', err);
        const saved = localStorage.getItem('kintai_current_tenant');
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as Tenant;
            setCurrentTenantState(parsed);
            fetchMembers(parsed.id);
          } catch {
            localStorage.removeItem('kintai_current_tenant');
            setCurrentTenantState(null);
          }
        }
      });
  }, [user, authLoading, fetchTenants, fetchMembers]);

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
      regenerateInviteCode,
      updateTenantName,
      leaveTenant,
      deleteTenant,
      transferOwnership,
      loading,
      error,
      isOwner,
      isManager,
      isStaff,
      myMemberId,
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
