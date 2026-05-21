import type { ProjectStatus } from '../../types';

/**
 * ProjectDialog の保存入力型。
 * storeId:
 *   - undefined : 未指定 (作成時は親で扱いを決める)
 *   - null      : 「全社」(canCreateGlobal=true の時のみ選択可能)
 *   - string    : 指定店舗
 */
export interface ProjectInput {
  tenantId: string;
  storeId?: string | null;
  name: string;
  description?: string;
  status?: ProjectStatus;
}

/** 店舗選択肢の最小型 */
export interface ProjectStoreOption {
  id: string;
  name: string;
}
