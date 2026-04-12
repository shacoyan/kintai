import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
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
      const msg = err instanceof Error ? err.message : '休暇の取得に失敗しました';
      setError(msg);
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
      const msg = err instanceof Error ? err.message : '休暇の取得に失敗しました';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  const submitLeave = useCallback(async (date: string, leaveType: LeaveType, reason?: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { error: e } = await supabase
      .from('leave_requests')
      .insert({
        tenant_id: tenantId,
        user_id: user.id,
        date,
        leave_type: leaveType,
        reason: reason || null,
      });
    if (e) throw new Error(`休暇申請に失敗しました: ${e.message}`);
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

  const rejectLeave = useCallback(async (leaveId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { error: e } = await supabase
      .from('leave_requests')
      .update({
        status: 'rejected',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', leaveId);
    if (e) throw new Error(`休暇却下に失敗しました: ${e.message}`);
  }, []);

  const getRemainingPaidLeave = useCallback(async (userId: string): Promise<number> => {
    // 付与日数を取得
    const { data: memberData } = await supabase
      .from('tenant_members')
      .select('paid_leave_days')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .single();
    const granted = memberData?.paid_leave_days ?? 0;

    // 承認済み全休(paid)の日数を取得
    const { count: fullDayCount } = await supabase
      .from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .eq('status', 'approved')
      .eq('leave_type', 'paid');

    // 承認済み半休(half_paid)の日数を取得
    const { count: halfDayCount } = await supabase
      .from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .eq('status', 'approved')
      .eq('leave_type', 'half_paid');

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
