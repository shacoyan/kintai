import { useState, useCallback } from 'react';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { formatSupabaseError } from '../lib/errors';
import type { ShiftFrame, ShiftFrameOverride } from '../types';

export interface AddWeeklyFrameInput {
  dayOfWeek: number;
  name: string;
  startTime: string;
  endTime: string;
  requiredCount: number;
  sortOrder?: number;
}

export interface AddOneOffFrameInput {
  date: string;
  name: string;
  startTime: string;
  endTime: string;
  requiredCount: number;
}

export interface UpdateFramePatch {
  name?: string;
  startTime?: string;
  endTime?: string;
  requiredCount?: number;
  sortOrder?: number;
  isActive?: boolean;
}

export type UpsertOverrideInput =
  | { kind: 'cancel' }
  | { kind: 'modify'; name: string; startTime: string; endTime: string; requiredCount: number };

/**
 * シフト枠テンプレート（shift_frames）+ 特定日上書き（shift_frame_overrides）の
 * fetch / CRUD + 割当 RPC を提供する hook。
 *   設計書: .company/engineering/docs/2026-07-20-kintai-shift-frames.md §7.3
 *
 * 実装規律（全 mutate 共通・P3-5 house rule / useShift.ts submitShift:126-130 と同文体）:
 *   UPDATE/DELETE/INSERT は `.select('id')` を付け 0 行なら明示 throw
 *   （RLS 無音 success の封鎖）。エラーは formatSupabaseError 全文（短縮禁止）。
 *   成功後は再 fetch。
 */
