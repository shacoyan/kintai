import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Shift, TenantMember, NotificationType } from '../types';
import { getNightMinutesForShift } from '../utils/nightShift';
import { formatSupabaseError } from '../lib/errors';

interface LaborCostEstimate {
  userId: string;
  displayName: string;
  payType: 'hourly' | 'monthly';
  shiftMinutes: number;
  nightMinutes: number;
  estimatedCost: number;
}

async function notify(args: {
  tenantId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
}) {
  try {
    const { error: nerr } = await supabase
      .from('notifications')
      .insert({
        tenant_id: args.tenantId,
        user_id: args.userId,
        type: args.type,
        title: args.title,
        body: args.body ?? null,
        link: args.link ?? null,
      });
    if (nerr) console.warn('[notify] insert failed:', nerr.message);
  } catch (e) {
    console.warn('[notify] threw:', e);
  }
}

export function useShift(tenantId: string, storeId: string | null) {
  const [myShifts, setMyShifts] = useState<Shift[]>([]);
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getMyShifts = useCallback(async (startDate: string, endDate: string) => {
    if (storeId === null) {
      setMyShifts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error: e } = await supabase
        .from('shifts')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('store_id', storeId)
        .eq('user_id', user.id)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });
      if (e) throw e;
      setMyShifts((data as Shift[]) || []);
    } catch (err: unknown) {
      setError(formatSupabaseError(err).message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, storeId]);

  const getAllShifts = useCallback(async (startDate: string, endDate: string) => {
    if (storeId === null) {
      setAllShifts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from('shifts')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('store_id', storeId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });
      if (e) throw e;
      setAllShifts((data as Shift[]) || []);
    } catch (err: unknown) {
      setError(formatSupabaseError(err).message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, storeId]);

  const submitShift = useCallback(async (date: string, startTime: string, endTime: string, note?: string, storeIdOverride?: string) => {
    const effectiveStoreId = storeIdOverride ?? storeId;
    if (effectiveStoreId === null) throw new Error('店舗が選択されていません');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { error: e } = await supabase
      .from('shifts')
      .insert({
        tenant_id: tenantId,
        user_id: user.id,
        date,
        start_time: startTime,
        end_time: endTime,
        note: note || null,
        store_id: effectiveStoreId,
      });
    if (e) throw new Error(`シフト申請に失敗しました: ${e.message}`);
  }, [tenantId, storeId]);

  const deleteShift = useCallback(async (shiftId: string) => {
    const { error: e } = await supabase
      .from('shifts')
      .delete()
      .eq('id', shiftId);
    if (e) throw new Error(`シフト削除に失敗しました: ${e.message}`);
  }, []);

  const cancelShift = useCallback(async (shiftId: string) => {
    const { error: e } = await supabase
      .from('shifts')
      .update({ status: 'cancelled' })
      .eq('id', shiftId)
      .eq('status', 'pending');
    if (e) throw new Error(`シフト取り消しに失敗しました: ${e.message}`);
  }, []);

  const approveShift = useCallback(async (shiftId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data, error: e } = await supabase
      .from('shifts')
      .update({
        status: 'approved',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', shiftId)
      .select('user_id, date, start_time')
      .single();
    if (e) throw new Error(`シフト承認に失敗しました: ${e.message}`);
    await notify({
      tenantId: tenantId,
      userId: data.user_id,
      type: 'shift_approved',
      title: 'シフトが承認されました',
      body: `${data.date} のシフトが承認されました`,
      link: '/shift?date=' + data.date,
    });
  }, [tenantId]);

  const rejectShift = useCallback(async (shiftId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data, error: e } = await supabase
      .from('shifts')
      .update({
        status: 'rejected',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', shiftId)
      .select('user_id, date, start_time')
      .single();
    if (e) throw new Error(`シフト却下に失敗しました: ${e.message}`);
    await notify({
      tenantId: tenantId,
      userId: data.user_id,
      type: 'shift_rejected',
      title: 'シフトが却下されました',
      body: `${data.date} のシフトが却下されました`,
      link: '/shift?date=' + data.date,
    });
  }, [tenantId]);

  const modifyShift = useCallback(async (shiftId: string, newStartTime: string, newEndTime: string, newStoreId?: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // まず現在のシフトを取得して元の時間を保存
    const { data: current } = await supabase
      .from('shifts')
      .select('start_time, end_time')
      .eq('id', shiftId)
      .single();

    const { error: e } = await supabase
      .from('shifts')
      .update({
        start_time: newStartTime,
        end_time: newEndTime,
        original_start_time: current?.start_time || null,
        original_end_time: current?.end_time || null,
        status: 'modified',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        ...(newStoreId !== undefined ? { store_id: newStoreId } : {}),
      })
      .eq('id', shiftId);
    if (e) throw new Error(`シフト修正に失敗しました: ${e.message}`);
  }, []);

  const bulkApprove = useCallback(async (shiftIds: string[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { error: e } = await supabase
      .from('shifts')
      .update({
        status: 'approved',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .in('id', shiftIds);
    if (e) throw new Error(`一括承認に失敗しました: ${e.message}`);
  }, []);

  const getLaborCostEstimate = useCallback((
    shifts: Shift[],
    members: TenantMember[]
  ): LaborCostEstimate[] => {
    const memberMap = new Map(members.map(m => [m.user_id, m]));
    const userShifts = new Map<string, Shift[]>();

    for (const s of shifts) {
      if (s.status === 'rejected' || s.status === 'cancelled') continue;
      const arr = userShifts.get(s.user_id) || [];
      arr.push(s);
      userShifts.set(s.user_id, arr);
    }

    const results: LaborCostEstimate[] = [];
    for (const [userId, memberShifts] of userShifts) {
      const member = memberMap.get(userId);
      if (!member) continue;

      let totalMinutes = 0;
      let nightMinutes = 0;

      for (const s of memberShifts) {
        const startParts = s.start_time.split(':').map(Number);
        const endParts = s.end_time.split(':').map(Number);
        const startMin = startParts[0] * 60 + startParts[1];
        const endMin = endParts[0] * 60 + endParts[1];
        const shiftMins = endMin > startMin ? endMin - startMin : (24 * 60 - startMin) + endMin;
        totalMinutes += shiftMins;

        // 深夜帯の計算（共通ユーティリティ使用）
        if (member.night_shift_enabled) {
          nightMinutes += getNightMinutesForShift(s.date, s.start_time, s.end_time);
        }
      }

      const payType = member.pay_type ?? 'hourly';
      let estimatedCost: number;
      if (payType === 'monthly') {
        estimatedCost = member.monthly_salary ?? 0;
      } else {
        const rate = member.hourly_rate ?? 0;
        const normalMin = totalMinutes - nightMinutes;
        estimatedCost = Math.ceil((normalMin / 60) * rate + (nightMinutes / 60) * rate * 1.25);
      }

      results.push({
        userId,
        displayName: member.display_name,
        payType,
        shiftMinutes: totalMinutes,
        nightMinutes,
        estimatedCost,
      });
    }
    return results;
  }, []);

  return {
    myShifts,
    allShifts,
    loading,
    error,
    getMyShifts,
    getAllShifts,
    submitShift,
    deleteShift,
    cancelShift,
    approveShift,
    rejectShift,
    modifyShift,
    bulkApprove,
    getLaborCostEstimate,
  };
}
