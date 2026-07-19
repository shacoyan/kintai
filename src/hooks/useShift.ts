import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Shift, TenantMember, TenantRole, NotificationType, MemberStorePayroll } from '../types';
import { getMemberPayrollForStore } from '../utils/payrollCalc';
import { getNightMinutesForShift } from '../utils/nightShift';
import { formatSupabaseError, type FriendlyError } from '../lib/errors';

export interface LaborCostEstimate {
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
      const { data: { session } } = await supabase.auth.getSession();
      let user = session?.user ?? null;
      if (!user) {
        const { data: { user: refreshed } } = await supabase.auth.getUser();
        user = refreshed ?? null;
      }
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
    const { data, error: e } = await supabase
      .from('shifts')
      .insert({
        tenant_id: tenantId,
        user_id: user.id,
        date,
        start_time: startTime,
        end_time: endTime,
        note: note || null,
        store_id: effectiveStoreId,
      })
      .select('id');
    if (e) throw new Error(`シフトの作成に失敗しました: ${e.message}`);
    // P3-5: RLS で 0 行 INSERT は無音 success になるため明示エラー化
    if (!data || data.length === 0) {
      throw new Error('シフトの作成に失敗しました: 対象が見つからないか権限がありません');
    }
  }, [tenantId, storeId]);

  const addShiftForMember = useCallback(async (date: string, userId: string, storeId: string, startTime: string, endTime: string, note?: string, frameId?: string | null): Promise<Shift> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data, error: e } = await supabase
      .from('shifts')
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        store_id: storeId,
        date,
        start_time: startTime,
        end_time: endTime,
        status: 'tentative',
        note: note ?? null,
        frame_id: frameId ?? null,
      })
      .select()
      .single();
    if (e) throw new Error(`シフトの追加に失敗しました: ${e.message}`);
    if (!data) throw new Error('シフトの追加に失敗しました: データが返されませんでした');
    return data as Shift;
  }, [tenantId]);

  const deleteShift = useCallback(async (shiftId: string) => {
    const { data, error: e } = await supabase
      .from('shifts')
      .delete()
      .eq('id', shiftId)
      .select('id');
    if (e) throw new Error(`シフトの削除に失敗しました: ${e.message}`);
    // P3-3: RLS で 0 行 DELETE は無音 success になるため明示エラー化
    if (!data || data.length === 0) {
      throw new Error('シフトの削除に失敗しました: 対象が見つからないか権限がありません');
    }
  }, []);

  const cancelShift = useCallback(async (shiftId: string) => {
    const { data, error: e } = await supabase
      .from('shifts')
      .update({ status: 'cancelled' })
      .eq('id', shiftId)
      .eq('status', 'pending')
      .select('id');
    if (e) throw new Error(`シフトの取り消しに失敗しました: ${e.message}`);
    // P3-3: RLS / status 不一致で 0 行更新は無音 success になるため明示エラー化
    if (!data || data.length === 0) {
      throw new Error('シフトの取り消しに失敗しました: 対象が見つからないか、既に処理済みです');
    }
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

  const finalApproveStoreShifts = useCallback(async (tenantId: string, storeId: string, from: string, to: string) => {
    // 通知は RPC 側 (approve_store_shifts_final) が per-item と同型で一括 INSERT するため
    // フロント側の通知ループは不要。指定期間 [from, to] の tentative のみ本承認される。
    const { data, error: e } = await supabase.rpc('approve_store_shifts_final', {
      p_tenant_id: tenantId,
      p_store_id: storeId,
      p_from: from,
      p_to: to,
    });
    if (e) throw new Error(`店舗の一括本承認に失敗しました: ${e.message}`);
    const row = (data as Array<{approved_count: number; approved_ids: string[]}> | null)?.[0];
    return { approvedCount: row?.approved_count ?? 0, approvedIds: row?.approved_ids ?? [] as string[] };
  }, []);

  const getLaborCostEstimate = useCallback((
    shifts: Shift[],
    members: TenantMember[],
    rolesMap?: Map<string, TenantRole>,
    payrollsMap?: Map<string, MemberStorePayroll>
  ): LaborCostEstimate[] => {
    // Phase 2: 店舗別人件費対応。payrollsMap が空 (= 既存呼出 / 既存テナント) のときは
    // getMemberPayrollForStore が tenant_members.hourly_rate / monthly_salary に fallback するため
    // 既存挙動と完全互換 (regression なし)。
    const safePayrollsMap = payrollsMap ?? new Map<string, MemberStorePayroll>();
    const memberMap = new Map(members.map(m => [m.user_id, m]));
    const userShifts = new Map<string, Shift[]>();

    // P1-4: 見込み計上は確定方向の status のみに限定（pending = 申請段階は非計上）。
    // 旧実装は「rejected/cancelled 以外を全合算」= pending を拾う除外リスト方式だった。
    // ShiftPage の all(monthShifts 全 status を渡す)からも pending が除外され、
    // laborEstimates 意図コメント「tentative + approved」と一致する（modified も確定方向なので含める）。
    const COUNTABLE = new Set(['tentative', 'approved', 'modified']);
    for (const s of shifts) {
      if (!COUNTABLE.has(s.status)) continue;
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
        // P3: 0時間勤務ガード (start_time === end_time の 24h 誤計上を防ぐ)
        if (shiftMins <= 0) continue;
        totalMinutes += shiftMins;

        // 深夜帯の計算（共通ユーティリティ使用）
        // migration 036: night_shift_enabled DEFAULT true + 既存 NULL を true に UPDATE のため、
        // 未指定 (undefined/null) = ON 扱いで統一する。
        if (member.night_shift_enabled !== false) {
          nightMinutes += getNightMinutesForShift(s.date, s.start_time, s.end_time);
        }
      }

      // Phase 2: 代表店舗 (repStoreId) を決定 — shift 内で最頻 store_id を選ぶ。
      // タイブレークは最初に最大件数に到達した store_id を保持。
      // 全 shift が store_id=null の場合は repStoreId=null (= tenant_members 既定値で fallback)。
      const storeIdCounts = new Map<string, number>();
      let repStoreId: string | null = null;
      let maxCount = 0;
      for (const s of memberShifts) {
        if (!s.store_id) continue;
        const currentCount = (storeIdCounts.get(s.store_id) ?? 0) + 1;
        storeIdCounts.set(s.store_id, currentCount);
        if (currentCount > maxCount) {
          maxCount = currentCount;
          repStoreId = s.store_id;
        }
      }

      // Phase 2: 代表店舗の rate / pay_type を取得。
      // - 月給: 代表店舗の monthlySalary をそのまま計上 (案 A: メンバー全体で 1 つの月給)
      // - 時給: pay_type 判定だけ代表店舗で行い、実際の金額は shift 1 件ごとに rate を引き直す
      const repPayroll = getMemberPayrollForStore(member, repStoreId, safePayrollsMap, rolesMap);
      const payType = repPayroll.payType;

      let estimatedCost: number;
      if (payType === 'monthly') {
        estimatedCost = repPayroll.monthlySalary;
      } else {
        // 時給メンバー: shift 単位で store_id ごとに rate を引き直して合算
        // (店舗 A=1500, 店舗 B=1800 のような mixed パターンを正確に集計)
        let accumulator = 0;
        for (const s of memberShifts) {
          const startParts = s.start_time.split(':').map(Number);
          const endParts = s.end_time.split(':').map(Number);
          const startMin = startParts[0] * 60 + startParts[1];
          const endMin = endParts[0] * 60 + endParts[1];
          const shiftMins = endMin > startMin ? endMin - startMin : (24 * 60 - startMin) + endMin;
          if (shiftMins <= 0) continue;

          const shiftNightMins = (member.night_shift_enabled !== false)
            ? getNightMinutesForShift(s.date, s.start_time, s.end_time)
            : 0;
          const normalMin = shiftMins - shiftNightMins;

          const shiftPayroll = getMemberPayrollForStore(member, s.store_id, safePayrollsMap, rolesMap);
          const hourlyRate = shiftPayroll.hourlyRate;
          const nightMultiplier = shiftPayroll.nightMultiplier;

          accumulator += (normalMin / 60) * hourlyRate + (shiftNightMins / 60) * hourlyRate * nightMultiplier;
        }
        estimatedCost = Math.ceil(accumulator);
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
    addShiftForMember,
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