export function useShiftFrames(tenantId: string, storeId: string | null) {
  const [frames, setFrames] = useState<ShiftFrame[]>([]);
  const [overrides, setOverrides] = useState<ShiftFrameOverride[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFrames = useCallback(async (rangeStart: string, rangeEnd: string) => {
    if (storeId === null) return;
    setLoading(true);
    setError(null);
    try {
      // 毎週テンプレ全件 + date BETWEEN range の単発枠
      const { data: framesData, error: framesError } = await supabase
        .from('shift_frames')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('store_id', storeId)
        .or(`day_of_week.not.is.null,and(date.gte.${rangeStart},date.lte.${rangeEnd})`)
        .order('sort_order', { ascending: true });
      if (framesError) throw framesError;
      setFrames((framesData as ShiftFrame[]) || []);

      // range 内の overrides（frame_id → tenant_id で絞れるが tenant_id, date の索引を使う）
      const { data: overridesData, error: overridesError } = await supabase
        .from('shift_frame_overrides')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('date', rangeStart)
        .lte('date', rangeEnd);
      if (overridesError) throw overridesError;
      setOverrides((overridesData as ShiftFrameOverride[]) || []);
    } catch (err) {
      const formatted = formatSupabaseError(err);
      logger.error('fetchFrames error:', formatted);
      setError(formatted.message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, storeId]);

  const addWeeklyFrame = useCallback(async (i: AddWeeklyFrameInput) => {
    if (storeId === null) throw new Error('店舗が選択されていません');
    const { data, error: e } = await supabase
      .from('shift_frames')
      .insert({
        tenant_id: tenantId,
        store_id: storeId,
        day_of_week: i.dayOfWeek,
        date: null,
        name: i.name,
        start_time: i.startTime,
        end_time: i.endTime,
        required_count: i.requiredCount,
        sort_order: i.sortOrder ?? 0,
      })
      .select('id');
    if (e) throw new Error(`シフト枠の追加に失敗しました: ${formatSupabaseError(e).message}`);
    if (!data || data.length === 0) {
      throw new Error('シフト枠の追加に失敗しました: 対象が見つからないか権限がありません');
    }
  }, [tenantId, storeId]);

  const addOneOffFrame = useCallback(async (i: AddOneOffFrameInput) => {
    if (storeId === null) throw new Error('店舗が選択されていません');
    const { data, error: e } = await supabase
      .from('shift_frames')
      .insert({
        tenant_id: tenantId,
        store_id: storeId,
        day_of_week: null,
        date: i.date,
        name: i.name,
        start_time: i.startTime,
        end_time: i.endTime,
        required_count: i.requiredCount,
        sort_order: 0,
      })
      .select('id');
    if (e) throw new Error(`単発シフト枠の追加に失敗しました: ${formatSupabaseError(e).message}`);
    if (!data || data.length === 0) {
      throw new Error('単発シフト枠の追加に失敗しました: 対象が見つからないか権限がありません');
    }
  }, [tenantId, storeId]);

  const updateFrame = useCallback(async (id: string, patch: UpdateFramePatch) => {
    const payload: Record<string, unknown> = {};
    if (patch.name !== undefined) payload.name = patch.name;
    if (patch.startTime !== undefined) payload.start_time = patch.startTime;
    if (patch.endTime !== undefined) payload.end_time = patch.endTime;
    if (patch.requiredCount !== undefined) payload.required_count = patch.requiredCount;
    if (patch.sortOrder !== undefined) payload.sort_order = patch.sortOrder;
    if (patch.isActive !== undefined) payload.is_active = patch.isActive;
    const { data, error: e } = await supabase
      .from('shift_frames')
      .update(payload)
      .eq('id', id)
      .select('id');
    if (e) throw new Error(`シフト枠の更新に失敗しました: ${formatSupabaseError(e).message}`);
    if (!data || data.length === 0) {
      throw new Error('シフト枠の更新に失敗しました: 対象が見つからないか権限がありません');
    }
  }, []);

  const deleteFrame = useCallback(async (id: string) => {
    const { data, error: e } = await supabase
      .from('shift_frames')
      .delete()
      .eq('id', id)
      .select('id');
    if (e) throw new Error(`シフト枠の削除に失敗しました: ${formatSupabaseError(e).message}`);
    if (!data || data.length === 0) {
      throw new Error('シフト枠の削除に失敗しました: 対象が見つからないか権限がありません');
    }
  }, []);

  const upsertOverride = useCallback(async (frameId: string, date: string, o: UpsertOverrideInput) => {
    const payload =
      o.kind === 'cancel'
        ? { tenant_id: tenantId, frame_id: frameId, date, kind: 'cancel', name: null, start_time: null, end_time: null, required_count: null }
        : { tenant_id: tenantId, frame_id: frameId, date, kind: 'modify', name: o.name, start_time: o.startTime, end_time: o.endTime, required_count: o.requiredCount };
    const { data, error: e } = await supabase
      .from('shift_frame_overrides')
      .upsert(payload, { onConflict: 'frame_id,date' })
      .select('id');
    if (e) throw new Error(`シフト枠の上書きに失敗しました: ${formatSupabaseError(e).message}`);
    if (!data || data.length === 0) {
      throw new Error('シフト枠の上書きに失敗しました: 対象が見つからないか権限がありません');
    }
  }, [tenantId]);

  const removeOverride = useCallback(async (id: string) => {
    const { data, error: e } = await supabase
      .from('shift_frame_overrides')
      .delete()
      .eq('id', id)
      .select('id');
    if (e) throw new Error(`上書き解除に失敗しました: ${formatSupabaseError(e).message}`);
    if (!data || data.length === 0) {
      throw new Error('上書き解除に失敗しました: 対象が見つからないか権限がありません');
    }
  }, []);

  const assignPreferenceToFrame = useCallback(async (preferenceId: string, frameId: string) => {
    const { error: e } = await supabase.rpc('assign_preference_to_frame', {
      p_preference_id: preferenceId,
      p_frame_id: frameId,
    });
    if (e) throw new Error(`枠への割当に失敗しました: ${formatSupabaseError(e).message}`);
  }, []);

  const setShiftFrame = useCallback(async (shiftId: string, frameId: string | null) => {
    const { data, error: e } = await supabase
      .from('shifts')
      .update({ frame_id: frameId })
      .eq('id', shiftId)
      .select('id');
    if (e) throw new Error(`シフトの枠設定に失敗しました: ${formatSupabaseError(e).message}`);
    if (!data || data.length === 0) {
      throw new Error('シフトの枠設定に失敗しました: 対象が見つからないか権限がありません');
    }
  }, []);

  return {
    frames,
    overrides,
    loading,
    error,
    fetchFrames,
    addWeeklyFrame,
    addOneOffFrame,
    updateFrame,
    deleteFrame,
    upsertOverride,
    removeOverride,
    assignPreferenceToFrame,
    setShiftFrame,
  };
}
