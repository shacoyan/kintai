import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';

export interface ActiveAttendance {
  recordId: string;
  userId: string;
  clockIn: string;
  isOnBreak: boolean;
}

type Row = {
  id: string;
  user_id: string;
  clock_in: string;
  clock_out: string | null;
  breaks: { start_time: string | null; end_time: string | null }[] | null;
};

export function useActiveAttendance(tenantId: string, storeId: string | null) {
  const [active, setActive] = useState<ActiveAttendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchActive = useCallback(async () => {
    if (!storeId) {
      setActive([]);
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data, error: e } = await supabase
        .from('attendance_records')
        .select('id, user_id, clock_in, clock_out, breaks(start_time, end_time)')
        .eq('tenant_id', tenantId)
        .eq('store_id', storeId)
        .gte('date', today)
        .is('clock_out', null)
        .not('clock_in', 'is', null);
      if (e) throw e;
      const rows = (data ?? []) as Row[];
      const mapped = rows.map((r: Row) => ({
        recordId: r.id,
        userId: r.user_id,
        clockIn: r.clock_in,
        isOnBreak: Array.isArray(r.breaks)
          ? r.breaks.some((b) => b.end_time == null && b.start_time != null)
          : false,
      }));
      setActive(mapped);
      setUpdatedAt(new Date());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'failed';
      setError(message);
      console.error('useActiveAttendance fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId, storeId]);

  // Cleanup utility to safely remove the channel
  const cleanupChannel = useCallback(() => {
    const ch = channelRef.current;
    if (ch) {
      supabase.removeChannel(ch);
      channelRef.current = null;
    }
  }, []);

  // Realtime subscription separated into its own effect for reliable cleanup
  useEffect(() => {
    fetchActive();

    if (!storeId) {
      cleanupChannel();
      return;
    }

    cleanupChannel(); // Ensure any previous channel is cleaned up before creating a new one

    const channel = supabase
      .channel(`active-attendance:${tenantId}:${storeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance_records',
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => fetchActive()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'breaks',
        },
        () => fetchActive()
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      cleanupChannel();
    };
  }, [tenantId, storeId, fetchActive, cleanupChannel]);

  // 60s fallback polling separated into its own effect
  useEffect(() => {
    if (!storeId) return;

    const id = setInterval(() => fetchActive(), 60_000);
    return () => clearInterval(id);
  }, [storeId, fetchActive]);

  return { active, loading, error, updatedAt, refetch: fetchActive };
}

