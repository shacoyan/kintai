import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { startOfMonth, format, subMonths, setDate, startOfDay, addHours, addMinutes } from 'date-fns';
import { useTenant } from './useTenant';
import { useStoreContext } from '../contexts/StoreContext';

// AC-4: 権限判定は RLS (tenant_members.role IN ('owner','manager')) と一致させる。
// store_members.is_manager には依存しない（hook と RLS の乖離を防ぐため）。

export interface UseShiftSubmissionDeadlineResult {
  deadline: Date | null;
  loading: boolean;
  error: Error | null;
  canEdit: boolean;
  setDeadline: (deadlineAt: Date) => Promise<void>;
  clearDeadline: () => Promise<void>;
  getDefaultDeadlineForMonth: () => Promise<Date | null>;
  applyDefaultDeadline: () => Promise<void>;
}

export function useShiftSubmissionDeadline(targetMonth: Date): UseShiftSubmissionDeadlineResult {
  const { currentTenant, isOwner, myRole } = useTenant();
  const { currentStore } = useStoreContext();

  const tenantId = currentTenant?.id ?? null;
  const storeId = currentStore?.id ?? null;

  const targetMonthKey = format(startOfMonth(targetMonth), 'yyyy-MM-dd');

  const [deadline, setDeadlineState] = useState<Date | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const canEdit = isOwner || myRole === 'manager';

  useEffect(() => {
    let isMounted = true;

    const fetchDeadline = async () => {
      if (!tenantId || !storeId) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('shift_submission_deadlines')
          .select('deadline_at')
          .eq('tenant_id', tenantId)
          .eq('store_id', storeId)
          .eq('target_month', targetMonthKey)
          .maybeSingle();

        if (!isMounted) return;

        if (fetchError) {
          throw fetchError;
        }

        setDeadlineState(data?.deadline_at ? new Date(data.deadline_at) : null);
      } catch (e) {
        if (isMounted) {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchDeadline();

    return () => {
      isMounted = false;
    };
  }, [tenantId, storeId, targetMonthKey]);

  const setDeadline = useCallback(async (deadlineAt: Date) => {
    if (!tenantId || !storeId) {
      throw new Error('Tenant and Store context are required to set a deadline.');
    }

    try {
      setError(null);
      setLoading(true);

      const { error: upsertError } = await supabase
        .from('shift_submission_deadlines')
        .upsert(
          {
            tenant_id: tenantId,
            store_id: storeId,
            target_month: targetMonthKey,
            deadline_at: deadlineAt.toISOString(),
          },
          { onConflict: 'tenant_id,store_id,target_month' }
        );

      if (upsertError) {
        throw upsertError;
      }

      setDeadlineState(deadlineAt);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [tenantId, storeId, targetMonthKey]);

  const clearDeadline = useCallback(async () => {
    if (!tenantId || !storeId) {
      throw new Error('Tenant and Store context are required to clear a deadline.');
    }

    try {
      setError(null);
      setLoading(true);

      const { error: deleteError } = await supabase
        .from('shift_submission_deadlines')
        .delete()
        .match({
          tenant_id: tenantId,
          store_id: storeId,
          target_month: targetMonthKey,
        });

      if (deleteError) {
        throw deleteError;
      }

      setDeadlineState(null);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [tenantId, storeId, targetMonthKey]);

  // tenants.default_deadline_day から「targetMonth の前月 X 日 23:59 (local)」を返す。
  // 値が NULL なら null を返す。
  const getDefaultDeadlineForMonth = useCallback(async (): Promise<Date | null> => {
    if (!tenantId) {
      throw new Error('Tenant context is required to get default deadline.');
    }

    const { data, error: fetchError } = await supabase
      .from('tenants')
      .select('default_deadline_day')
      .eq('id', tenantId)
      .maybeSingle();

    if (fetchError) {
      throw fetchError;
    }

    const defaultDeadlineDay: number | null = (data?.default_deadline_day ?? null) as number | null;

    if (defaultDeadlineDay === null || defaultDeadlineDay === undefined) {
      return null;
    }

    const previousMonthDate = subMonths(startOfMonth(targetMonth), 1);
    const daySetDate = setDate(previousMonthDate, defaultDeadlineDay);

    return addMinutes(addHours(startOfDay(daySetDate), 23), 59);
  }, [tenantId, targetMonth]);

  const applyDefaultDeadline = useCallback(async (): Promise<void> => {
    const defaultDeadline = await getDefaultDeadlineForMonth();

    if (!defaultDeadline) {
      throw new Error('デフォルト締切日が未設定です');
    }

    await setDeadline(defaultDeadline);
  }, [getDefaultDeadlineForMonth, setDeadline]);

  return {
    deadline: loading ? null : deadline,
    loading,
    error,
    canEdit: loading ? false : canEdit,
    setDeadline,
    clearDeadline,
    getDefaultDeadlineForMonth,
    applyDefaultDeadline,
  };
}
