import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// Context版のre-export（後方互換性のため維持）
export { useTenant } from '../contexts/TenantContext';

// === Loop 7 (Engineer A) ===
// 給与の月締め日（payroll_close_day）取得/更新フック
export const usePayrollCloseDay = (tenantId: string) => {
  const [closeDay, setCloseDay] = useState<number>(31);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!tenantId) return;

    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('tenants')
      .select('payroll_close_day')
      .eq('id', tenantId)
      .single();

    if (fetchError) {
      setError(fetchError.message);
    } else if (data) {
      setCloseDay((data as { payroll_close_day: number | null }).payroll_close_day ?? 31);
    }

    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updateCloseDay = useCallback(async (day: number) => {
    if (!tenantId) return;
    if (day < 1 || day > 31) {
      setError('締め日は 1〜31 の範囲で指定してください');
      return;
    }

    setLoading(true);
    setError(null);

    const { error: updateError } = await supabase
      .from('tenants')
      .update({ payroll_close_day: day })
      .eq('id', tenantId);

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    setCloseDay(day);
    setLoading(false);
  }, [tenantId]);

  return {
    closeDay,
    loading,
    error,
    updateCloseDay,
    refetch: fetchData,
  };
};

