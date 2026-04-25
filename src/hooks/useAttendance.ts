import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { AttendanceRecord, Break } from '../types';
import { format, differenceInMinutes, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

export function useAttendance(tenantId: string, storeId: string | null) {
  const [todayRecords, setTodayRecords] = useState<AttendanceRecord[]>([]);
  const [monthlyRecords, setMonthlyRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
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
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
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
    } catch (err: any) {
      console.error('Fetch today records error:', err.message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, storeId, today]);

  useEffect(() => {
    if (!storeId) return;
    const channel = supabase
      .channel(`attendance:${tenantId}:${storeId}:${today}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance_records',
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          fetchTodayRecords();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'breaks',
        },
        () => {
          // TODO: breaks テーブルには tenant_id がないため Supabase Realtime フィルタで絞れない
          // attendance_record_id で不要な fetch を減らす改善余地あり
          fetchTodayRecords();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, storeId, today, fetchTodayRecords]);

  useEffect(() => {
    fetchTodayRecords();
  }, [fetchTodayRecords]);

  async function clockIn() {
    if (!storeId) throw new Error('店舗が選択されていません');
    if (busyRef.current) return;
    busyRef.current = true;
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
        console.error('Clock in error:', error.message);
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
          console.error('Auto break end error:', breakError.message);
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
        console.error('Clock out error:', error.message);
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
    try {
      if (!activeRecord) return;
      const { error } = await supabase.from('breaks').insert({
        attendance_record_id: activeRecord.id,
        start_time: new Date().toISOString(),
      });
      if (error) {
        console.error('Break start error:', error.message);
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
        console.error('Find active break error:', fetchError.message);
        throw fetchError;
      }
      if (!data || data.length === 0) return;

      const { error } = await supabase
        .from('breaks')
        .update({ end_time: new Date().toISOString() })
        .eq('id', data[0].id);
      if (error) {
        console.error('Break end error:', error.message);
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
      const {
        data: { user },
      } = await supabase.auth.getUser();
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
        console.error('Fetch records error:', error.message);
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
  };
}
