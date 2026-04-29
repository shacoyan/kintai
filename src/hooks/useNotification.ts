import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { NotificationItem } from '../types';
import { supabase } from '../lib/supabase';
import { formatSupabaseError, type FriendlyError } from '../lib/errors';

export function useNotification(userId: string | null) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [friendlyError, setFriendlyError] = useState<FriendlyError | null>(null);
  const clearError = useCallback(() => {
    setError(null);
    setFriendlyError(null);
  }, []);

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
      const f = formatSupabaseError(err);
      setError(f.message);
      setFriendlyError(f);
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
      const f = formatSupabaseError(err);
      setError(f.message);
      setFriendlyError(f);
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
        const f = formatSupabaseError(err);
      setError(f.message);
      setFriendlyError(f);
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
      const f = formatSupabaseError(err);
      setError(f.message);
      setFriendlyError(f);
    }
  }, [userId, notifications]);

  useEffect(() => {
    if (!userId) {
      if (channelRef.current) {
        try { supabase.removeChannel(channelRef.current); } catch (e) { console.warn('[useNotification] removeChannel failed:', e); }
        channelRef.current = null;
      }
      return;
    }

    fetchLatest();

    // 冪等 cleanup
    if (channelRef.current) {
      try { supabase.removeChannel(channelRef.current); } catch (e) { console.warn('[useNotification] removeChannel failed:', e); }
      channelRef.current = null;
    }

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`notifications:${userId}`)
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
        .subscribe((status, err) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || err) {
            console.warn('[useNotification] subscribe status:', status, err);
          }
        });
      channelRef.current = channel;
    } catch (e) {
      console.warn('[useNotification] channel setup failed:', e);
      setError(e instanceof Error ? e.message : String(e));
      if (channel) {
        try { supabase.removeChannel(channel); } catch (re) { console.warn('[useNotification] removeChannel after fail:', re); }
      }
      channelRef.current = null;
      return;
    }

    return () => {
      if (channelRef.current) {
        try { supabase.removeChannel(channelRef.current); } catch (e) { console.warn('[useNotification] removeChannel failed:', e); }
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
    friendlyError,
    clearError,
    fetchLatest,
    fetchAll,
    markAsRead,
    markAllAsRead,
  };
}
