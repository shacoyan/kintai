import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { logger } from '../lib/logger';
import { clearPendingJoinCode } from '../lib/inviteUrl';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { formatSupabaseError } from '../lib/errors';
import type {
  Tenant,
  TenantMember,
  TenantWithRole,
  UserRole,
  InviteCode,
  InviteCodeStore,
  IssueInviteCodeOptions,
  UpdateInviteCodeOptions,
} from '../types';

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
  updateInviteSettings: (
    tenantId?: string,
    opts?: {
      expiresInDays?: 1 | 7 | 30 | null;
      maxUses?: 1 | 3 | 10 | null;
      storeIds?: string[];
    }
  ) => Promise<void>;
  updateTenantName: (tenantId: string, newName: string) => Promise<void>;
  // === 2026-05-12 per-store invite URL ===
  listInviteCodes: (tenantId?: string) => Promise<InviteCode[]>;
  issueInviteCode: (tenantId: string, opts: IssueInviteCodeOptions) => Promise<InviteCode>;
  updateInviteCode: (codeId: string, opts: UpdateInviteCodeOptions) => Promise<void>;
  revokeInviteCode: (codeId: string) => Promise<void>;
  leaveTenant: () => Promise<void>;
  deleteTenant: () => Promise<void>;
  transferOwnership: (newOwnerUserId: string) => Promise<void>;
  loading: boolean;
  error: string | null;
  isOwner: boolean;
  isManager: boolean;
  isStaff: boolean;
  myMemberId: string | null;
  // === 2026-05-22 タスク管理 Phase 1 (Loop 3) ===
  // tenant_members.is_parttime (056_tenant_members_parttime.sql)
  // staff のうち is_parttime=true の場合 Tasks の権限を厳密化 (§3-5)
  isParttime: boolean;
  // === 2026-05-22 タスク管理 Phase 1 Loop 4 P0-2 fix ===
  // store_members から自分の所属店舗 ID 配列を保持。
  // ProjectsPage.canEdit が「staff は自店舗のみ編集可」を厳密判定するために使用。
  // 初期値 []、currentTenant 変更時に fetch。
  myStoreIds: string[];
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
  // 2026-05-22 タスク管理 Phase 1 (Loop 3) — 自分の is_parttime を保持
  // tenant_members_visible view は is_parttime 列を含まないため、本人 row を別途 fetch する
  const [isParttime, setIsParttime] = useState<boolean>(false);
  // 2026-05-22 タスク管理 Phase 1 Loop 4 P0-2 fix — 自分の所属店舗 ID 配列
  // store_members を myMemberId で SELECT して store_id 配列に変換して保持。
  // ProjectsPage.canEdit (staff: 自店舗のみ編集可) で参照される。
  const [myStoreIds, setMyStoreIds] = useState<string[]>([]);

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

  // 2026-05-22 タスク管理 Phase 1 (Loop 3) — 自分の is_parttime を fetch
  // tenant_members_visible view は is_parttime 列を含まないため tenant_members 直接 SELECT。
  // 既存 RLS (017) で本人 row は SELECT 可。失敗時は false に倒す (デフォルト挙動)。
  const fetchMyParttime = useCallback(async (tenantId: string, userId: string) => {
    try {
      const { data, error: fetchError } = await supabase
        .from('tenant_members')
        .select('is_parttime')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchError) throw fetchError;
      setIsParttime(data?.is_parttime ?? false);
    } catch (err: unknown) {
      logger.error('Failed to fetch is_parttime:', formatSupabaseError(err));
      setIsParttime(false);
    }
  }, []);

  // 2026-05-22 タスク管理 Phase 1 Loop 4 P0-2 fix — 自分の store_members を fetch
  // store_members.member_id = tenant_members.id (= myMemberId) でフィルタし、
  // store_id 配列を保持する。owner/manager でも staff でも同じ方式で取得。
  // 失敗時は [] に倒す (フェイルクローズ = 編集権限を与えない)。
  const fetchMyStoreIds = useCallback(async (memberId: string) => {
    try {
      const { data, error: fetchError } = await supabase
        .from('store_members')
        .select('store_id')
        .eq('member_id', memberId);

      if (fetchError) throw fetchError;
      const ids = (data ?? []).map((r: { store_id: string }) => r.store_id);
      setMyStoreIds(ids);
    } catch (err: unknown) {
      logger.error('Failed to fetch my store_ids:', formatSupabaseError(err));
      setMyStoreIds([]);
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
      // 2026-05-12: v2 → v3 切替 (per-store invite URL)。
      // tenant_invite_codes 行ロック → 検証 → tenant_members INSERT → invite_code_stores から
      // store_members 自動 attach までを atomic に実行。
      const { data: joinedTenantId, error: rpcError } = await supabase.rpc('join_tenant_with_invite_v3', {
        p_invite_code: inviteCode,
        p_display_name: displayName,
      });

      if (rpcError) {
        const msg = (rpcError.message || '').toLowerCase();
        if (msg.includes('not_authenticated')) throw new Error('認証情報の取得に失敗しました');
        if (msg.includes('display_name_required')) throw new Error('表示名を入力してください');
        if (msg.includes('display_name_too_long')) throw new Error('表示名は 30 文字以内で入力してください');
        if (msg.includes('invite_code_not_found')) throw new Error('無効な招待コードです');
        if (msg.includes('invite_code_expired')) throw new Error('招待コードの有効期限が切れています');
        if (msg.includes('invite_code_max_uses_reached')) throw new Error('招待コードの使用回数上限に達しています');
        if (msg.includes('already_a_member')) throw new Error('すでにこのテナントに参加しています');
        if (msg.includes('tenant_not_found')) throw new Error('参加先テナントが見つかりません');
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

  const updateInviteSettings = useCallback(async (
    tenantId?: string,
    opts?: {
      expiresInDays?: 1 | 7 | 30 | null;
      maxUses?: 1 | 3 | 10 | null;
      storeIds?: string[];
    }
  ): Promise<void> => {
    if (!currentTenant) throw new Error('テナントが選択されていません');
    if (myRole !== 'owner' && myRole !== 'manager') {
      throw new Error('オーナーまたは店長のみ実行可能です');
    }

    const targetId = tenantId ?? currentTenant.id;
    if (targetId !== currentTenant.id) {
      throw new Error('現在選択中のテナントのみ更新できます');
    }

    setLoading(true);
    setError(null);
    try {
      const expiresAt =
        opts?.expiresInDays != null && opts.expiresInDays > 0
          ? new Date(Date.now() + opts.expiresInDays * 86400000).toISOString()
          : null;
      const maxUses = opts?.maxUses ?? null;
      // storeIds 未指定 (undefined) → null を渡し RPC 側で既存紐付けを保持。
      // 明示的に [] を渡された場合のみ全削除（クリア）。045 / 048 で同型 semantics。
      const storeIds = opts?.storeIds === undefined ? null : opts.storeIds;

      const { error: rpcError } = await supabase.rpc('update_invite_code_settings', {
        p_tenant_id: targetId,
        p_expires_at: expiresAt,
        p_max_uses: maxUses,
        p_store_ids: storeIds,
      });

      if (rpcError) {
        const msg = (rpcError.message || '').toLowerCase();
        if (msg.includes('invite_code_missing')) {
          // 専用エラーオブジェクトで投げる → caller がフォールバック判定可能。
          const err = new Error('invite_code_missing');
          (err as Error & { code?: string }).code = 'INVITE_CODE_MISSING';
          throw err;
        }
        if (msg.includes('not_authorized')) throw new Error('オーナーまたは店長のみ実行可能です');
        if (msg.includes('cross_tenant_store')) throw new Error('指定された店舗がテナントに属していません');
        if (msg.includes('invalid_max_uses')) throw new Error('使用回数上限の値が無効です');
        throw new Error(formatSupabaseError(rpcError).message);
      }

      // 楽観更新: invite_code / invite_code_used_count は touch しない（設定のみ更新）。
      setCurrentTenant({
        ...currentTenant,
        invite_code_expires_at: expiresAt,
        invite_code_max_uses: maxUses,
      });
      await fetchTenants();
    } catch (err: unknown) {
      setError(formatSupabaseError(err).message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentTenant, myRole, setCurrentTenant, fetchTenants]);

  const joinTenantViaUrl = useCallback(async (code: string, displayName: string): Promise<Tenant> => {
    // URL 経由 join のラッパ。成功時のみ pending_join_code を消す。
    // エラー時は JoinPage 側で「ホームへ戻る」ボタンや再試行に応じて clear する責務を持たせる。
    const result = await joinTenant(code, displayName);
    clearPendingJoinCode();
    return result;
  }, [joinTenant]);

  // === 2026-05-12 per-store invite URL: 新 API 4 個 ===
  // 設計書: .company/engineering/docs/2026-05-12-kintai-invite-url-per-store-techdesign.md §7.3

  const listInviteCodes = useCallback(async (tenantId?: string): Promise<InviteCode[]> => {
    const targetId = tenantId ?? currentTenant?.id;
    if (!targetId) throw new Error('テナントが選択されていません');

    // SELECT 1: active な tenant_invite_codes 行
    const { data: codeRows, error: codeError } = await supabase
      .from('tenant_invite_codes')
      .select('id, tenant_id, code, expires_at, max_uses, used_count, created_by, created_at, revoked_at, label')
      .eq('tenant_id', targetId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });

    if (codeError) throw codeError;
    const codes = (codeRows ?? []) as Array<Omit<InviteCode, 'stores'>>;
    if (codes.length === 0) return [];

    // SELECT 2: tenant_invite_code_stores を invite_code_id IN (...) で fetch
    const codeIds = codes.map((c) => c.id);
    interface StoreJoinRow {
      invite_code_id: string;
      store_id: string;
      sort_order: number;
      stores: { id: string; name: string } | null;
    }
    const { data: storeRows, error: storeError } = await supabase
      .from('tenant_invite_code_stores')
      .select('invite_code_id, store_id, sort_order, stores(id, name)')
      .in('invite_code_id', codeIds)
      .order('sort_order');

    if (storeError) throw storeError;

    // composition: invite_code_id → InviteCodeStore[]
    const storesByCodeId = new Map<string, InviteCodeStore[]>();
    for (const raw of (storeRows ?? []) as unknown as StoreJoinRow[]) {
      const list = storesByCodeId.get(raw.invite_code_id) ?? [];
      list.push({
        store_id: raw.store_id,
        store_name: raw.stores?.name ?? '',
        sort_order: raw.sort_order,
      });
      storesByCodeId.set(raw.invite_code_id, list);
    }

    return codes.map((c) => ({
      ...c,
      stores: storesByCodeId.get(c.id) ?? [],
    }));
  }, [currentTenant]);

  const issueInviteCode = useCallback(async (
    tenantId: string,
    opts: IssueInviteCodeOptions,
  ): Promise<InviteCode> => {
    const expiresAt =
      opts.expiresInDays != null && opts.expiresInDays > 0
        ? new Date(Date.now() + opts.expiresInDays * 86400000).toISOString()
        : null;

    const { data: newId, error: rpcError } = await supabase.rpc('issue_tenant_invite_code', {
      p_tenant_id: tenantId,
      p_expires_at: expiresAt,
      p_max_uses: opts.maxUses ?? null,
      p_store_ids: opts.storeIds,
      p_label: opts.label ?? null,
    });

    if (rpcError) {
      const msg = (rpcError.message || '').toLowerCase();
      if (msg.includes('not_authorized')) throw new Error('オーナーまたは店長のみ実行可能です');
      if (msg.includes('invalid_max_uses')) throw new Error('使用回数上限の値が無効です');
      if (msg.includes('label_too_long')) throw new Error('メモは 40 文字以内で入力してください');
      if (msg.includes('too_many_active_codes')) throw new Error('このテナントの有効な招待URLが上限 (50) に達しています');
      if (msg.includes('duplicate_invite_code')) throw new Error('招待コードの生成に失敗しました。もう一度お試しください。');
      throw new Error(formatSupabaseError(rpcError).message);
    }

    if (!newId) throw new Error('招待URLの発行に失敗しました');

    // 新規行を id 指定で再 fetch (race 回避)
    const { data: codeRow, error: codeError } = await supabase
      .from('tenant_invite_codes')
      .select('id, tenant_id, code, expires_at, max_uses, used_count, created_by, created_at, revoked_at, label')
      .eq('id', newId)
      .single();

    if (codeError || !codeRow) throw new Error('発行した招待URLの取得に失敗しました');

    interface StoreJoinRow {
      store_id: string;
      sort_order: number;
      stores: { id: string; name: string } | null;
    }
    const { data: storeRows } = await supabase
      .from('tenant_invite_code_stores')
      .select('store_id, sort_order, stores(id, name)')
      .eq('invite_code_id', newId)
      .order('sort_order');

    const stores: InviteCodeStore[] = ((storeRows ?? []) as unknown as StoreJoinRow[]).map((r) => ({
      store_id: r.store_id,
      store_name: r.stores?.name ?? '',
      sort_order: r.sort_order,
    }));

    return { ...(codeRow as Omit<InviteCode, 'stores'>), stores };
  }, []);

  const updateInviteCode = useCallback(async (
    codeId: string,
    opts: UpdateInviteCodeOptions,
  ): Promise<void> => {
    // 045/048 と同型 semantics: undefined=null (保持) / []=空配列 (全削除) / 配列=置換
    const expiresAt =
      opts.expiresInDays === undefined
        ? null
        : opts.expiresInDays != null && opts.expiresInDays > 0
        ? new Date(Date.now() + opts.expiresInDays * 86400000).toISOString()
        : null;
    const maxUses = opts.maxUses === undefined ? null : opts.maxUses;
    const storeIds = opts.storeIds === undefined ? null : opts.storeIds;
    const label = opts.label === undefined ? null : opts.label;

    const { error: rpcError } = await supabase.rpc('update_tenant_invite_code', {
      p_code_id: codeId,
      p_expires_at: expiresAt,
      p_max_uses: maxUses,
      p_store_ids: storeIds,
      p_label: label,
    });

    if (rpcError) {
      const msg = (rpcError.message || '').toLowerCase();
      if (msg.includes('invite_code_not_found')) throw new Error('招待URLが見つかりません');
      if (msg.includes('not_authorized')) throw new Error('オーナーまたは店長のみ実行可能です');
      if (msg.includes('invalid_max_uses')) throw new Error('使用回数上限の値が無効です');
      if (msg.includes('label_too_long')) throw new Error('メモは 40 文字以内で入力してください');
      throw new Error(formatSupabaseError(rpcError).message);
    }
  }, []);

  const revokeInviteCode = useCallback(async (codeId: string): Promise<void> => {
    const { error: rpcError } = await supabase.rpc('revoke_tenant_invite_code', {
      p_code_id: codeId,
    });

    if (rpcError) {
      const msg = (rpcError.message || '').toLowerCase();
      if (msg.includes('not_authorized')) throw new Error('オーナーまたは店長のみ実行可能です');
      throw new Error(formatSupabaseError(rpcError).message);
    }
  }, []);

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
  // 2026-05-13 Track B: 依存配列を user → user?.id に変更。
  // AuthContext の setUser は id 同一なら参照保持するよう Track B で修正済だが、
  // 防御層として依存配列側も userId 比較に揃え、TOKEN_REFRESHED race で fetchTenants が
  // 再走→setLoading(true)→RequireTenant 配下 tree unmount を起こさないようにする。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading, fetchTenants, fetchMembers]);

  // 2026-05-13 Track B: 依存配列を user → user?.id に変更 (TOKEN_REFRESHED → state reset race 回避)。
  // 2026-05-22 Loop 4 P0-2: myStoreIds も同じタイミングで fetch (myMemberId が確定したら)。
  useEffect(() => {
    if (currentTenant) {
      fetchMembers(currentTenant.id);
      if (user?.id) {
        fetchMyParttime(currentTenant.id, user.id);
      }
      if (myMemberId) {
        fetchMyStoreIds(myMemberId);
      } else {
        setMyStoreIds([]);
      }
    } else {
      setMembers([]);
      setIsParttime(false);
      setMyStoreIds([]);
    }
  }, [currentTenant?.id, user?.id, myMemberId, fetchMembers, fetchMyParttime, fetchMyStoreIds]);

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
      updateInviteSettings,
      listInviteCodes,
      issueInviteCode,
      updateInviteCode,
      revokeInviteCode,
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
      isParttime,
      myStoreIds,
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
