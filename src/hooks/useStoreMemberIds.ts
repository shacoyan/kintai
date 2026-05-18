import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePersistentError } from '../contexts/PersistentErrorContext';

/**
 * 指定 storeId に所属する member_id 集合を取得する hook。
 * - storeId が null の場合は null を返す（全店舗モード = 呼び出し側で全件を維持）
 * - 取得失敗時は PersistentErrorContext に push、結果は空集合
 *
 * Loop I (2026-05-18): ShiftPayrollPreview の集計対象を
 * 「自店舗の従業員のみ」に絞るために導入。
 */
export function useStoreMemberIds(storeId: string | null): Set<string> | null {
  const [ids, setIds] = useState<Set<string> | null>(null);
  const { addError } = usePersistentError();

  useEffect(() => {
    if (storeId == null) {
      setIds(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      const { data, error } = await supabase
        .from('store_members')
        .select('member_id')
        .eq('store_id', storeId);

      if (cancelled) return;

      if (error) {
        addError({
          key: `useStoreMemberIds:${storeId}`,
          severity: 'warning',
          operation: 'fetch_store_members',
          title: 'store_members 取得失敗',
          message: '自店舗メンバー一覧の取得に失敗したため、給与プレビューが全店舗範囲で表示されている可能性があります。',
          detail: error.message,
        });
        setIds(new Set());
        return;
      }

      const memberIds = new Set<string>((data ?? []).map((row: { member_id: string }) => row.member_id));
      setIds(memberIds);
    })();

    return () => {
      cancelled = true;
    };
  }, [storeId, addError]);

  return ids;
}
