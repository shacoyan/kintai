import { useState, useCallback } from 'react';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { formatSupabaseError, type FriendlyError } from '../lib/errors';
import type { ShiftPreference, ShiftPreferenceType, BulkSubmitPreferenceArgs, BulkSubmitResult } from '../types';
import type { NotificationType } from '../types';

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

export function useShiftPreference(tenantId: string, storeId: string | null) {
  const [myPreferences, setMyPreferences] = useState<ShiftPreference[]>([]);
  const [allPreferences, setAllPreferences] = useState<ShiftPreference[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const clearError = useCallback(() => setError(null), []);

  // 自分のシフト希望を期間で取得（B-1 修正: 店舗横断で全店舗の自分の希望を取得する）
  // tenant_id + user_id + 期間で絞る。store_id フィルタは廃止（複数店舗所属者対応）。
  const fetchMyPreferences = useCallback(async (startDate: string, endDate: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;
      const { data, error } = await supabase
        .from('shift_preferences')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('user_id', user.id)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date');
      if (error) throw error;
      setMyPreferences((data as ShiftPreference[]) || []);
    } catch (err) {
      const formatted = formatSupabaseError(err);
      setError(formatted);
      logger.error('fetchMyPreferences error:', formatted);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  // 店長: 全員分の希望を取得
  const fetchAllPreferences = useCallback(async (startDate: string, endDate: string) => {
    if (storeId === null) {
      setAllPreferences([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('shift_preferences')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('store_id', storeId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date');
      if (error) throw error;
      setAllPreferences((data as ShiftPreference[]) || []);
    } catch (err) {
      const formatted = formatSupabaseError(err);
      setError(formatted);
      logger.error('fetchAllPreferences error:', formatted);
    } finally {
      setLoading(false);
    }
  }, [tenantId, storeId]);

  // シフト希望を提出（upsert: 同日は上書き）
  const submitPreference = useCallback(async (
    date: string,
    preferenceType: ShiftPreferenceType,
    startTime?: string,
    endTime?: string,
    note?: string,
    storeIdOverride?: string,
  ) => {
    setError(null);

    // 旧 bundle 残留対策: 廃止済の 'available' を受けたら 'preferred' に正規化。
    // SW v3 キャッシュ bump 後の過渡期と、稀な SW activate 遅延端末への二重防御。
    // TS 型上は ShiftPreferenceType（'preferred' | 'unavailable'）だが、runtime では
    // 旧 chunk から 'available' が紛れ込む可能性があるため as string で比較する。
    const normalizedType: ShiftPreferenceType =
      (preferenceType as string) === 'available' ? 'preferred' : preferenceType;
    if (import.meta.env.DEV && normalizedType !== preferenceType) {
      // eslint-disable-next-line no-console
      console.warn(
        `[useShiftPreference] normalized legacy preference_type '${String(preferenceType)}' -> '${normalizedType}'`,
      );
    }

    const effectiveStoreId = storeIdOverride ?? storeId;
    if (effectiveStoreId === null) throw new Error('店舗が選択されていません');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('認証が必要です');
    try {
      const { error } = await supabase
        .from('shift_preferences')
        .upsert({
          tenant_id: tenantId,
          user_id: user.id,
          date,
          preference_type: normalizedType,
          start_time: startTime || null,
          end_time: endTime || null,
          note: note || null,
          store_id: effectiveStoreId,
          status: normalizedType === 'unavailable' ? 'approved' : 'pending',
        }, { onConflict: 'tenant_id,user_id,date,store_id' });
      if (error) throw error;
    } catch (err) {
      const formatted = formatSupabaseError(err);
      setError(formatted);
      logger.error('submitPreference error:', formatted);
      throw err;
    }
  }, [tenantId, storeId]);

  // シフト希望を削除
  const deletePreference = useCallback(async (preferenceId: string) => {
    setError(null);
    try {
      const { error } = await supabase
        .from('shift_preferences')
        .delete()
        .eq('id', preferenceId);
      if (error) throw error;
    } catch (err) {
      const formatted = formatSupabaseError(err);
      setError(formatted);
      logger.error('deletePreference error:', formatted);
      throw err;
    }
  }, []);

  // 店長: 希望を承認し、shiftsテーブルにシフトを自動作成
  const approvePreference = useCallback(async (
    preferenceId: string,
    overrideStartTime?: string,
    overrideEndTime?: string,
  ) => {
    setError(null);
    try {
      // P2-3 / B(101): preference UPDATE + shifts INSERT を単一トランザクションの
      // SECURITY DEFINER RPC approve_preference に置換（原子化・ON CONFLICT 冪等・
      // unavailable&&approved の早期 no-op は RPC 側に移植済）。通知も RPC 側で一括発行。
      const { error } = await supabase.rpc('approve_preference', {
        p_preference_id: preferenceId,
        p_override_start: overrideStartTime ?? null,
        p_override_end: overrideEndTime ?? null,
      });
      if (error) {
        // SQLSTATE / message → 日本語マップ（rejectShift / revertShiftToTentative 踏襲）
        const code = (error as { code?: string }).code;
        const msg = error.message ?? '';
        if (code === '42501' || /permission denied/i.test(msg)) {
          throw new Error('シフト申請を承認する権限がありません。管理者に確認してください。');
        }
        if (/preference not found|not found/i.test(msg)) {
          throw new Error('シフト申請が見つかりませんでした。画面を更新してください。');
        }
        if (/start.*end|時刻|time.*null|missing time/i.test(msg)) {
          throw new Error('開始・終了時刻が設定されていません。');
        }
        if (/store|店舗/i.test(msg)) {
          throw new Error('シフト申請に店舗が紐付いていません。');
        }
        if (/auth\.uid is null|auth required/i.test(msg)) {
          throw new Error('ログインが必要です。再ログインしてください。');
        }
        throw new Error(`シフト申請の承認に失敗しました: ${msg}`);
      }
    } catch (err) {
      const formatted = formatSupabaseError(err);
      setError(formatted);
      logger.error('approvePreference error:', formatted);
      throw err;
    }
  }, []);

  // 店長: 希望を却下
  const rejectPreference = useCallback(async (preferenceId: string) => {
    setError(null);
    try {
      const { data: pref, error: fetchError } = await supabase
        .from('shift_preferences')
        .select('user_id, tenant_id, date')
        .eq('id', preferenceId)
        .single();
      if (fetchError || !pref) throw new Error(`シフト申請の取得に失敗しました: ${fetchError?.message}`);

      const { error } = await supabase
        .from('shift_preferences')
        .update({ status: 'rejected' })
        .eq('id', preferenceId);
      if (error) throw error;

      await notify({
        tenantId: pref.tenant_id,
        userId: pref.user_id,
        type: 'preference_rejected' as NotificationType,
        title: 'シフト申請が却下されました',
        link: '/shift?tab=preferences',
      });
    } catch (err) {
      const formatted = formatSupabaseError(err);
      setError(formatted);
      logger.error('rejectPreference error:', formatted);
      throw err;
    }
  }, []);

  // 承認・却下済みの希望を保留に戻す
  const revertPreference = useCallback(async (preferenceId: string) => {
    setError(null);
    try {
      // P1-3 / B(101): 希望を pending に戻す導線を単一トランザクションの
      // SECURITY DEFINER RPC revert_preference に置換。
      // RPC 側で「リンク仮承認シフト(tentative/pending)の削除 → 本承認(approved)が
      // 残っている場合は RAISE → preference を pending 化 → 通知」を原子的に実施。
      // 旧フロントの手動 fetch + DELETE.match + UPDATE 2 段書き込みを撤去。
      const { error } = await supabase.rpc('revert_preference', {
        p_preference_id: preferenceId,
      });
      if (error) {
        const code = (error as { code?: string }).code;
        const msg = error.message ?? '';
        if (code === '42501' || /permission denied/i.test(msg)) {
          throw new Error('シフト申請を保留に戻す権限がありません。管理者に確認してください。');
        }
        if (/本承認済み|approved.*shift|cannot revert/i.test(msg)) {
          throw new Error('本承認済みのシフトがあるため希望を保留に戻せません。先にシフトを差し戻してください。');
        }
        if (/preference not found|not found/i.test(msg)) {
          throw new Error('シフト申請が見つかりませんでした。画面を更新してください。');
        }
        if (/auth\.uid is null|auth required/i.test(msg)) {
          throw new Error('ログインが必要です。再ログインしてください。');
        }
        throw new Error(`シフト申請の保留化に失敗しました: ${msg}`);
      }
    } catch (err) {
      const formatted = formatSupabaseError(err);
      setError(formatted);
      logger.error('revertPreference error:', formatted);
      throw err;
    }
  }, []);

  // P1-5: 希望一括承認の N+1 解消。複数 pending を ids でまとめて承認する set-based RPC ラッパ。
  // ShiftPage は for..of の直列 await を撤去し、これを 1 回呼ぶ（呼び出し置換は E3 担当）。
  // RPC 側で preference 一括 approved + shifts 一括 tentative INSERT + 通知一括を原子実施。
  // 混在テナント/店舗 ids または権限外 ids が 1 件でも含まれると全体 RAISE。
  const approvePreferencesByIds = useCallback(async (ids: string[]): Promise<{ approvedCount: number; approvedIds: string[] }> => {
    if (ids.length === 0) return { approvedCount: 0, approvedIds: [] };
    const { data, error } = await supabase.rpc('approve_preferences', { p_ids: ids });
    if (error) {
      const code = (error as { code?: string }).code;
      const msg = error.message ?? '';
      if (code === '42501' || /permission denied/i.test(msg)) {
        throw new Error('シフト申請を一括承認する権限がありません。管理者に確認してください。');
      }
      throw new Error(`シフト申請の一括承認に失敗しました: ${msg}`);
    }
    const row = (data as Array<{ approved_count: number; approved_ids: string[] }> | null)?.[0];
    return { approvedCount: row?.approved_count ?? 0, approvedIds: row?.approved_ids ?? [] };
  }, []);

  // P1-5: 希望一括却下の N+1 解消（approvePreferencesByIds と対）。
  const rejectPreferencesByIds = useCallback(async (ids: string[]): Promise<{ rejectedCount: number; rejectedIds: string[] }> => {
    if (ids.length === 0) return { rejectedCount: 0, rejectedIds: [] };
    const { data, error } = await supabase.rpc('reject_preferences', { p_ids: ids });
    if (error) {
      const code = (error as { code?: string }).code;
      const msg = error.message ?? '';
      if (code === '42501' || /permission denied/i.test(msg)) {
        throw new Error('シフト申請を一括却下する権限がありません。管理者に確認してください。');
      }
      throw new Error(`シフト申請の一括却下に失敗しました: ${msg}`);
    }
    const row = (data as Array<{ rejected_count: number; rejected_ids: string[] }> | null)?.[0];
    return { rejectedCount: row?.rejected_count ?? 0, rejectedIds: row?.rejected_ids ?? [] };
  }, []);

  const bulkSubmitPreferences = useCallback(async (args: BulkSubmitPreferenceArgs): Promise<BulkSubmitResult> => {
    if (args.dates.length === 0) {
      return { successCount: 0, failedDates: [], lockedDates: [] };
    }

    setError(null);

    if (storeId === null) throw new Error('店舗が選択されていません');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('認証が必要です');

    try {
      // 事前 fetch: 既存行を取得
      const { data: existing, error: fetchError } = await supabase
        .from('shift_preferences')
        .select('date,status,preference_type')
        .eq('tenant_id', tenantId)
        .eq('user_id', user.id)
        .eq('store_id', storeId)
        .in('date', args.dates);

      if (fetchError) throw fetchError;

      // 承認済み preferred の date 集合を抽出
      const lockedDates = (existing || [])
        .filter((r: any) => r.status === 'approved' && r.preference_type === 'preferred')
        .map((r: any) => r.date as string);
      const lockedDatesSet = new Set(lockedDates);

      const targetDates = args.dates.filter(d => !lockedDatesSet.has(d));

      if (targetDates.length === 0) {
        return { successCount: 0, failedDates: [], lockedDates };
      }

      const rows = targetDates.map(date => ({
        tenant_id: tenantId,
        user_id: user.id,
        date,
        preference_type: args.type,
        start_time: args.type === 'preferred' ? (args.startTime || null) : null,
        end_time: args.type === 'preferred' ? (args.endTime || null) : null,
        note: null,
        store_id: storeId,
        status: args.type === 'unavailable' ? 'approved' : 'pending',
      }));

      const { data, error } = await supabase
        .from('shift_preferences')
        .upsert(rows, { onConflict: 'tenant_id,user_id,date,store_id' })
        .select('id,date');

      if (error) {
        const formatted = formatSupabaseError(error);
        setError(formatted);
        logger.error('bulkSubmitPreferences error:', formatted);
        return { successCount: 0, failedDates: targetDates.slice(), lockedDates };
      }

      const returnedDates = new Set((data || []).map((r: any) => r.date as string));
      const failedDates = targetDates.filter(d => !returnedDates.has(d));
      const successCount = targetDates.length - failedDates.length;

      return { successCount, failedDates, lockedDates };
    } catch (err) {
      const formatted = formatSupabaseError(err);
      setError(formatted);
      logger.error('bulkSubmitPreferences error:', formatted);
      return { successCount: 0, failedDates: args.dates.slice(), lockedDates: [] };
    }
  }, [tenantId, storeId]);

  return {
    myPreferences, allPreferences, loading, error, clearError,
    fetchMyPreferences, fetchAllPreferences,
    submitPreference, deletePreference,
    bulkSubmitPreferences,
    approvePreference, rejectPreference,
    revertPreference,
    approvePreferencesByIds, rejectPreferencesByIds,
  };
}
