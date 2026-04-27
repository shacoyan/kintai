import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { ShiftPreset } from '../types';

export function useShiftPreset(tenantId: string, storeId: string | null) {
  const [presets, setPresets] = useState<ShiftPreset[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPresets = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('shift_presets')
        .select('*')
        .eq('tenant_id', tenantId);
      if (storeId !== null) {
        query = query.or(`store_id.is.null,store_id.eq.${storeId}`);
      } else {
        query = query.is('store_id', null);
      }
      const { data, error } = await query.order('sort_order', { ascending: true });
      if (error) throw error;
      setPresets((data as ShiftPreset[]) || []);
    } catch (err) {
      console.error('Error fetching shift presets:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId, storeId]);

  const addPreset = useCallback(async (name: string, startTime: string, endTime: string, scope: 'store' | 'tenant') => {
    if (scope === 'store' && storeId === null) {
      throw new Error('店舗が選択されていません');
    }
    const { error } = await supabase
      .from('shift_presets')
      .insert({
        tenant_id: tenantId,
        name,
        start_time: startTime,
        end_time: endTime,
        store_id: scope === 'store' ? storeId : null,
      });
    if (error) throw new Error(`プリセットの追加に失敗しました: ${error.message}`);
    await fetchPresets();
  }, [tenantId, storeId, fetchPresets]);

  const deletePreset = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('shift_presets')
      .delete()
      .eq('id', id);
    if (error) throw new Error(`プリセットの削除に失敗しました: ${error.message}`);
    setPresets(prev => prev.filter(p => p.id !== id));
  }, []);

  const updatePreset = useCallback(async (id: string, name: string, startTime: string, endTime: string, scope: 'store' | 'tenant') => {
    if (scope === 'store' && storeId === null) {
      throw new Error('店舗が選択されていません');
    }
    const { error } = await supabase
      .from('shift_presets')
      .update({
        name,
        start_time: startTime,
        end_time: endTime,
        store_id: scope === 'store' ? storeId : null,
      })
      .eq('id', id);
    if (error) throw new Error(`プリセットの更新に失敗しました: ${error.message}`);
    await fetchPresets();
  }, [storeId, fetchPresets]);

  const reorderPresets = useCallback(async (orderedIds: string[]) => {
    await Promise.all(orderedIds.map((id, index) =>
      supabase
        .from('shift_presets')
        .update({ sort_order: index })
        .eq('id', id)
    ));
    await fetchPresets();
  }, [fetchPresets]);

  return { presets, loading, fetchPresets, addPreset, deletePreset, updatePreset, reorderPresets };
}
