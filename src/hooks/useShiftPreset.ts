import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { ShiftPreset } from '../types';

export function useShiftPreset(tenantId: string) {
  const [presets, setPresets] = useState<ShiftPreset[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPresets = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('shift_presets')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      setPresets((data as ShiftPreset[]) || []);
    } catch (err) {
      console.error('Error fetching shift presets:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  const addPreset = useCallback(async (name: string, startTime: string, endTime: string) => {
    const { error } = await supabase
      .from('shift_presets')
      .insert({
        tenant_id: tenantId,
        name,
        start_time: startTime,
        end_time: endTime,
      });
    if (error) throw new Error(`プリセットの追加に失敗しました: ${error.message}`);
    await fetchPresets();
  }, [tenantId, fetchPresets]);

  const deletePreset = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('shift_presets')
      .delete()
      .eq('id', id);
    if (error) throw new Error(`プリセットの削除に失敗しました: ${error.message}`);
    setPresets(prev => prev.filter(p => p.id !== id));
  }, []);

  return { presets, loading, fetchPresets, addPreset, deletePreset };
}
