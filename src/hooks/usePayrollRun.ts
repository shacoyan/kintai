import { useState, useCallback } from 'react';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import type { PayrollRun, PayrollRunItem } from '../types';
import { formatSupabaseError } from '../lib/errors';

export function usePayrollRun(tenantId: string, storeId: string | null) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRun = useCallback(async (
    targetMonth: string,
    mode: 'actual' | 'shift'
  ): Promise<{ run: PayrollRun; items: PayrollRunItem[] } | null> => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('payroll_runs')
        .select('*, items:payroll_run_items(*)')
        .eq('tenant_id', tenantId)
        .eq('target_month', `${targetMonth}-01`)
        .eq('mode', mode);

      if (storeId === null) {
        query = query.is('store_id', null);
      } else {
        query = query.eq('store_id', storeId);
      }

      const { data, error: fetchError } = await query.maybeSingle();

      if (fetchError) throw fetchError;
      if (!data) return null;

      const { items, ...run } = data as { items: PayrollRunItem[] } & PayrollRun;
      return { run: run as PayrollRun, items: (items ?? []) as PayrollRunItem[] };
    } catch (err) {
      logger.error('fetchRun error:', formatSupabaseError(err));
      setError(formatSupabaseError(err).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [tenantId, storeId]);

  const finalizeRun = useCallback(async (args: {
    targetMonth: string;
    mode: 'actual' | 'shift';
    closeDay: number;
    payrollData: Array<{
      userId: string;
      displayName: string;
      payType: 'hourly' | 'monthly';
      hourlyRate: number;
      monthlySalary: number;
      workDays: number;
      normalMinutes: number;
      nightMinutes: number;
      payment: number;
    }>;
  }): Promise<PayrollRun | null> => {
    setLoading(true);
    setError(null);
    try {
      const { targetMonth, mode, closeDay, payrollData } = args;

      const [year, month] = targetMonth.split('-').map(Number);
      const isEndOfMonth = closeDay >= 31;
      const lastDayOfMonth = new Date(year, month, 0).getDate();

      const periodStartDay = isEndOfMonth ? 1 : closeDay + 1;
      const periodStartMonthRaw = isEndOfMonth ? month : month - 1;
      const periodStartYear = periodStartMonthRaw <= 0 ? year - 1 : year;
      const adjustedStartMonth = periodStartMonthRaw <= 0 ? 12 : periodStartMonthRaw;
      const periodStart = `${periodStartYear}-${String(adjustedStartMonth).padStart(2, '0')}-${String(periodStartDay).padStart(2, '0')}`;

      const periodEndDay = isEndOfMonth ? lastDayOfMonth : Math.min(closeDay, lastDayOfMonth);
      const periodEnd = `${targetMonth}-${String(periodEndDay).padStart(2, '0')}`;

      const totalPayment = payrollData.reduce((sum, row) => sum + row.payment, 0);

      const { data: { user } } = await supabase.auth.getUser();
      const finalizedBy = user?.id ?? null;

      const { data: runData, error: runError } = await supabase
        .from('payroll_runs')
        .insert({
          tenant_id: tenantId,
          store_id: storeId,
          target_month: `${targetMonth}-01`,
          close_day: closeDay,
          period_start: periodStart,
          period_end: periodEnd,
          mode,
          total_payment: totalPayment,
          finalized_by: finalizedBy,
        })
        .select()
        .single();

      if (runError) throw runError;

      const itemsPayload = payrollData.map((row) => ({
        run_id: (runData as PayrollRun).id,
        user_id: row.userId,
        display_name: row.displayName,
        pay_type: row.payType,
        hourly_rate: row.hourlyRate,
        monthly_salary: row.monthlySalary,
        work_days: row.workDays,
        normal_minutes: row.normalMinutes,
        night_minutes: row.nightMinutes,
        payment: row.payment,
      }));

      if (itemsPayload.length > 0) {
        const { error: itemsError } = await supabase
          .from('payroll_run_items')
          .insert(itemsPayload);

        if (itemsError) {
          // ロールバック: 親 run を削除
          await supabase.from('payroll_runs').delete().eq('id', (runData as PayrollRun).id);
          throw itemsError;
        }
      }

      return runData as PayrollRun;
    } catch (err) {
      logger.error('finalizeRun error:', formatSupabaseError(err));
      setError(formatSupabaseError(err).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [tenantId, storeId]);

  const unfinalizeRun = useCallback(async (runId: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from('payroll_runs')
        .delete()
        .eq('id', runId);

      if (deleteError) throw deleteError;
    } catch (err) {
      logger.error('unfinalizeRun error:', formatSupabaseError(err));
      setError(formatSupabaseError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, fetchRun, finalizeRun, unfinalizeRun };
}
