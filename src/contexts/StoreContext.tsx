import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useTenant } from './TenantContext';
import type { Store, StoreMember } from '../types';

interface StoreContextValue {
  stores: Store[];
  currentStore: Store | null;
  setCurrentStore: (store: Store | null) => void;
  loading: boolean;
  managedStoreIds: string[];
  isManagerOf: (storeId: string) => boolean;
  myStoreMembers: StoreMember[];
}

const StoreContext = createContext<StoreContextValue | null>(null);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentTenant, myRole, myMemberId, isOwner } = useTenant();
  const [stores, setStores] = useState<Store[]>([]);
  const [currentStore, setCurrentStoreState] = useState<Store | null>(null);
  const [loading, setLoading] = useState(false);
  const [myStoreMembers, setMyStoreMembers] = useState<StoreMember[]>([]);

  useEffect(() => {
    if (!currentTenant) {
      setStores([]);
      setCurrentStoreState(null);
      setMyStoreMembers([]);
      return;
    }

    const fetchStores = async () => {
      setLoading(true);
      try {
        let storeList: Store[] = [];
        let membersList: StoreMember[] = [];

        if (isOwner) {
          // オーナーの場合：テナントに紐づく全店舗を取得
          const { data, error } = await supabase
            .from('stores')
            .select('*')
            .eq('tenant_id', currentTenant.id)
            .order('name');
          if (error) throw error;
          storeList = (data as Store[]) || [];
          membersList = [];
        } else {
          // マネージャー・スタッフの場合
          if (!myMemberId) {
            setStores([]);
            setCurrentStoreState(null);
            setMyStoreMembers([]);
            return;
          }

          // 自身のメンバーシップを取得
          const { data: memberData, error: memberError } = await supabase
            .from('store_members')
            .select('*')
            .eq('member_id', myMemberId);
          if (memberError) throw memberError;
          
          membersList = (memberData as StoreMember[]) || [];
          const storeIds = membersList.map(m => m.store_id);

          // 所属店舗がなければ空配列
          if (storeIds.length === 0) {
            setStores([]);
            setCurrentStoreState(null);
            setMyStoreMembers(membersList);
            return;
          }

          // 所属店舗を取得
          const { data, error } = await supabase
            .from('stores')
            .select('*')
            .in('id', storeIds)
            .order('name');
          if (error) throw error;
          storeList = (data as Store[]) || [];
        }

        setStores(storeList);
        setMyStoreMembers(membersList);

        // カレントストアの初期決定ロジック
        // 1. localStorageからの復元
        const savedId = localStorage.getItem(`kintai_selected_store_${currentTenant.id}`);
        if (savedId) {
          const found = storeList.find(s => s.id === savedId);
          if (found) {
            setCurrentStoreState(found);
            return;
          }
        }

        // 2. プライマリ指定の店舗を確認
        const primaryMember = membersList.find(m => m.is_primary);
        if (primaryMember) {
          const primaryStore = storeList.find(s => s.id === primaryMember.store_id);
          if (primaryStore) {
            setCurrentStoreState(primaryStore);
            return;
          }
        }

        // 3. 上記に該当しない場合、リストの先頭
        setCurrentStoreState(storeList[0] || null);

      } catch (err) {
        console.error('店舗の取得に失敗しました:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStores();
  }, [currentTenant, isOwner, myMemberId]);

  const setCurrentStore = useCallback((store: Store | null) => {
    setCurrentStoreState(store);
    if (currentTenant) {
      if (store) {
        localStorage.setItem(`kintai_selected_store_${currentTenant.id}`, store.id);
      } else {
        localStorage.removeItem(`kintai_selected_store_${currentTenant.id}`);
      }
    }
  }, [currentTenant]);

  // 管理権限を持つストアIDのリスト
  const managedStoreIds = useMemo(() => {
    if (isOwner) {
      return stores.map(s => s.id);
    }
    return myStoreMembers.filter(m => m.is_manager).map(m => m.store_id);
  }, [isOwner, stores, myStoreMembers]);

  // 指定ストアの管理権限判定
  const isManagerOf = useCallback((storeId: string): boolean => {
    if (isOwner) return true;
    if (myRole === 'manager') return managedStoreIds.includes(storeId);
    return false;
  }, [isOwner, myRole, managedStoreIds]);

  const value = useMemo(() => ({
    stores,
    currentStore,
    setCurrentStore,
    loading,
    managedStoreIds,
    isManagerOf,
    myStoreMembers,
  }), [stores, currentStore, setCurrentStore, loading, managedStoreIds, isManagerOf, myStoreMembers]);

  return (
    <StoreContext.Provider value={value}>
      {children}
    </StoreContext.Provider>
  );
};

export const useStoreContext = (): StoreContextValue => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStoreContext must be used within StoreProvider');
  return ctx;
};
