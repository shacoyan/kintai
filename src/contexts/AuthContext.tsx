import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    // Supabase v2: onAuthStateChange は subscribe 直後に INITIAL_SESSION を必ず発火する。
    // getSession() を別途 await すると StrictMode double-mount で Web Locks がデッドロックし、
    // loading=true のまま永久ローディングになる（dev 環境 P0）。
    // → INITIAL_SESSION 経由で初期セッションを受け取り、loading を解除する一本化パスに統一。
    //
    // 2026-05-13 (visibility state reset bug fix / Track B):
    // setUser を functional updater 化し、prev?.id === next?.id の場合は prev 参照を保持する。
    // Supabase JS は TOKEN_REFRESHED 等でも session を毎回新規オブジェクトで返すため、
    // 素朴に setUser(session?.user ?? null) すると user 参照が毎回変わり下流の useEffect が
    // 無駄に再走する (TenantContext fetchTenants → setLoading(true) → ガード unmount race)。
    // id 同一なら参照を維持して再レンダー / 下流 effect 再走を抑止する。
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setUser((prev) => {
        if (prev?.id === nextUser?.id) {
          // 同一ユーザー or 両方 null → 参照を維持して下流 effect 再走を抑止
          return prev;
        }
        return nextUser;
      });
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    localStorage.removeItem('kintai_current_tenant');
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const value: AuthContextType = useMemo(
    () => ({
      user,
      loading,
      signIn,
      signUp,
      signOut,
    }),
    [user, loading, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
