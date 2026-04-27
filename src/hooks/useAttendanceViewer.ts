import { useState, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { AttendanceRecord } from '../types';
import { format, differenceInMinutes, parseISO } from 'date-fns';

export function useAttendanceViewer(
  tenantId: string,
  storeId: string | null,
  userId: string | null,
) {
  const [monthlyRecords, setMonthlyRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const monthlySummary = useMemo(() => {
    const workDays = new Set(monthlyRecords.filter((r) => r.clock_in).map((r) => r.date)).size;
    const totalWorkMinutes = monthlyRecords.reduce((sum, r) => {
      if (r.total_work_minutes != null) return sum + r.total_work_minutes;
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

  const fetchRecords = useCallback(
    async (year: number, month: number) => {
      if (!storeId || !userId) {
        setMonthlyRecords([]);
        return;
      }
      setLoading(true);
      try {
        const startDate = format(new Date(year, month - 1, 1), 'yyyy-MM-dd');
        const endDate = format(new Date(year, month, 0), 'yyyy-MM-dd');
        const { data, error } = await supabase
          .from('attendance_records')
          .select('*, breaks(*)')
          .eq('tenant_id', tenantId)
          .eq('store_id', storeId)
          .eq('user_id', userId)
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: true })
          .order('clock_in', { ascending: true });
        if (error) {
          console.error('Fetch viewer records error:', error.message);
          return;
        }
        setMonthlyRecords((data as AttendanceRecord[]) || []);
      } finally {
        setLoading(false);
      }
    },
    [tenantId, storeId, userId],
  );

  return { fetchRecords, monthlyRecords, monthlySummary, loading };
}
