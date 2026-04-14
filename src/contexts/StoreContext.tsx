import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useTenant } from './TenantContext';
import type { Store } from '../types';

interface StoreContextValue {
  stores: Store[];
  currentStore: Store | null;  // null = 全店舗
  setCurrentStore: (store: Store | null) => void;
  loading: boolean;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentTenant } = useTenant();
  const [stores, setStores] = useState<Store[]>([]);
  const [currentStore, setCurrentStoreState] = useState<Store | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentTenant) {
      setStores([]);
      setCurrentStoreState(null);
      return;
    }
    const fetchStores = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('stores')
          .select('*')
          .eq('tenant_id', currentTenant.id)
          .order('name');
        if (error) throw error;
        const storeList = (data as Store[]) || [];
        setStores(storeList);

        // Restore from localStorage
        const savedId = localStorage.getItem(`kintai_selected_store_${currentTenant.id}`);
        if (savedId) {
          const found = storeList.find(s => s.id === savedId);
          setCurrentStoreState(found || null);
        }
      } catch (err) {
        console.error('Failed to fetch stores:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchStores();
  }, [currentTenant]);

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

  return (
    <StoreContext.Provider value={{ stores, currentStore, setCurrentStore, loading }}>
      {children}
    </StoreContext.Provider>
  );
};

export const useStoreContext = (): StoreContextValue => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStoreContext must be used within StoreProvider');
  return ctx;
};
