import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { formatSupabaseError } from '../lib/errors';
import type { LeaveRequest, LeaveType } from '../types';

export function useLeave(tenantId: string) {
  const [myLeaves, setMyLeaves] = useState<LeaveRequest[]>([]);
  const [allLeaves, setAllLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getMyLeaves = useCallback(async (startDate: string, endDate: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error: e } = await supabase
        .from('leave_requests')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('user_id', user.id)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false });
      if (e) throw e;
      setMyLeaves((data as LeaveRequest[]) || []);
    } catch (err: unknown) {
      setError(formatSupabaseError(err).message);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  const getAllLeaves = useCallback(async (startDate: string, endDate: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from('leave_requests')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false });
      if (e) throw e;
      setAllLeaves((data as LeaveRequest[]) || []);
    } catch (err: unknown) {
      setError(formatSupabaseError(err).message);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  const submitLeave = useCallback(async (dates: string[], leaveType: LeaveType, reason?: string, storeId?: string | null): Promise<{ successCount: number; failedDates: string[]; rolledBackCount: number }> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const results = await Promise.allSettled(
      dates.map(date =>
        supabase
          .from('leave_requests')
          .insert({
            tenant_id: tenantId,
            user_id: user.id,
            date,
            leave_type: leaveType,
            reason: reason || null,
            store_id: storeId ?? null,
          })
      )
    );

    const successDates: string[] = [];
    const failedDates: string[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const { error: e } = result.value;
        if (e) {
          failedDates.push(dates[index]);
        } else {
          successDates.push(dates[index]);
        }
      } else {
        failedDates.push(dates[index]);
      }
    });

    let rolledBackCount = 0;

    if (failedDates.length > 0 && successDates.length > 0) {
      const rollbackResults = await Promise.allSettled(
        successDates.map(d =>
          supabase
            .from('leave_requests')
            .delete()
            .eq('tenant_id', tenantId)
            .eq('user_id', user.id)
            .eq('date', d)
        )
      );

      rollbackResults.forEach(result => {
        if (result.status === 'fulfilled') {
          const { error: e } = result.value;
          if (!e) {
            rolledBackCount++;
          }
        }
      });
    }

    return { successCount: 0, failedDates, rolledBackCount };
  }, [tenantId]);

  const cancelLeave = useCallback(async (leaveId: string) => {
    const { error: e } = await supabase
      .from('leave_requests')
      .update({ status: 'cancelled' })
      .eq('id', leaveId)
      .eq('status', 'pending');
    if (e) throw new Error(`休暇取り消しに失敗しました: ${e.message}`);
  }, []);

  const approveLeave = useCallback(async (leaveId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { error: e } = await supabase
      .from('leave_requests')
      .update({
        status: 'approved',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', leaveId);
    if (e) throw new Error(`休暇承認に失敗しました: ${e.message}`);
  }, []);

  const rejectLeave = useCallback(async (leaveId: string, reviewNote: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { error: e } = await supabase
      .from('leave_requests')
      .update({
        status: 'rejected',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_note: reviewNote,
      })
      .eq('id', leaveId);
    if (e) throw new Error(`休暇却下に失敗しました: ${e.message}`);
  }, []);

  const getRemainingPaidLeave = useCallback(async (userId?: string): Promise<number> => {
    let targetUserId = userId;
    if (!targetUserId) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      targetUserId = user.id;
    }

    // 付与日数を取得
    const { data: memberData } = await supabase
      .from('tenant_members')
      .select('paid_leave_days')
      .eq('tenant_id', tenantId)
      .eq('user_id', targetUserId)
      .single();
    const granted = memberData?.paid_leave_days ?? 0;

    // 承認済み全休(paid)の日数を取得
    const { count: fullDayCount } = await supabase
      .from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('user_id', targetUserId)
      .eq('status', 'approved')
      .eq('leave_type', 'paid');

    // 承認済み半休(half_am, half_pm)の日数を取得
    const { count: halfDayCount } = await supabase
      .from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('user_id', targetUserId)
      .eq('status', 'approved')
      .in('leave_type', ['half_am', 'half_pm']);

    const used = (fullDayCount ?? 0) + (halfDayCount ?? 0) * 0.5;
    return Math.max(0, granted - used);
  }, [tenantId]);

  return {
    myLeaves,
    allLeaves,
    loading,
    error,
    getMyLeaves,
    getAllLeaves,
    submitLeave,
    cancelLeave,
    approveLeave,
    rejectLeave,
    getRemainingPaidLeave,
  };
}
