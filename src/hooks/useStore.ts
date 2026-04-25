import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Store, StoreMember } from '../types';

export function useStore(tenantId: string) {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeMembers, setStoreMembers] = useState<StoreMember[]>([]);
  const [loading, setLoading] = useState(false);

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
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  const createStore = useCallback(async (name: string) => {
    const { data, error } = await supabase
      .from('stores')
      .insert({ tenant_id: tenantId, name })
      .select()
      .single();
    if (error) throw new Error(`店舗の作成に失敗しました: ${error.message}`);
    await fetchStores();
    return data as Store;
  }, [tenantId, fetchStores]);

  const updateStore = useCallback(async (storeId: string, name: string) => {
    const { error } = await supabase
      .from('stores')
      .update({ name })
      .eq('id', storeId);
    if (error) throw new Error(`店舗名の更新に失敗しました: ${error.message}`);
    await fetchStores();
  }, [fetchStores]);

  const deleteStore = useCallback(async (storeId: string) => {
    const { error } = await supabase
      .from('stores')
      .delete()
      .eq('id', storeId);
    if (error) throw new Error(`店舗の削除に失敗しました: ${error.message}`);
    await fetchStores();
  }, [fetchStores]);

  const fetchStoreMembers = useCallback(async (storeId: string) => {
    const { data, error } = await supabase
      .from('store_members')
      .select('*')
      .eq('store_id', storeId);
    if (error) throw error;
    setStoreMembers((data as StoreMember[]) || []);
  }, []);

  const addStoreMember = useCallback(async (storeId: string, memberId: string, isPrimary: boolean = false) => {
    const { error } = await supabase
      .from('store_members')
      .insert({ store_id: storeId, member_id: memberId, is_primary: isPrimary });
    if (error) throw new Error(`メンバーの追加に失敗しました: ${error.message}`);
    await fetchStoreMembers(storeId);
  }, [fetchStoreMembers]);

  const removeStoreMember = useCallback(async (storeId: string, memberId: string) => {
    const { error } = await supabase
      .from('store_members')
      .delete()
      .eq('store_id', storeId)
      .eq('member_id', memberId);
    if (error) throw new Error(`メンバーの削除に失敗しました: ${error.message}`);
    await fetchStoreMembers(storeId);
  }, [fetchStoreMembers]);

  const setMemberPrimary = useCallback(async (storeId: string, memberId: string) => {
    const { error } = await supabase
      .from('store_members')
      .update({ is_primary: true })
      .eq('store_id', storeId)
      .eq('member_id', memberId);
    if (error) throw error;
    await fetchStoreMembers(storeId);
  }, [fetchStoreMembers]);

  const setStoreMemberManager = useCallback(async (storeId: string, memberId: string, isManager: boolean) => {
    const { error } = await supabase
      .from('store_members')
      .update({ is_manager: isManager })
      .eq('store_id', storeId)
      .eq('member_id', memberId);
    if (error) throw new Error(`店舗内権限の更新に失敗しました: ${error.message}`);
    await fetchStoreMembers(storeId);
  }, [fetchStoreMembers]);

  return {
    stores, storeMembers, loading,
    fetchStores, createStore, updateStore, deleteStore,
    fetchStoreMembers, addStoreMember, removeStoreMember, setMemberPrimary, setStoreMemberManager,
  };
}
