import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { NotificationItem } from '../types';
import { supabase } from '../lib/supabase';

export function useNotification(userId: string | null) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchLatest = useCallback(async (limit: number = 10) => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (fetchError) throw fetchError;
      setNotifications((data ?? []) as NotificationItem[]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const fetchAll = useCallback(async (limit: number = 100) => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (fetchError) throw fetchError;
      setNotifications((data ?? []) as NotificationItem[]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const markAsRead = useCallback(
    async (id: string) => {
      if (!userId) return;
      try {
        const now = new Date().toISOString();
        const { error: updateError } = await supabase
          .from('notifications')
          .update({ read_at: now })
          .eq('id', id);
        if (updateError) throw updateError;
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read_at: now } : n))
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      }
    },
    [userId]
  );

  const markAllAsRead = useCallback(async () => {
    if (!userId) return;
    const unreadIds = notifications.filter((n) => !n.read_at).map((n) => n.id);
    if (unreadIds.length === 0) return;
    try {
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('notifications')
        .update({ read_at: now })
        .in('id', unreadIds);
      if (updateError) throw updateError;
      setNotifications((prev) =>
        prev.map((n) => (unreadIds.includes(n.id) ? { ...n, read_at: now } : n))
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  }, [userId, notifications]);

  // realtime 購読 + 初回 fetch
  useEffect(() => {
    if (!userId) {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return;
    }

    // 初回 fetch
    fetchLatest();

    // 念のため新規 channel 作成前に既存を破棄（StrictMode 二重マウント対策）
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase.channel(`notifications:${userId}`);
    channelRef.current = channel;

    channel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newItem = payload.new as NotificationItem;
          setNotifications((prev) => [newItem, ...prev].slice(0, 100));
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [userId, fetchLatest]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read_at).length,
    [notifications]
  );

  return {
    notifications,
    unreadCount,
    loading,
    error,
    fetchLatest,
    fetchAll,
    markAsRead,
    markAllAsRead,
  };
}
