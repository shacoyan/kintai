import { useState, useEffect, useCallback, useMemo } from 'react';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { supabase } from '../lib/supabase';

export type UnsubmittedMember = {
  user_id: string;
  display_name: string;
  last_submission_at: string | null;
};

type StoreMemberRow = {
  member_id: string;
};

type TenantMemberRow = {
  id: string;
  user_id: string;
  display_name: string;
  role: string;
};

type ShiftPreferenceRow = {
  user_id: string;
  created_at: string;
};

export type UseUnsubmittedMembersReturn = {
  unsubmitted: UnsubmittedMember[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};

/**
 * 指定 store / target_month において、shift_preferences を 1 件も提出していない
 * staff / manager メンバー一覧を返す。owner は除外。
 */
export function useUnsubmittedMembers(
  tenantId: string | null,
  storeId: string | null,
  targetMonth: Date
): UseUnsubmittedMembersReturn {
  const [unsubmitted, setUnsubmitted] = useState<UnsubmittedMember[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const monthKey = useMemo(
    () => format(startOfMonth(targetMonth), 'yyyy-MM-dd'),
    [targetMonth]
  );

  const fetchData = useCallback(async () => {
    if (!tenantId || !storeId) {
      setUnsubmitted([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const monthStart = startOfMonth(targetMonth);
      const monthEnd = endOfMonth(targetMonth);
      const startDate = format(monthStart, 'yyyy-MM-dd');
      const endDate = format(monthEnd, 'yyyy-MM-dd');

      // 1) store_members: storeId 所属のメンバー一覧
      const { data: storeMembersData, error: storeMembersError } = await supabase
        .from('store_members')
        .select('member_id')
        .eq('store_id', storeId);

      if (storeMembersError) {
        throw new Error(storeMembersError.message);
      }

      const storeMembers = (storeMembersData as StoreMemberRow[] | null) ?? [];

      if (storeMembers.length === 0) {
        setUnsubmitted([]);
        return;
      }

      const memberIds = storeMembers.map((sm) => sm.member_id);

      // 2) tenant_members: staff / manager のみ（owner 除外）
      const { data: tenantMembersData, error: tenantMembersError } = await supabase
        .from('tenant_members')
        .select('id, user_id, display_name, role')
        .in('id', memberIds)
        .in('role', ['staff', 'manager']);

      if (tenantMembersError) {
        throw new Error(tenantMembersError.message);
      }

      const tenantMembers = (tenantMembersData as TenantMemberRow[] | null) ?? [];

      if (tenantMembers.length === 0) {
        setUnsubmitted([]);
        return;
      }

      const userIds = tenantMembers.map((tm) => tm.user_id);

      // 3) shift_preferences: 対象月で当該 store に提出された希望（user_id, created_at）
      const { data: shiftPrefsData, error: shiftPrefsError } = await supabase
        .from('shift_preferences')
        .select('user_id, created_at')
        .eq('tenant_id', tenantId)
        .eq('store_id', storeId)
        .gte('date', startDate)
        .lte('date', endDate)
        .in('user_id', userIds);

      if (shiftPrefsError) {
        throw new Error(shiftPrefsError.message);
      }

      const shiftPrefs = (shiftPrefsData as ShiftPreferenceRow[] | null) ?? [];

      // 提出 user_id → 最新 created_at の Map
      const submissionMap = new Map<string, string>();
      for (const pref of shiftPrefs) {
        const existing = submissionMap.get(pref.user_id);
        if (!existing || pref.created_at > existing) {
          submissionMap.set(pref.user_id, pref.created_at);
        }
      }

      // 提出 0 件のメンバーを抽出（last_submission_at は仕様上 null）
      const result: UnsubmittedMember[] = tenantMembers
        .filter((tm) => !submissionMap.has(tm.user_id))
        .map((tm) => ({
          user_id: tm.user_id,
          display_name: tm.display_name,
          last_submission_at: null,
        }));

      setUnsubmitted(result);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setUnsubmitted([]);
    } finally {
      setLoading(false);
    }
    // monthKey で月単位の安定性を担保
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, storeId, monthKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    unsubmitted,
    loading,
    error,
    refetch: fetchData,
  };
}
