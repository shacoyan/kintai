import { useState, useCallback } from 'react';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { formatSupabaseError, type FriendlyError } from '../lib/errors';
import type { Store, StoreMember } from '../types';

export function useStore(tenantId: string) {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeMembers, setStoreMembers] = useState<StoreMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [friendlyError, setFriendlyError] = useState<FriendlyError | null>(null);
  const clearError = useCallback(() => {
    setError(null);
    setFriendlyError(null);
  }, []);

  const fetchStores = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('name');
      if (error) throw error;
      setStores((data as Store[]) || []);
    } catch (err) {
      logger.error('fetchStores error:', formatSupabaseError(err));
      const f = formatSupabaseError(err);
      setError(f.message);
      setFriendlyError(f);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  const createStore = useCallback(async (name: string) => {
    try {
      const { data, error } = await supabase
        .from('stores')
        .insert({ tenant_id: tenantId, name })
        .select()
        .single();
      if (error) throw new Error(`店舗の作成に失敗しました: ${formatSupabaseError(error).message}`);
      await fetchStores();
      return data as Store;
    } catch (err) {
      logger.error('createStore error:', formatSupabaseError(err));
      const f = formatSupabaseError(err);
      setError(f.message);
      setFriendlyError(f);
      throw err;
    }
  }, [tenantId, fetchStores]);

  const updateStore = useCallback(async (storeId: string, name: string) => {
    try {
      const { error } = await supabase
        .from('stores')
        .update({ name })
        .eq('id', storeId);
      if (error) throw new Error(`店舗名の更新に失敗しました: ${formatSupabaseError(error).message}`);
      await fetchStores();
    } catch (err) {
      logger.error('updateStore error:', formatSupabaseError(err));
      const f = formatSupabaseError(err);
      setError(f.message);
      setFriendlyError(f);
      throw err;
    }
  }, [fetchStores]);

  const deleteStore = useCallback(async (storeId: string) => {
    try {
      const { error } = await supabase
        .from('stores')
        .delete()
        .eq('id', storeId);
      if (error) throw new Error(`店舗の削除に失敗しました: ${formatSupabaseError(error).message}`);
      await fetchStores();
    } catch (err) {
      logger.error('deleteStore error:', formatSupabaseError(err));
      const f = formatSupabaseError(err);
      setError(f.message);
      setFriendlyError(f);
      throw err;
    }
  }, [fetchStores]);

  const fetchStoreMembers = useCallback(async (storeId: string) => {
    try {
      const { data, error } = await supabase
        .from('store_members')
        .select('*')
        .eq('store_id', storeId);
      if (error) throw error;
      setStoreMembers((data as StoreMember[]) || []);
    } catch (err) {
      logger.error('fetchStoreMembers error:', formatSupabaseError(err));
      const f = formatSupabaseError(err);
      setError(f.message);
      setFriendlyError(f);
      throw err;
    }
  }, []);

  const addStoreMember = useCallback(async (storeId: string, memberId: string, isPrimary: boolean = false) => {
    try {
      const { error } = await supabase
        .from('store_members')
        .insert({ store_id: storeId, member_id: memberId, is_primary: isPrimary });
      if (error) throw new Error(`メンバーの追加に失敗しました: ${formatSupabaseError(error).message}`);
      await fetchStoreMembers(storeId);
    } catch (err) {
      logger.error('addStoreMember error:', formatSupabaseError(err));
      const f = formatSupabaseError(err);
      setError(f.message);
      setFriendlyError(f);
      throw err;
    }
  }, [fetchStoreMembers]);

  const removeStoreMember = useCallback(async (storeId: string, memberId: string) => {
    try {
      const { error } = await supabase
        .from('store_members')
        .delete()
        .eq('store_id', storeId)
        .eq('member_id', memberId);
      if (error) throw new Error(`メンバーの削除に失敗しました: ${formatSupabaseError(error).message}`);
      await fetchStoreMembers(storeId);
    } catch (err) {
      logger.error('removeStoreMember error:', formatSupabaseError(err));
      const f = formatSupabaseError(err);
      setError(f.message);
      setFriendlyError(f);
      throw err;
    }
  }, [fetchStoreMembers]);

  const setMemberPrimary = useCallback(async (storeId: string, memberId: string) => {
    try {
      const { error } = await supabase
        .from('store_members')
        .update({ is_primary: true })
        .eq('store_id', storeId)
        .eq('member_id', memberId);
      if (error) throw error;
      await fetchStoreMembers(storeId);
    } catch (err) {
      logger.error('setMemberPrimary error:', formatSupabaseError(err));
      const f = formatSupabaseError(err);
      setError(f.message);
      setFriendlyError(f);
      throw err;
    }
  }, [fetchStoreMembers]);

  const setStoreMemberManager = useCallback(async (storeId: string, memberId: string, isManager: boolean) => {
    try {
      // E-2 TOCTOU 解消: migration 022 で新設の 3 引数版 RPC を直接呼び出す
      // （事前 select id は廃止。DB 側で store_id + member_id から行を解決＋ advisory_xact_lock）
      const { error: rpcError } = await supabase.rpc('set_store_member_manager', {
        p_store_id: storeId,
        p_member_id: memberId,
        p_is_manager: isManager,
      });

      if (rpcError) {
        // E-3 includes() 判定: PostgREST がメッセージをラップしても拾えるよう部分一致に変更
        const msg = rpcError.message ?? '';
        if (msg.includes('Store member not found')) {
          throw new Error('店舗内権限の更新に失敗しました: 対象メンバーが見つかりません');
        }
        if (msg.includes('Only tenant owner can change is_manager')) {
          throw new Error('店長権限の変更はオーナーのみ可能です');
        }
        throw new Error(`店舗内権限の更新に失敗しました: ${formatSupabaseError(rpcError).message}`);
      }

      await fetchStoreMembers(storeId);
    } catch (err) {
      logger.error('setStoreMemberManager error:', formatSupabaseError(err));
      const f = formatSupabaseError(err);
      setError(f.message);
      setFriendlyError(f);
      throw err;
    }
  }, [fetchStoreMembers]);

  return {
    stores, storeMembers, loading, error, friendlyError, clearError,
    fetchStores, createStore, updateStore, deleteStore,
    fetchStoreMembers, addStoreMember, removeStoreMember, setMemberPrimary, setStoreMemberManager,
  };
}
