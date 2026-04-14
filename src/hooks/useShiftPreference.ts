import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { ShiftPreference, ShiftPreferenceType } from '../types';

export function useShiftPreference(tenantId: string) {
  const [myPreferences, setMyPreferences] = useState<ShiftPreference[]>([]);
  const [allPreferences, setAllPreferences] = useState<ShiftPreference[]>([]);
  const [loading, setLoading] = useState(false);

  // 自分のシフト希望を期間で取得
  const fetchMyPreferences = useCallback(async (startDate: string, endDate: string) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
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
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  // 管理者: 全員分の希望を取得
  const fetchAllPreferences = useCallback(async (startDate: string, endDate: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('shift_preferences')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date');
      if (error) throw error;
      setAllPreferences((data as ShiftPreference[]) || []);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  // シフト希望を提出（upsert: 同日は上書き）
  const submitPreference = useCallback(async (
    date: string,
    preferenceType: ShiftPreferenceType,
    startTime?: string,
    endTime?: string,
    note?: string,
  ) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('認証が必要です');
    const { error } = await supabase
      .from('shift_preferences')
      .upsert({
        tenant_id: tenantId,
        user_id: user.id,
        date,
        preference_type: preferenceType,
        start_time: startTime || null,
        end_time: endTime || null,
        note: note || null,
      }, { onConflict: 'tenant_id,user_id,date' });
    if (error) throw new Error(`シフト希望の登録に失敗しました: ${error.message}`);
  }, [tenantId]);

  // シフト希望を削除
  const deletePreference = useCallback(async (preferenceId: string) => {
    const { error } = await supabase
      .from('shift_preferences')
      .delete()
      .eq('id', preferenceId);
    if (error) throw new Error(`シフト希望の削除に失敗しました: ${error.message}`);
  }, []);

  // 管理者: 希望を承認し、shiftsテーブルにシフトを自動作成
  const approvePreference = useCallback(async (
    preferenceId: string,
    overrideStartTime?: string,
    overrideEndTime?: string,
  ) => {
    // 希望レコードを取得
    const { data: pref, error: fetchError } = await supabase
      .from('shift_preferences')
      .select('*')
      .eq('id', preferenceId)
      .single();
    if (fetchError || !pref) throw new Error(`希望の取得に失敗しました: ${fetchError?.message}`);

    const startTime = overrideStartTime ?? pref.start_time;
    const endTime = overrideEndTime ?? pref.end_time;

    if (!startTime || !endTime) {
      throw new Error('開始・終了時刻が設定されていません');
    }

    // ステータスを承認済みに更新
    const { error: updateError } = await supabase
      .from('shift_preferences')
      .update({ status: 'approved' })
      .eq('id', preferenceId);
    if (updateError) throw new Error(`希望の承認に失敗しました: ${updateError.message}`);

    // shiftsテーブルにシフトを作成
    const { error: insertError } = await supabase
      .from('shifts')
      .insert({
        tenant_id: pref.tenant_id,
        user_id: pref.user_id,
        date: pref.date,
        start_time: startTime,
        end_time: endTime,
        status: 'approved',
        note: pref.note || null,
      });
    if (insertError) throw new Error(`シフト作成に失敗しました: ${insertError.message}`);
  }, []);

  // 管理者: 希望を却下
  const rejectPreference = useCallback(async (preferenceId: string) => {
    const { error } = await supabase
      .from('shift_preferences')
      .update({ status: 'rejected' })
      .eq('id', preferenceId);
    if (error) throw new Error(`希望の却下に失敗しました: ${error.message}`);
  }, []);

  return {
    myPreferences, allPreferences, loading,
    fetchMyPreferences, fetchAllPreferences,
    submitPreference, deletePreference,
    approvePreference, rejectPreference,
  };
}
