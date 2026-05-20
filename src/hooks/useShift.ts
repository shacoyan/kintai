import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Shift, TenantMember, NotificationType } from '../types';
import { getNightMinutesForShift } from '../utils/nightShift';
import { formatSupabaseError, type FriendlyError } from '../lib/errors';

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
  const [error, setError] = useState<FriendlyError | null>(null);
  const clearError = useCallback(() => setError(null), []);

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
      setError(formatSupabaseError(err));
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
      setError(formatSupabaseError(err));
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
    if (e) throw new Error(`シフトの作成に失敗しました: ${e.message}`);
  }, [tenantId, storeId]);

  const deleteShift = useCallback(async (shiftId: string) => {
    const { error: e } = await supabase
      .from('shifts')
      .delete()
      .eq('id', shiftId);
    if (e) throw new Error(`シフトの削除に失敗しました: ${e.message}`);
  }, []);

  const cancelShift = useCallback(async (shiftId: string) => {
    const { error: e } = await supabase
      .from('shifts')
      .update({ status: 'cancelled' })
      .eq('id', shiftId)
      .eq('status', 'pending');
    if (e) throw new Error(`シフトの取り消しに失敗しました: ${e.message}`);
  }, []);

  const approveShift = useCallback(async (shiftId: string) => {
    const { data, error: e } = await supabase.rpc('approve_shift_final', { p_shift_id: shiftId });
    if (e) throw new Error(`シフトの承認に失敗しました: ${e.message}`);
    const shift = data as Shift;
    await notify({
      tenantId: tenantId,
      userId: shift.user_id,
      type: 'shift_approved',
      title: 'シフトが承認されました',
      body: `${shift.date} のシフトが承認されました`,
      link: '/shift?date=' + shift.date,
    });
  }, [tenantId]);

  const rejectShift = useCallback(async (shiftId: string, reason?: string) => {
    const { data, error: e } = await supabase.rpc('reject_shift', {
      p_shift_id: shiftId,
      p_reason: reason ?? null,
    });
    if (e) {
      // SQLSTATE → 日本語マップ (Loop D `mapReviewErrorCode` パターン踏襲)
      const code = (e as { code?: string }).code;
      const msg = e.message ?? '';
      if (code === '42501' || /permission denied/i.test(msg)) {
        throw new Error('シフトの却下権限がありません。管理者に確認してください。');
      }
      if (/cannot reject shift with status/i.test(msg)) {
        throw new Error('このシフトは現在のステータスでは却下できません。画面を更新してください。');
      }
      if (/shift not found/i.test(msg)) {
        throw new Error('シフトが見つかりませんでした。画面を更新してください。');
      }
      if (/auth\.uid is null|auth required/i.test(msg)) {
        throw new Error('ログインが必要です。再ログインしてください。');
      }
      throw new Error(`シフトの却下に失敗しました: ${msg}`);
    }
    // RPC は `RETURNS shifts` のため 0 行返却は仕様上ありえないが、念のため検査 (Loop A 規律)
    if (!data) throw new Error('reject_shift returned no row');
    const shift = data as Shift;
    await notify({
      tenantId: tenantId,
      userId: shift.user_id,
      type: 'shift_rejected',
      title: 'シフトが却下されました',
      body: `${shift.date} のシフトが却下されました`,
      link: '/shift?date=' + shift.date,
    });
  }, [tenantId]);

  const modifyShift = useCallback(async (shiftId: string, newStartTime: string, newEndTime: string, newStoreId?: string) => {
    const { error: e } = await supabase.rpc('update_shift_time', {
      p_shift_id: shiftId,
      p_start_time: newStartTime,
      p_end_time: newEndTime,
      p_store_id: newStoreId ?? null
    });
    if (e) throw new Error(`シフトの修正に失敗しました: ${e.message}`);
  }, []);

  const tentativeApproveShift = useCallback(async (shiftId: string) => {
    const { error: e } = await supabase.rpc('approve_shift_tentative', { p_shift_id: shiftId });
    if (e) throw new Error(`シフトの仮承認に失敗しました: ${e.message}`);
    // 仮承認時のスタッフ通知は出さない (設計書 §補遺 A Q4=b)
    // 本承認時 (approveShift) の shift_approved 通知のみ送る
  }, []);

  const cancelShiftTentative = useCallback(async (shiftId: string) => {
    const { error: e } = await supabase.rpc('cancel_shift_tentative', { p_shift_id: shiftId });
    if (e) throw new Error(`仮承認の取消に失敗しました: ${e.message}`);
  }, []);

  const revertShiftToTentative = useCallback(async (shiftId: string) => {
    const { data, error: e } = await supabase.rpc('revert_shift_to_tentative', { p_shift_id: shiftId });
    if (e) {
      const code = (e as { code?: string }).code;
      const msg = e.message ?? '';
      if (code === '42501' || /permission denied/i.test(msg)) {
        throw new Error('シフトを仮承認に戻す権限がありません。管理者に確認してください。');
      }
      if (/cannot revert: not in approved state/i.test(msg)) {
        throw new Error('このシフトは確定承認済みではないため仮承認に戻せません。画面を更新してください。');
      }
      if (/shift not found/i.test(msg)) {
        throw new Error('シフトが見つかりませんでした。画面を更新してください。');
      }
      if (/auth\.uid is null/i.test(msg)) {
        throw new Error('ログインが必要です。再ログインしてください。');
      }
      throw new Error(`シフトを仮承認に戻すのに失敗しました: ${msg}`);
    }
    if (!data) throw new Error('revert_shift_to_tentative returned no row');
    return data as Shift;
  }, []);

  const restoreShift = useCallback(async (shiftId: string) => {
    const { data, error: e } = await supabase.rpc('restore_shift', { p_shift_id: shiftId });
    if (e) throw new Error(`シフトの復元に失敗しました: ${e.message}`);
    if (!data) throw new Error('restore_shift returned no row');
    return data as Shift;
  }, []);

  const finalApproveStoreShifts = useCallback(async (tenantId: string, storeId: string) => {
    const { data, error: e } = await supabase.rpc('approve_store_shifts_final', { p_tenant_id: tenantId, p_store_id: storeId });
    if (e) throw new Error(`店舗の一括本承認に失敗しました: ${e.message}`);
    const row = (data as Array<{approved_count: number; approved_ids: string[]}> | null)?.[0];
    return { approvedCount: row?.approved_count ?? 0, approvedIds: row?.approved_ids ?? [] as string[] };
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
        // migration 036: night_shift_enabled DEFAULT true + 既存 NULL を true に UPDATE のため、
        // 未指定 (undefined/null) = ON 扱いで統一する。
        if (member.night_shift_enabled !== false) {
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
    clearError,
    getMyShifts,
    getAllShifts,
    submitShift,
    deleteShift,
    cancelShift,
    approveShift,
    rejectShift,
    modifyShift,
    tentativeApproveShift,
    cancelShiftTentative,
    revertShiftToTentative,
    restoreShift,
    finalApproveStoreShifts,
    getLaborCostEstimate,
  };
}
