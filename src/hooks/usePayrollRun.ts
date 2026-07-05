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

      // FG3(111): 全店舗 run は store_id=NULL で過去に UNIQUE が効かず重複確定し得た。
      // 111 の部分 UNIQUE で新規重複は封じるが、既存重複が残るケースに備え
      // .maybeSingle()（複数行で error → 画面が開けない）を撤去し配列で受ける。
      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      const rows = (data ?? []) as Array<{ items: PayrollRunItem[] } & PayrollRun>;
      if (rows.length === 0) return null;

      if (rows.length > 1) {
        // 重複確定の疑い。無音 null で「開けない」にせず明示メッセージ＋全 run id を全文ログ。
        logger.error(
          'fetchRun: multiple payroll_runs matched (duplicate finalization suspected). ' +
            `tenantId=${tenantId} storeId=${String(storeId)} targetMonth=${targetMonth} mode=${mode} ` +
            `runIds=${rows.map((r) => r.id).join(',')}`
        );
        setError('この対象月・モードで確定データが複数見つかりました。管理者に連絡してください（重複確定の可能性）');
        return null;
      }

      const { items, ...run } = rows[0];
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

      // items は jsonb 配列で RPC に渡す（SQL 側で run_id を新規 id に固定するため run_id は含めない）
      const itemsPayload = payrollData.map((row) => ({
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

      // 確定は単一トランザクションの SECURITY DEFINER RPC に集約（孤児 payroll_run 防止）。
      // 失敗時は RPC が throw するため、無音 0 行ロールバック問題は発生しない。
      const { data: newRunId, error: rpcError } = await supabase.rpc('finalize_payroll_run', {
        p_tenant_id: tenantId,
        p_store_id: storeId,
        p_target_month: `${targetMonth}-01`,
        p_close_day: closeDay,
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_mode: mode,
        p_total_payment: totalPayment,
        p_items: itemsPayload,
      });

      if (rpcError) throw rpcError;

      // RPC は新 run の id を返す。フロントは fetchRun で再取得するため最小形で返す。
      return { id: newRunId as string } as PayrollRun;
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
      // 確定取消は owner 限定 SECURITY DEFINER RPC に集約（直 .delete() は撤去）。
      // owner 以外は RPC が insufficient_privilege で throw するため、無音 0 行問題は発生しない。
      const { error: rpcError } = await supabase.rpc('unfinalize_payroll_run', { p_run_id: runId });

      if (rpcError) throw rpcError;
    } catch (err) {
      logger.error('unfinalizeRun error:', formatSupabaseError(err));
      setError(formatSupabaseError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, fetchRun, finalizeRun, unfinalizeRun };
}
