// FILE: hooks/useAttendance.ts
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { AttendanceRecord } from '../types';
import { format, differenceInMinutes, parseISO } from 'date-fns';

export function useAttendance(tenantId: string) {
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [monthlyRecords, setMonthlyRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const today = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  const status: 'not_started' | 'working' | 'on_break' | 'finished' = (() => {
    if (!todayRecord) return 'not_started';
    if (todayRecord.clock_out) return 'finished';
    if (todayRecord.break_start && !todayRecord.break_end) return 'on_break';
    return 'working';
  })();

  const monthlySummary = (() => {
    const workDays = monthlyRecords.filter(r => r.clock_in).length;
    const totalWorkMinutes = monthlyRecords.reduce((sum, r) => sum + (r.total_work_minutes || 0), 0);
    const totalBreakMinutes = monthlyRecords.reduce((sum, r) => {
      if (r.break_start && r.break_end) {
        return sum + differenceInMinutes(parseISO(r.break_end), parseISO(r.break_start));
      }
      return sum;
    }, 0);
    const avgWorkMinutes = workDays > 0 ? Math.round(totalWorkMinutes / workDays) : 0;
    return { totalWorkMinutes, totalBreakMinutes, workDays, avgWorkMinutes };
  })();

  useEffect(() => {
    const channel = supabase
      .channel(`attendance:${tenantId}:${today}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance_records',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const record = payload.new as AttendanceRecord;
          if (record.date === today) {
            setTodayRecord(record);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, today]);

  useEffect(() => {
    fetchTodayRecord();
  }, [tenantId]);

  async function fetchTodayRecord() {
    setLoading(true);
    const { data } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('date', today)
      .single();
    setTodayRecord(data);
    setLoading(false);
  }

  async function clockIn() {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('attendance_records')
      .insert({
        tenant_id: tenantId,
        date: today,
        clock_in: now,
      });
    if (error) {
      console.error('Clock in error:', error.message);
      throw error;
    }
  }

  async function clockOut() {
    if (!todayRecord?.clock_in) return;
    const now = new Date();
    let breakDuration = 0;
    if (todayRecord.break_start && todayRecord.break_end) {
      breakDuration = differenceInMinutes(parseISO(todayRecord.break_end), parseISO(todayRecord.break_start));
    }
    const totalWorkMinutes = differenceInMinutes(now, parseISO(todayRecord.clock_in)) - breakDuration;
    const { error } = await supabase
      .from('attendance_records')
      .update({
        clock_out: now.toISOString(),
        total_work_minutes: totalWorkMinutes,
      })
      .eq('id', todayRecord.id);
    if (error) {
      console.error('Clock out error:', error.message);
      throw error;
    }
  }

  async function breakStart() {
    if (!todayRecord) return;
    const { error } = await supabase
      .from('attendance_records')
      .update({ break_start: new Date().toISOString() })
      .eq('id', todayRecord.id);
    if (error) {
      console.error('Break start error:', error.message);
      throw error;
    }
  }

  async function breakEnd() {
    if (!todayRecord) return;
    const { error } = await supabase
      .from('attendance_records')
      .update({ break_end: new Date().toISOString() })
      .eq('id', todayRecord.id);
    if (error) {
      console.error('Break end error:', error.message);
      throw error;
    }
  }

  const fetchRecords = useCallback(async (year: number, month: number) => {
    const startDate = format(new Date(year, month - 1, 1), 'yyyy-MM-dd');
    const endDate = format(new Date(year, month, 0), 'yyyy-MM-dd');
    const { data, error } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('tenant_id', tenantId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });
    if (error) {
      console.error('Fetch records error:', error.message);
    }
    setMonthlyRecords(data || []);
  }, [tenantId]);

  return {
    todayRecord,
    status,
    clockIn,
    clockOut,
    breakStart,
    breakEnd,
    fetchRecords,
    monthlyRecords,
    monthlySummary,
    loading,
  };
}
