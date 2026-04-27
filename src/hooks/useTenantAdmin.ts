import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { TenantMember, AttendanceRecord } from '../types';

export function useTenantAdmin(tenantId: string) {
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [allAttendance, setAllAttendance] = useState<AttendanceRecord[]>([]);
  const [memberAttendance, setMemberAttendance] = useState<AttendanceRecord[]>([]);
  const [loadingCount, setLoadingCount] = useState(0);
  const loading = loadingCount > 0;
  const startLoading = () => setLoadingCount(c => c + 1);
  const stopLoading = () => setLoadingCount(c => Math.max(0, c - 1));
  const [error, setError] = useState<string | null>(null);

  const fetchMembers = useCallback(async (storeId?: string | null) => {
    startLoading();
    setError(null);
    try {
      if (storeId != null) {
        const { data: storeMembersData, error: storeMembersError } = await supabase
          .from('store_members')
          .select('member_id')
          .eq('store_id', storeId);

        if (storeMembersError) {
          setError(storeMembersError.message);
          return;
        }

        const memberIds = (storeMembersData || []).map((sm: any) => sm.member_id);
        if (memberIds.length === 0) {
          setMembers([]);
          return;
        }

        const { data, error: e } = await supabase
          .from('tenant_members')
          .select('*')
          .eq('tenant_id', tenantId)
          .in('id', memberIds)
          .order('created_at', { ascending: true });

        if (e) {
          setError(e.message);
        } else {
          setMembers((data as TenantMember[]) || []);
        }
      } else {
        const { data, error: e } = await supabase
          .from('tenant_members')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: true });
        if (e) {
          setError(e.message);
        } else {
          setMembers((data as TenantMember[]) || []);
        }
      }
    } finally {
      stopLoading();
    }
  }, [tenantId]);

  const updateHourlyRate = useCallback(async (memberId: string, rate: number) => {
    const { data, error: e } = await supabase
      .from('tenant_members')
      .update({ hourly_rate: rate })
      .eq('id', memberId)
      .select()
      .single();
    if (e) throw new Error(`時給の更新に失敗しました: ${e.message}`);
    if (!data) throw new Error('時給の更新に失敗しました（権限がない可能性があります）');
    await fetchMembers();
  }, [fetchMembers]);

  const fetchAllAttendance = useCallback(async (year: number, month: number, storeId: string | null) => {
    startLoading();
    setError(null);
    try {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      
      let query = supabase
        .from('attendance_records')
        .select('*, breaks(*)')
        .eq('tenant_id', tenantId)
        .gte('date', startDate)
        .lte('date', endDate);

      if (storeId !== null) {
        query = query.eq('store_id', storeId);
      }

      const { data, error: e } = await query.order('date', { ascending: true });
      
      if (e) {
        setError(e.message);
      } else {
        setAllAttendance((data as AttendanceRecord[]) || []);
      }
    } finally {
      stopLoading();
    }
  }, [tenantId]);

  const fetchMemberAttendance = useCallback(async (userId: string, startDate: string, endDate: string) => {
    startLoading();
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from('attendance_records')
        .select('*, breaks(*)')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true })
        .order('clock_in', { ascending: true });
      if (e) {
        setError(e.message);
      } else {
        setMemberAttendance((data as AttendanceRecord[]) || []);
      }
    } finally {
      stopLoading();
    }
  }, [tenantId]);

  const updateAttendance = useCallback(async (recordId: string, data: { clock_in?: string; clock_out?: string; total_work_minutes?: number }) => {
    const { data: updated, error: e } = await supabase
      .from('attendance_records')
      .update(data)
      .eq('id', recordId)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (e) throw new Error(`勤怠記録の更新に失敗: ${e.message}`);
    if (!updated) throw new Error('勤怠記録の更新に失敗しました（権限がない可能性があります）');
  }, [tenantId]);

  const deleteAttendance = useCallback(async (recordId: string) => {
    const { error: e } = await supabase
      .from('attendance_records')
      .delete()
      .eq('id', recordId)
      .eq('tenant_id', tenantId);
    if (e) throw new Error(`勤怠記録の削除に失敗: ${e.message}`);
  }, [tenantId]);

  const updatePayType = useCallback(async (memberId: string, payType: 'hourly' | 'monthly') => {
    const { data, error: e } = await supabase
      .from('tenant_members')
      .update({ pay_type: payType })
      .eq('id', memberId)
      .select()
      .single();
    if (e) throw new Error(`給与タイプの更新に失敗しました: ${e.message}`);
    if (!data) throw new Error('給与タイプの更新に失敗しました（権限がない可能性があります）');
    await fetchMembers();
  }, [fetchMembers]);

  const updateMonthlySalary = useCallback(async (memberId: string, salary: number) => {
    const { data, error: e } = await supabase
      .from('tenant_members')
      .update({ monthly_salary: salary })
      .eq('id', memberId)
      .select()
      .single();
    if (e) throw new Error(`月給の更新に失敗しました: ${e.message}`);
    if (!data) throw new Error('月給の更新に失敗しました（権限がない可能性があります）');
    await fetchMembers();
  }, [fetchMembers]);

  const updatePaidLeaveDays = useCallback(async (memberId: string, days: number) => {
    const { data, error: e } = await supabase
      .from('tenant_members')
      .update({ paid_leave_days: days })
      .eq('id', memberId)
      .select()
      .single();
    if (e) throw new Error(`有給日数の更新に失敗しました: ${e.message}`);
    if (!data) throw new Error('有給日数の更新に失敗しました（権限がない可能性があります）');
    await fetchMembers();
  }, [fetchMembers]);

  const updateRole = useCallback(async (memberId: string, role: 'manager' | 'staff') => {
    const { data, error: e } = await supabase
      .from('tenant_members')
      .update({ role })
      .eq('id', memberId)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (e) throw new Error(`権限の更新に失敗しました: ${e.message}`);
    if (!data) throw new Error('権限の更新に失敗しました（権限がない可能性があります）');
    await fetchMembers();
  }, [tenantId, fetchMembers]);

  const deleteMember = useCallback(async (memberId: string) => {
    const { error: e } = await supabase
      .from('tenant_members')
      .delete()
      .eq('id', memberId)
      .eq('tenant_id', tenantId);
    if (e) throw new Error(`メンバーの削除に失敗しました: ${e.message}`);
    await fetchMembers();
  }, [tenantId, fetchMembers]);

  const updateNightShift = useCallback(async (memberId: string, enabled: boolean) => {
    const { data, error: e } = await supabase
      .from('tenant_members')
      .update({ night_shift_enabled: enabled })
      .eq('id', memberId)
      .select()
      .single();
    if (e) throw new Error(`深夜給設定の更新に失敗しました: ${e.message}`);
    if (!data) throw new Error('深夜給設定の更新に失敗しました（権限がない可能性があります）');
    await fetchMembers();
  }, [fetchMembers]);

  return {
    members,
    allAttendance,
    memberAttendance,
    loading,
    error,
    fetchMembers,
    updateHourlyRate,
    fetchAllAttendance,
    fetchMemberAttendance,
    updateAttendance,
    deleteAttendance,
    updateRole,
    deleteMember,
    updateNightShift,
    updatePayType,
    updateMonthlySalary,
    updatePaidLeaveDays,
  };
}
