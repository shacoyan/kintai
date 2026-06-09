import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { useTenant } from './TenantContext';
import { formatSupabaseError } from '../lib/errors';
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
  // 直前に fetch を実行したテナント ID（テナント切替の検出用）。
  // tenant.id が変わったときだけ旧 stores を即クリアし、残像を防ぐ（B21）。
  const prevTenantIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentTenant) {
      setStores([]);
      setCurrentStoreState(null);
      setMyStoreMembers([]);
      setLoading(false);
      prevTenantIdRef.current = null;
      return;
    }

    let cancelled = false;

    // テナント切替時のみ即クリア（同一テナント内の再 fetch では currentStore を維持＝後方互換）。
    if (currentTenant.id !== prevTenantIdRef.current) {
      setStores([]);
      setCurrentStoreState(null);
      setMyStoreMembers([]);
    }
    prevTenantIdRef.current = currentTenant.id;

    const fetchStores = async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        let storeList: Store[] = [];
        let membersList: StoreMember[] = [];

        if (isOwner) {
          // オーナーの場合：テナントに紐づく全店舗を取得
          const { data, error } = await supabase
            .from('stores')
            .select('*')
            .eq('tenant_id', currentTenant.id);
          if (error) throw error;
          storeList = (data as Store[]) || [];
          membersList = [];
        } else {
          // マネージャー・スタッフの場合
          if (!myMemberId) {
            if (cancelled) return;
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
            if (cancelled) return;
            setStores([]);
            setCurrentStoreState(null);
            setMyStoreMembers(membersList);
            return;
          }

          // 所属店舗を取得
          const { data, error } = await supabase
            .from('stores')
            .select('*')
            .in('id', storeIds);
          if (error) throw error;
          storeList = (data as Store[]) || [];
        }

        // 店舗のメンバー数集計とソート処理
        const storeIds = storeList.map(s => s.id);
        if (storeIds.length > 0) {
          const { data: allMembers } = await supabase
            .from('store_members')
            .select('store_id')
            .in('store_id', storeIds);

          if (allMembers && allMembers.length > 0) {
            const memberCounts: Record<string, number> = {};
            allMembers.forEach((m: { store_id: string }) => {
              memberCounts[m.store_id] = (memberCounts[m.store_id] || 0) + 1;
            });

            storeList.sort((a: Store, b: Store) => {
              const countA = memberCounts[a.id] || 0;
              const countB = memberCounts[b.id] || 0;
              if (countA !== countB) {
                return countB - countA; // 多い順（降順）
              }
              // 同点の場合は作成日昇順
              const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
              const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
              return dateA - dateB;
            });
          } else {
            // メンバーがいない場合も作成日昇順でソート
            storeList.sort((a: Store, b: Store) => {
              const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
              const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
              return dateA - dateB;
            });
          }
        }

        if (cancelled) return;
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

        // 3. メンバー数最多（同点なら作成日昇順）の店舗を取得
        // 上記で既に storeList をメンバー数降順・作成日昇順にソート済みのため、リスト先頭が該当
        setCurrentStoreState(storeList[0] || null);

      } catch (err) {
        if (cancelled) return;
        logger.error('店舗の取得に失敗しました:', formatSupabaseError(err));
      } finally {
        if (cancelled) return;
        setLoading(false);
      }
    };

    fetchStores();

    return () => {
      cancelled = true;
    };
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
