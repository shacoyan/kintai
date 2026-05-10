import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { logger } from '../lib/logger';
import { clearPendingJoinCode } from '../lib/inviteUrl';
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
  joinTenantViaUrl: (code: string, displayName: string) => Promise<Tenant>;
  regenerateInviteCode: (
    tenantId?: string,
    opts?: {
      expiresInDays?: 1 | 7 | 30 | null;
      maxUses?: 1 | 3 | 10 | null;
      storeIds?: string[];
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
  needsOnboarding: boolean;
  completeOnboarding: (legalName: string, displayName: string) => Promise<void>;
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
        .from('tenant_members_visible')
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

      // Loop Reviewer BLOCKER #1: tenant_members_visible は VIEW のため PostgREST の
      // FK metadata を持たず `.select('*, tenants(*)')` の embed が runtime で 400/500 になる。
      // 2 段クエリ化: (a) member 行を取得 → (b) tenant_id 配列で tenants を別途取得 →
      // (c) JS 側で tenant_id を key に join して従来 shape を再構築。
      interface TenantMemberRow {
        id: string;
        tenant_id: string;
        role: string;
        display_name: string;
      }

      const { data: memberRows, error: memberError } = await supabase
        .from('tenant_members_visible')
        .select('id, tenant_id, role, display_name')
        .eq('user_id', authUser.id);

      if (memberError) throw memberError;

      const memberList = (memberRows || []) as TenantMemberRow[];
      const tenantIds = Array.from(new Set(memberList.map((m) => m.tenant_id)));

      let tenantsById = new Map<string, Tenant>();
      if (tenantIds.length > 0) {
        const { data: tenantRows, error: tenantError } = await supabase
          .from('tenants')
          .select('*')
          .in('id', tenantIds);

        if (tenantError) throw tenantError;
        tenantsById = new Map(((tenantRows || []) as Tenant[]).map((t) => [t.id, t]));
      }

      const mappedTenants: TenantWithRole[] = memberList
        .map((item) => {
          const tenantRow = tenantsById.get(item.tenant_id);
          if (!tenantRow) return null;
          return {
            id: tenantRow.id,
            name: tenantRow.name,
            invite_code: tenantRow.invite_code,
            created_at: tenantRow.created_at,
            owner_id: tenantRow.owner_id,
            deleted_at: tenantRow.deleted_at ?? null,
            role: item.role as UserRole,
            display_name: item.display_name,
            member_id: item.id,
          } satisfies TenantWithRole;
        })
        .filter((t): t is TenantWithRole => t !== null);

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
      const { data: joinedTenantId, error: rpcError } = await supabase.rpc('join_tenant_with_invite_v2', {
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
      storeIds?: string[];
    }
  ): Promise<string> => {
    if (!currentTenant) throw new Error('テナントが選択されていません');
    if (myRole !== 'owner' && myRole !== 'manager') throw new Error('オーナーまたは店長のみ実行可能です');

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
      // storeIds 未指定 (undefined) → null を渡し RPC 側で既存紐付けを保持。
      // 明示的に [] を渡された場合のみ全削除（クリア）。
      const storeIds = opts?.storeIds === undefined ? null : opts.storeIds;

      const { error: rpcError } = await supabase.rpc('regenerate_invite_code_with_stores', {
        p_tenant_id: targetId,
        p_new_code: newCode,
        p_expires_at: expiresAt,
        p_max_uses: maxUses,
        p_store_ids: storeIds,
      });

      if (rpcError) {
        const msg = (rpcError.message || '').toLowerCase();
        if (msg.includes('not_authorized')) throw new Error('オーナーまたは店長のみ実行可能です');
        if (msg.includes('cross_tenant_store')) throw new Error('指定された店舗がテナントに属していません');
        if (msg.includes('invalid_max_uses')) throw new Error('使用回数上限の値が無効です');
        if (msg.includes('duplicate_invite_code')) throw new Error('招待コードの生成に失敗しました。もう一度お試しください。');
        throw new Error(formatSupabaseError(rpcError).message);
      }

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

  const joinTenantViaUrl = useCallback(async (code: string, displayName: string): Promise<Tenant> => {
    // URL 経由 join のラッパ。成功時のみ pending_join_code を消す。
    // エラー時は JoinPage 側で「ホームへ戻る」ボタンや再試行に応じて clear する責務を持たせる。
    const result = await joinTenant(code, displayName);
    clearPendingJoinCode();
    return result;
  }, [joinTenant]);

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

  const completeOnboarding = useCallback(
    async (legalName: string, displayName: string) => {
      if (!currentTenant) throw new Error('no current tenant');
      const { error: rpcError } = await supabase.rpc('complete_onboarding', {
        p_tenant_id: currentTenant.id,
        p_legal_name: legalName,
        p_display_name: displayName,
      });
      if (rpcError) throw rpcError;
      await fetchTenants();
      await fetchMembers(currentTenant.id);
    },
    [currentTenant, fetchTenants, fetchMembers]
  );

  const verifyTenantStillAccessible = async (tenantId: string): Promise<'ok' | 'gone' | 'transient'> => {
    try {
      const { error, status } = await supabase
        .from('tenant_members_visible')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);

      if (error) {
        if (status === 403 || status === 404 || error.code === 'PGRST301') {
          return 'gone';
        }
        return 'transient';
      }

      return 'ok';
    } catch {
      return 'transient';
    }
  };

  useEffect(() => {
    let cancelled = false;

    if (authLoading) return;

    if (!user) {
      setTenants([]);
      setCurrentTenantState(null);
      setMembers([]);
      localStorage.removeItem('kintai_current_tenant');
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const fetchedTenants = await fetchTenants();
        if (cancelled) return;

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
          // 他 tenant はあるが saved は含まれない → 2段階検証
          const result = await verifyTenantStillAccessible(parsed.id);
          if (cancelled) return;

          if (result === 'gone') {
            localStorage.removeItem('kintai_current_tenant');
            setCurrentTenantState(null);
          } else {
            // 'transient' / 'ok' は保持
            setCurrentTenantState(parsed);
            fetchMembers(parsed.id);
          }
        }
      } catch (err) {
        if (cancelled) return;

        // fetch 自体が失敗 (将来 throw 化対応含む保険)。saved は UX 観点で一時 restore する。再 fetch トリガーは存在せず、user/authLoading 再評価時のみ再実行される。
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
      }
    })();

    return () => { cancelled = true; };
  }, [user, authLoading, fetchTenants, fetchMembers]);

  useEffect(() => {
    if (currentTenant) {
      fetchMembers(currentTenant.id);
    } else {
      setMembers([]);
    }
  }, [currentTenant, fetchMembers]);

  const myMember = currentTenant && user
    ? members.find((m) => m.user_id === user.id && m.tenant_id === currentTenant.id) ?? null
    : null;
  const needsOnboarding = !!myMember && myMember.legal_name == null;

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
      joinTenantViaUrl,
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
      needsOnboarding,
      completeOnboarding,
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
