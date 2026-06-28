// =============================================================================
// Phase 0 — useCan フック（PermissionContext を組み立てて can をバインド）
// 設計書: .company/engineering/docs/2026-06-29-kintai-permissions-phase0-can.md §5.5
//
// Rules of Hooks 厳守: useCan 自体はトップレベル無条件呼び出し。
// StoreProvider は App 全体（認証後）を包む（App.tsx）ため useStoreContext は安全。
// =============================================================================

import { useCallback, useMemo } from 'react';
import { useTenant } from '../../contexts/TenantContext';
import { useStoreContext } from '../../contexts/StoreContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  can,
  type Capability,
  type NoArgCapability,
  type PermissionContext,
  type CanActOnTaskArgs,
  type StoreScopedArgs,
} from './can';

export interface UseCan {
  (capability: NoArgCapability): boolean;
  (capability: 'canActOnTask', args: CanActOnTaskArgs): boolean;
  (capability: 'canEditProject', args: StoreScopedArgs): boolean;
  (capability: 'isManagerOfStore', args: StoreScopedArgs): boolean;
}

export function useCan(): UseCan {
  const { myRole, isParttime, myStoreIds } = useTenant();
  const { managedStoreIds } = useStoreContext();
  const { user } = useAuth();

  const ctx = useMemo<PermissionContext>(
    () => ({
      role: myRole,
      isParttime,
      userId: user?.id ?? null,
      myStoreIds,
      managedStoreIds,
    }),
    [myRole, isParttime, user?.id, myStoreIds, managedStoreIds],
  );

  return useCallback(
    (capability: Capability, args?: CanActOnTaskArgs | StoreScopedArgs): boolean =>
      // can のオーバーロードは外部 API。内部ディスパッチは any 回避のためまとめて委譲。
      (can as (c: Capability, ctx: PermissionContext, a?: CanActOnTaskArgs | StoreScopedArgs) => boolean)(
        capability,
        ctx,
        args,
      ),
    [ctx],
  ) as UseCan;
}
