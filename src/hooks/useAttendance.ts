import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { AttendanceRecord, Break } from '../types';
import { format, differenceInMinutes, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { formatSupabaseError, type FriendlyError } from '../lib/errors';

export function useAttendance(tenantId: string, storeId: string | null) {
  const [todayRecords, setTodayRecords] = useState<AttendanceRecord[]>([]);
  const [monthlyRecords, setMonthlyRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FriendlyError | null>(null);
  const clearError = useCallback(() => setError(null), []);
  const busyRef = useRef(false);
  const [today, setToday] = useState(() => formatInTimeZone(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'));

  useEffect(() => {
    const interval = setInterval(() => {
      const now = formatInTimeZone(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
      setToday((prev) => (prev !== now ? now : prev));
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  const activeRecord = useMemo<AttendanceRecord | null>(() => {
    return todayRecords.find((r) => r.clock_in && !r.clock_out) ?? null;
  }, [todayRecords]);

  const activeBreak = useMemo<Break | null>(() => {
    if (!activeRecord?.breaks) return null;
    return activeRecord.breaks.find((b) => !b.end_time) ?? null;
  }, [activeRecord]);

  const status = useMemo<'not_started' | 'working' | 'on_break'>(() => {
    if (!activeRecord) return 'not_started';
    if (activeBreak) return 'on_break';
    return 'working';
  }, [activeRecord, activeBreak]);

  const monthlySummary = useMemo(() => {
    const workDays = new Set(monthlyRecords.filter((r) => r.clock_in).map((r) => r.date)).size;
    const totalWorkMinutes = monthlyRecords.reduce((sum, r) => {
      if (r.total_work_minutes != null) return sum + r.total_work_minutes;
      // total_work_minutes が null の場合、clock_in/clock_out から再計算
      if (r.clock_in && r.clock_out) {
        const gross = differenceInMinutes(parseISO(r.clock_out), parseISO(r.clock_in));
        const breakMins = (r.breaks || []).reduce((bSum, b) => {
          if (b.start_time && b.end_time) {
            return bSum + differenceInMinutes(parseISO(b.end_time), parseISO(b.start_time));
          }
          return bSum;
        }, 0);
        return sum + Math.max(0, gross - breakMins);
      }
      return sum;
    }, 0);
    const totalBreakMinutes = monthlyRecords.reduce((sum, r) => {
      if (r.breaks && r.breaks.length > 0) {
        return (
          sum +
          r.breaks.reduce((bSum, b) => {
            if (b.start_time && b.end_time) {
              return bSum + differenceInMinutes(parseISO(b.end_time), parseISO(b.start_time));
            }
            return bSum;
          }, 0)
        );
      }
      return sum;
    }, 0);
    const avgWorkMinutes = workDays > 0 ? Math.round(totalWorkMinutes / workDays) : 0;
    return { totalWorkMinutes, totalBreakMinutes, workDays, avgWorkMinutes };
  }, [monthlyRecords]);

  const fetchTodayRecords = useCallback(async () => {
    if (!storeId) {
      setTodayRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      let user = session?.user ?? null;
      if (!user) {
        const {
          data: { user: refreshed },
        } = await supabase.auth.getUser();
        user = refreshed ?? null;
      }
      if (!user) {
        setLoading(false);
        return;
      }
      // 今日のレコード + 日を跨いで未退勤のレコード（どの日付でも）を取得
      const { data, error } = await supabase
        .from('attendance_records')
        .select('*, breaks(*)')
        .eq('tenant_id', tenantId)
        .eq('store_id', storeId)
        .eq('user_id', user.id)
        .or(`date.eq.${today},clock_out.is.null`)
        .order('clock_in', { ascending: true });
      if (error) throw error;
      setTodayRecords((data as AttendanceRecord[]) || []);
    } catch (err: unknown) {
      logger.error('Fetch today records error:', formatSupabaseError(err));
      setError(formatSupabaseError(err));
    } finally {
      setLoading(false);
    }
  }, [tenantId, storeId, today]);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // breaks realtime payload の attendance_record_id が、自分が現在保持している
  // 勤怠レコードに属するかを判定するための id 集合（自テナント・自店・自分の record）。
  // breaks テーブルには tenant_id 列が無く Realtime filter で自テナントに絞れないため、
  // 全テナントの breaks 変更でコールバックが発火する。payload の record id がこの集合に
  // 含まれない無関係な打刻は fetch を間引く。判定不能（id 不明）時は fail-open で fetch。
  const recordIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    recordIdsRef.current = new Set(todayRecords.map((r) => r.id));
  }, [todayRecords]);

  // breaks テーブルには tenant_id 列が無く Realtime フィルタで自テナントに絞れないため、
  // 全テナントの breaks 変更でこのコールバックが発火する。即時 fetch すると無関係な
  // 休憩打刻でも毎回 select が走るため、短いデバウンスでバースト分を 1 回に畳む。
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void fetchTodayRecords();
    }, 300);
  }, [fetchTodayRecords]);

  // Realtime subscription。removeChannel は Promise を返す非同期 API のため、await せず
  // 同名 channel を即再生成すると Supabase Realtime 内部状態の競合で CHANNEL_ERROR が出る
  // （StrictMode mount→unmount→remount / tenant・store・日跨ぎ切替で顕在化）。
  // useNotification.ts と同型に async setup + 全 removeChannel await + cancelled flag でガードする。
  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      // 冪等 cleanup（await で UNSUBSCRIBE 完了まで待つ）
      if (channelRef.current) {
        const ch = channelRef.current;
        channelRef.current = null;
        try { await supabase.removeChannel(ch); } catch (e) { console.warn('[useAttendance] removeChannel failed:', e); }
      }
      if (cancelled || !storeId) return;

      let channel: ReturnType<typeof supabase.channel> | null = null;
      try {
        channel = supabase
          .channel(`attendance:${tenantId}:${storeId}:${today}`)
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
            (payload) => {
              // 全テナントの breaks 変更が届くため、自分が保持中の勤怠レコードに
              // 紐づく break のみ fetch をスケジュールして無関係な打刻を間引く。
              // payload.new（INSERT/UPDATE）と payload.old（UPDATE/DELETE）の双方の
              // attendance_record_id を見る。id が判定できない場合は fail-open で fetch。
              const newRow = payload.new as { attendance_record_id?: string } | null;
              const oldRow = payload.old as { attendance_record_id?: string } | null;
              const recId = newRow?.attendance_record_id ?? oldRow?.attendance_record_id;
              const ids = recordIdsRef.current;
              if (recId != null && ids.size > 0 && !ids.has(recId)) {
                return; // 自分のレコードに無関係な休憩打刻 → 間引く
              }
              scheduleFetch();
            }
          )
          .subscribe((status, err) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || err) {
              console.warn('[useAttendance] subscribe status:', status, err);
            }
          });
        if (cancelled) {
          try { await supabase.removeChannel(channel); } catch (e) { console.warn('[useAttendance] removeChannel after cancel:', e); }
          return;
        }
        channelRef.current = channel;
      } catch (e) {
        console.warn('[useAttendance] channel setup failed:', e);
        setError(formatSupabaseError(e));
        if (channel) {
          try { await supabase.removeChannel(channel); } catch (re) { console.warn('[useAttendance] removeChannel after fail:', re); }
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
          try { await supabase.removeChannel(ch); } catch (e) { console.warn('[useAttendance] removeChannel failed:', e); }
        })();
      }
    };
  }, [tenantId, storeId, today, fetchTodayRecords, scheduleFetch]);

  useEffect(() => {
    fetchTodayRecords();
  }, [fetchTodayRecords]);

  async function clockIn() {
    if (!storeId) throw new Error('店舗が選択されていません');
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      if (activeRecord) {
        throw new Error('終了していない勤務セッションがあります');
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const now = new Date().toISOString();
      const { error } = await supabase.from('attendance_records').insert({
        tenant_id: tenantId,
        store_id: storeId,
        user_id: user.id,
        date: today,
        clock_in: now,
      });
      if (error) {
        logger.error('Clock in error:', formatSupabaseError(error));
        setError(formatSupabaseError(error));
        throw error;
      }
      await fetchTodayRecords();
    } finally {
      busyRef.current = false;
    }
  }

  async function clockOut() {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      if (!activeRecord?.clock_in) return;
      const now = new Date();

      // 進行中の休憩があれば自動的に終了する
      if (activeBreak) {
        const { error: breakError } = await supabase
          .from('breaks')
          .update({ end_time: now.toISOString() })
          .eq('id', activeBreak.id);
        if (breakError) {
          logger.error('Auto break end error:', formatSupabaseError(breakError));
          setError(formatSupabaseError(breakError));
          throw breakError;
        }
      }

      // 休憩時間をローカルで計算（自動終了した休憩も含む）
      let totalBreakMinutes = 0;
      if (activeRecord.breaks && activeRecord.breaks.length > 0) {
        totalBreakMinutes = activeRecord.breaks.reduce((sum, b) => {
          if (b.start_time && b.end_time) {
            return sum + differenceInMinutes(parseISO(b.end_time), parseISO(b.start_time));
          }
          // 自動終了した休憩（end_time が null だった → now で終了）
          if (b.start_time && !b.end_time) {
            return sum + differenceInMinutes(now, parseISO(b.start_time));
          }
          return sum;
        }, 0);
      }

      const totalWorkMinutes =
        Math.max(0, differenceInMinutes(now, parseISO(activeRecord.clock_in)) - totalBreakMinutes);

      const { error } = await supabase
        .from('attendance_records')
        .update({
          clock_out: now.toISOString(),
          total_work_minutes: totalWorkMinutes,
        })
        .eq('id', activeRecord.id);
      if (error) {
        logger.error('Clock out error:', formatSupabaseError(error));
        setError(formatSupabaseError(error));
        throw error;
      }
      await fetchTodayRecords();
    } finally {
      busyRef.current = false;
    }
  }

  async function breakStart() {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      if (!activeRecord) return;
      const { error } = await supabase.from('breaks').insert({
        attendance_record_id: activeRecord.id,
        start_time: new Date().toISOString(),
      });
      if (error) {
        logger.error('Break start error:', formatSupabaseError(error));
        setError(formatSupabaseError(error));
        throw error;
      }
      await fetchTodayRecords();
    } finally {
      busyRef.current = false;
    }
  }

  async function breakEnd() {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      if (!activeRecord) return;

      const { data, error: fetchError } = await supabase
        .from('breaks')
        .select('id')
        .eq('attendance_record_id', activeRecord.id)
        .is('end_time', null)
        .order('start_time', { ascending: false })
        .limit(1);
      if (fetchError) {
        logger.error('Find active break error:', formatSupabaseError(fetchError));
        setError(formatSupabaseError(fetchError));
        throw fetchError;
      }
      if (!data || data.length === 0) return;

      const { error } = await supabase
        .from('breaks')
        .update({ end_time: new Date().toISOString() })
        .eq('id', data[0].id);
      if (error) {
        logger.error('Break end error:', formatSupabaseError(error));
        setError(formatSupabaseError(error));
        throw error;
      }
      await fetchTodayRecords();
    } finally {
      busyRef.current = false;
    }
  }

  const fetchRecords = useCallback(
    async (year: number, month: number) => {
      if (!storeId) {
        setMonthlyRecords([]);
        return;
      }
      setError(null);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      let user = session?.user ?? null;
      if (!user) {
        const {
          data: { user: refreshed },
        } = await supabase.auth.getUser();
        user = refreshed ?? null;
      }
      if (!user) return;
      const startDate = format(new Date(year, month - 1, 1), 'yyyy-MM-dd');
      const endDate = format(new Date(year, month, 0), 'yyyy-MM-dd');
      const { data, error } = await supabase
        .from('attendance_records')
        .select('*, breaks(*)')
        .eq('tenant_id', tenantId)
        .eq('store_id', storeId)
        .eq('user_id', user.id)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true })
        .order('clock_in', { ascending: true });
      if (error) {
        logger.error('Fetch records error:', formatSupabaseError(error));
        setError(formatSupabaseError(error));
        return;
      }
      setMonthlyRecords((data as AttendanceRecord[]) || []);
    },
    [tenantId, storeId]
  );

  return {
    todayRecords,
    activeRecord,
    status,
    clockIn,
    clockOut,
    breakStart,
    breakEnd,
    activeBreak,
    fetchRecords,
    today,
    monthlyRecords,
    monthlySummary,
    loading,
    error,
    clearError,
  };
}
