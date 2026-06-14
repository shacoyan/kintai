import { useState, useEffect, useCallback, useRef } from 'react';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { formatSupabaseError } from '../lib/errors';

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
      // 在席判定 = 未退勤(clock_out IS NULL) かつ 出勤打刻済(clock_in NOT NULL)。
      // 以前は .gte('date', today) で当日以降に絞っていたが、深夜0時を跨ぐと
      // 前日 date の未退勤レコードが取得対象から外れ、出勤中スタッフが
      // ActiveMembersCard/人数バッジから消える不具合があったため日付下限を撤廃。
      const { data, error: e } = await supabase
        .from('attendance_records')
        .select('id, user_id, clock_in, clock_out, breaks(start_time, end_time)')
        .eq('tenant_id', tenantId)
        .eq('store_id', storeId)
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
      setError(formatSupabaseError(err).message);
      logger.error('useActiveAttendance fetch error:', formatSupabaseError(err));
    } finally {
      setLoading(false);
    }
  }, [tenantId, storeId]);

  // breaks テーブルには tenant_id 列が無く Realtime フィルタで自テナントに絞れないため、
  // 全テナントの breaks 変更でこのコールバックが発火する。即時 fetchActive すると
  // 無関係なテナントの休憩打刻でも毎回 select が走り負荷になるため、短いデバウンスで
  // バースト分を 1 回の取得に畳む。
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void fetchActive();
    }, 300);
  }, [fetchActive]);

  // Realtime subscription。removeChannel は Promise を返す非同期 API のため、
  // await せず同名 channel を即再生成すると Supabase Realtime 内部状態の競合で
  // CHANNEL_ERROR / ".on() after subscribe()" が出る（StrictMode の mount→unmount→remount や
  // tenant/store 切替時に顕在化）。useNotification.ts と同型に async setup + 全 removeChannel await +
  // cancelled flag で stale closure をガードする。
  useEffect(() => {
    void fetchActive();

    let cancelled = false;

    const setup = async () => {
      // 冪等 cleanup（await で UNSUBSCRIBE 完了まで待つ）
      if (channelRef.current) {
        const ch = channelRef.current;
        channelRef.current = null;
        try { await supabase.removeChannel(ch); } catch (e) { console.warn('[useActiveAttendance] removeChannel failed:', e); }
      }
      if (cancelled || !storeId) return;

      let channel: ReturnType<typeof supabase.channel> | null = null;
      try {
        channel = supabase
          .channel(`active-attendance:${tenantId}:${storeId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'attendance_records',
              filter: `tenant_id=eq.${tenantId}`,
            },
            () => scheduleFetch()
          )
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'breaks',
            },
            () => scheduleFetch()
          )
          .subscribe((status, err) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || err) {
              console.warn('[useActiveAttendance] subscribe status:', status, err);
            }
          });
        if (cancelled) {
          try { await supabase.removeChannel(channel); } catch (e) { console.warn('[useActiveAttendance] removeChannel after cancel:', e); }
          return;
        }
        channelRef.current = channel;
      } catch (e) {
        console.warn('[useActiveAttendance] channel setup failed:', e);
        setError(e instanceof Error ? e.message : String(e));
        if (channel) {
          try { await supabase.removeChannel(channel); } catch (re) { console.warn('[useActiveAttendance] removeChannel after fail:', re); }
        }
        channelRef.current = null;
      }
    };

    void setup();

    return () => {
      cancelled = true;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const ch = channelRef.current;
      channelRef.current = null;
      if (ch) {
        void (async () => {
          try { await supabase.removeChannel(ch); } catch (e) { console.warn('[useActiveAttendance] removeChannel failed:', e); }
        })();
      }
    };
  }, [tenantId, storeId, fetchActive, scheduleFetch]);

  // 60s fallback polling separated into its own effect
  useEffect(() => {
    if (!storeId) return;

    const id = setInterval(() => fetchActive(), 60_000);
    return () => clearInterval(id);
  }, [storeId, fetchActive]);

  return { active, loading, error, updatedAt, refetch: fetchActive };
}
