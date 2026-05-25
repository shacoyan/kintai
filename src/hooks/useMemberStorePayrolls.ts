import { useState, useCallback } from 'react';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { formatSupabaseError, type FriendlyError } from '../lib/errors';
import type {
  MemberStorePayroll,
  MemberStorePayrollUpsertPayload,
  MemberStoreRate,
  TenantMember,
} from '../types';

/**
 * 店舗別人件費 hook (Phase 1a: API surface のみ)
 *
 * - fetch: tenant 全 record を Map<`${user_id}:${store_id}`, MemberStorePayroll> に展開
 * - getMemberStoreRate: (user, store) で個別レート解決。店舗別未設定なら tenant_members 既定値にフォールバック
 * - upsert/delete: owner/manager のみ RLS 通過。0 行 RETURNING は明示エラー化 (silent reject 検出)
 */
export function useMemberStorePayrolls(tenantId: string) {
  const [payrollsMap, setPayrollsMap] = useState<Map<string, MemberStorePayroll>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const buildKey = (userId: string, storeId: string) => `${userId}:${storeId}`;

  const fetchMemberStorePayrolls = useCallback(async (): Promise<Map<string, MemberStorePayroll>> => {
    setLoading(true);
    try {
      const { data, error: supaError } = await supabase
        .from('member_store_payrolls')
        .select('*')
        .eq('tenant_id', tenantId);
      if (supaError) throw supaError;
      const map = new Map<string, MemberStorePayroll>();
      for (const row of (data as MemberStorePayroll[]) ?? []) {
        map.set(buildKey(row.user_id, row.store_id), row);
      }
      setPayrollsMap(map);
      return map;
    } catch (err) {
      logger.error('fetchMemberStorePayrolls error:', formatSupabaseError(err));
      const f = formatSupabaseError(err);
      setError(f);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  /**
   * (user_id, store_id) のレートを解決する純粋関数 (state 依存)。
   * - store 単位の override があれば store_override
   * - 無ければ tenant_members の既定値を返す (multiplier はテーブル未保持なので 1.25 既定)
   * - tenant_members にも見つからなければ hourly/null/1.25 を返す
   */
  const getMemberStoreRate = useCallback(
    (userId: string, storeId: string, tenantMembers: TenantMember[]): MemberStoreRate => {
      const override = payrollsMap.get(buildKey(userId, storeId));
      if (override) {
        return {
          pay_type: override.pay_type,
          hourly_rate: override.hourly_rate,
          monthly_salary: override.monthly_salary,
          night_shift_rate_multiplier: override.night_shift_rate_multiplier,
          source: 'store_override',
        };
      }
      const member = tenantMembers.find((m) => m.user_id === userId);
      if (member) {
        return {
          pay_type: member.pay_type,
          hourly_rate: member.hourly_rate,
          monthly_salary: member.monthly_salary,
          night_shift_rate_multiplier: 1.25,
          source: 'member_default',
        };
      }
      return {
        pay_type: 'hourly',
        hourly_rate: null,
        monthly_salary: null,
        night_shift_rate_multiplier: 1.25,
        source: 'member_default',
      };
    },
    [payrollsMap],
  );

  const upsertMemberStorePayroll = useCallback(
    async (payload: MemberStorePayrollUpsertPayload): Promise<MemberStorePayroll> => {
      try {
        const { data, error: supaError } = await supabase
          .from('member_store_payrolls')
          .upsert(payload, { onConflict: 'tenant_id,user_id,store_id' })
          .select();
        if (supaError) {
          throw new Error(`店舗別人件費の保存に失敗しました: ${formatSupabaseError(supaError).message}`);
        }
        if (!data || data.length === 0) {
          // RLS で silent reject された可能性。明示エラー化。
          throw new Error('店舗別人件費の保存に失敗しました: 権限がないか、該当行が見つかりません');
        }
        const row = data[0] as MemberStorePayroll;
        setPayrollsMap((prev) => {
          const next = new Map(prev);
          next.set(buildKey(row.user_id, row.store_id), row);
          return next;
        });
        return row;
      } catch (err) {
        logger.error('upsertMemberStorePayroll error:', formatSupabaseError(err));
        const f = formatSupabaseError(err);
        setError(f);
        throw err;
      }
    },
    [],
  );

  const deleteMemberStorePayroll = useCallback(
    async (userId: string, storeId: string, scopedTenantId: string): Promise<void> => {
      try {
        const { data, error: supaError } = await supabase
          .from('member_store_payrolls')
          .delete()
          .eq('tenant_id', scopedTenantId)
          .eq('user_id', userId)
          .eq('store_id', storeId)
          .select();
        if (supaError) {
          throw new Error(`店舗別人件費の削除に失敗しました: ${formatSupabaseError(supaError).message}`);
        }
        if (!data || data.length === 0) {
          throw new Error('店舗別人件費の削除に失敗しました: 該当行が見つからないか、権限がありません');
        }
        setPayrollsMap((prev) => {
          const next = new Map(prev);
          next.delete(buildKey(userId, storeId));
          return next;
        });
      } catch (err) {
        logger.error('deleteMemberStorePayroll error:', formatSupabaseError(err));
        const f = formatSupabaseError(err);
        setError(f);
        throw err;
      }
    },
    [],
  );

  return {
    payrollsMap,
    loading,
    error,
    clearError,
    fetchMemberStorePayrolls,
    getMemberStoreRate,
    upsertMemberStorePayroll,
    deleteMemberStorePayroll,
  };
}
